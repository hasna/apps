/**
 * Gmail contact import — fetches messages matching a query via the connect-gmail
 * connector, extracts unique senders/recipients, and returns them as
 * CreateContactInput objects ready to upsert into the local DB.
 *
 * Auth: connect-gmail auth login   (run once per profile)
 * Install: bun install -g @hasnaxyz/connect-gmail
 */

import type { CreateContactInput } from "../types/index.js";
import { readConnectorTokens, ConnectorAuthError } from "./connector.js";

// ─── Address parsing ──────────────────────────────────────────────────────────

/**
 * Parse a single RFC 5322 address header value into { name, email } pairs.
 * Handles: "Name <email>", "<email>", "email", and comma-separated lists.
 */
export function parseAddressHeader(header: string): Array<{ name: string; email: string }> {
  const results: Array<{ name: string; email: string }> = [];
  const parts = header.split(/,(?![^<>]*>)(?![^"]*")/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const angleMatch = trimmed.match(/^(.*?)\s*<([^>]+)>\s*$/);
    if (angleMatch) {
      const name = angleMatch[1]!.trim().replace(/^"|"$/g, "");
      const email = angleMatch[2]!.trim().toLowerCase();
      if (email.includes("@")) results.push({ name, email });
    } else if (trimmed.includes("@")) {
      results.push({ name: "", email: trimmed.toLowerCase() });
    }
  }

  return results;
}

/**
 * Infer a company name from an email domain.
 * Returns null for personal/generic domains (gmail, yahoo, hotmail, etc.).
 */
export function domainToCompany(email: string): string | null {
  const domain = email.split("@")[1];
  if (!domain) return null;

  const genericDomains = new Set([
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
    "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com",
    "icloud.com", "me.com", "mac.com", "protonmail.com", "pm.me",
    "fastmail.com", "hey.com", "aol.com", "msn.com",
  ]);

  if (genericDomains.has(domain.toLowerCase())) return null;

  const parts = domain.split(".");
  const name = parts.length > 2 ? parts[parts.length - 2]! : parts[0]!;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Parse display name into first/last name.
 */
export function parseName(displayName: string): { first_name?: string; last_name?: string } {
  const name = displayName.trim();
  if (!name) return {};
  const parts = name.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0] };
  const last = parts.pop()!;
  return { first_name: parts.join(" "), last_name: last };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GmailImportOptions {
  query: string;
  /** Max messages to scan (default 200, max 500) */
  max_messages?: number;
  /** Gmail profile to use (default: "default") */
  gmail_profile?: string;
  tag_ids?: string[];
  group_id?: string;
}

export interface ExtractedContact {
  email: string;
  name: string;
  company_hint: string | null;
  contact_input: CreateContactInput;
}

interface GmailMessageRef { id: string; threadId: string }
interface GmailHeader { name: string; value: string }
interface GmailMessageMeta { id: string; payload?: { headers?: GmailHeader[] } }

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Fetch messages matching `query` from Gmail and extract unique contacts.
 * Uses connect-gmail's stored tokens for auth — no API keys needed in code.
 * Does NOT write to the database — returns prepared CreateContactInput objects.
 */
export async function extractContactsFromGmail(
  opts: GmailImportOptions
): Promise<ExtractedContact[]> {
  const maxMessages = Math.min(opts.max_messages ?? 200, 500);
  const profile = opts.gmail_profile ?? "default";

  // Load access token via connector helper — honours both canonical and legacy paths
  let token: string;
  try {
    const tokens = readConnectorTokens("gmail", profile);
    token = tokens["accessToken"] as string;
    if (!token) throw new ConnectorAuthError("gmail", "accessToken missing");
  } catch (err) {
    if (err instanceof ConnectorAuthError) throw err;
    throw new ConnectorAuthError("gmail", String(err));
  }

  // ── Step 1: List message IDs ────────────────────────────────────────────────
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", opts.query);
  listUrl.searchParams.set("maxResults", String(maxMessages));

  const listResp = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!listResp.ok) {
    if (listResp.status === 401) {
      throw new ConnectorAuthError("gmail", "token expired — run connect-gmail auth login");
    }
    throw new Error(`Gmail API error ${listResp.status}: ${await listResp.text()}`);
  }

  const listData = (await listResp.json()) as { messages?: GmailMessageRef[] };
  const messageRefs = listData.messages ?? [];
  if (messageRefs.length === 0) return [];

  // ── Step 2: Batch-fetch message metadata (headers only — cheap) ─────────────
  const seen = new Map<string, ExtractedContact>();
  const batchSize = 20;

  for (let i = 0; i < messageRefs.length; i += batchSize) {
    const batch = messageRefs.slice(i, i + batchSize);
    const fetches = batch.map((ref) => {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}`);
      url.searchParams.set("format", "metadata");
      url.searchParams.append("metadataHeaders", "From");
      url.searchParams.append("metadataHeaders", "To");
      url.searchParams.append("metadataHeaders", "Cc");
      return fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? (r.json() as Promise<GmailMessageMeta>) : null));
    });

    const results = await Promise.all(fetches);

    for (const msg of results) {
      if (!msg?.payload?.headers) continue;
      const getHeader = (name: string) =>
        msg.payload!.headers!.find(
          (h) => h.name.toLowerCase() === name.toLowerCase()
        )?.value ?? "";

      const addresses = [
        ...parseAddressHeader(getHeader("From")),
        ...parseAddressHeader(getHeader("To")),
        ...parseAddressHeader(getHeader("Cc")),
      ];

      for (const { name, email } of addresses) {
        if (seen.has(email)) continue;
        const company_hint = domainToCompany(email);
        const nameParts = parseName(name);

        const contact_input: CreateContactInput = {
          ...nameParts,
          display_name: name || email.split("@")[0],
          emails: [{ address: email, type: "work", is_primary: true }],
          ...(opts.tag_ids?.length ? { tag_ids: opts.tag_ids } : {}),
          source: "email",
        };

        seen.set(email, { email, name, company_hint, contact_input });
      }
    }
  }

  return Array.from(seen.values());
}
