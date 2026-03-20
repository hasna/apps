/**
 * Gmail contact import — fetches messages matching a query, extracts unique
 * senders/recipients, and returns them as CreateContactInput objects.
 *
 * Uses the Gmail REST API directly with tokens stored at
 * ~/.connectors/connect-gmail/profiles/default/tokens.json
 * (requires connect-gmail auth login to be completed first).
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { CreateContactInput } from "../types/index.js";

interface GmailTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface GmailMessageRef {
  id: string;
  threadId: string;
}

interface GmailHeader {
  name: string;
  value: string;
}

interface GmailMessageMeta {
  id: string;
  payload?: { headers?: GmailHeader[] };
}

/**
 * Load Gmail access token from the connect-gmail config directory.
 * Checks ~/.connectors/connect-gmail/ (canonical) and falls back to
 * ~/.connect/connect-gmail/ (legacy, pre-migration).
 */
function loadGmailToken(profile = "default"): string {
  const bases = [
    join(homedir(), ".connectors", "connect-gmail"),
    join(homedir(), ".connect", "connect-gmail"),
  ];

  for (const base of bases) {
    const tokenPath = join(base, "profiles", profile, "tokens.json");
    if (existsSync(tokenPath)) {
      try {
        const raw = readFileSync(tokenPath, "utf-8");
        const tokens = JSON.parse(raw) as GmailTokens;
        if (tokens.accessToken) return tokens.accessToken;
      } catch {
        // continue
      }
    }
  }

  throw new Error(
    "Gmail not authenticated. Run `connect-gmail auth login` first."
  );
}

/**
 * Parse a single RFC 5322 address header value into { name, email } pairs.
 * Handles: "Name <email>", "<email>", "email", and comma-separated lists.
 */
export function parseAddressHeader(header: string): Array<{ name: string; email: string }> {
  const results: Array<{ name: string; email: string }> = [];
  // Split on commas that are NOT inside angle brackets or quotes
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
function domainToCompany(email: string): string | null {
  const domain = email.split("@")[1];
  if (!domain) return null;

  const genericDomains = new Set([
    "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk",
    "hotmail.com", "hotmail.co.uk", "outlook.com", "live.com",
    "icloud.com", "me.com", "mac.com", "protonmail.com", "pm.me",
    "fastmail.com", "hey.com", "aol.com", "msn.com",
  ]);

  if (genericDomains.has(domain.toLowerCase())) return null;

  // Convert domain to readable company name: strip www., strip TLD, capitalize
  const parts = domain.split(".");
  const name = parts.length > 2 ? parts[parts.length - 2]! : parts[0]!;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Parse display name into first/last name.
 */
function parseName(displayName: string): { first_name?: string; last_name?: string } {
  const name = displayName.trim();
  if (!name) return {};
  const parts = name.split(/\s+/);
  if (parts.length === 1) return { first_name: parts[0] };
  const last = parts.pop()!;
  return { first_name: parts.join(" "), last_name: last };
}

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

/**
 * Fetch messages matching `query` from Gmail and extract unique contacts.
 * Does NOT write to the database — returns prepared CreateContactInput objects.
 */
export async function extractContactsFromGmail(
  opts: GmailImportOptions
): Promise<ExtractedContact[]> {
  const maxMessages = Math.min(opts.max_messages ?? 200, 500);
  const profile = opts.gmail_profile ?? "default";
  const token = loadGmailToken(profile);

  // Step 1: List message IDs matching the query
  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("q", opts.query);
  listUrl.searchParams.set("maxResults", String(maxMessages));

  const listResp = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!listResp.ok) {
    const body = await listResp.text();
    if (listResp.status === 401) {
      throw new Error(
        "Gmail token expired. Run `connect-gmail auth login` to re-authenticate."
      );
    }
    throw new Error(`Gmail API error ${listResp.status}: ${body}`);
  }

  const listData = (await listResp.json()) as { messages?: GmailMessageRef[] };
  const messageRefs = listData.messages ?? [];

  if (messageRefs.length === 0) {
    return [];
  }

  // Step 2: Fetch metadata for each message (headers only — cheap)
  const seen = new Map<string, ExtractedContact>();

  const batchSize = 20;
  for (let i = 0; i < messageRefs.length; i += batchSize) {
    const batch = messageRefs.slice(i, i + batchSize);
    const fetches = batch.map((ref) => {
      const url = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${ref.id}`
      );
      url.searchParams.set("format", "metadata");
      url.searchParams.set("metadataHeaders", "From");
      url.searchParams.set("metadataHeaders", "To");
      url.searchParams.set("metadataHeaders", "Cc");
      return fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => (r.ok ? (r.json() as Promise<GmailMessageMeta>) : null));
    });

    const results = await Promise.all(fetches);

    for (const msg of results) {
      if (!msg?.payload?.headers) continue;
      const headers = msg.payload.headers;

      const getHeader = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

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
