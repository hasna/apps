/**
 * Hosted-path test for the two MCP tools that used to die on
 * `ApiUnavailableError`: `add_email_to_contact` and `add_phone_to_contact`.
 *
 * They now ride the contact route that the deployed `/v1` server already
 * answers (`PATCH /v1/contacts/:id` with `emails_add` / `phones_add`). The test
 * drives the real tool handlers with a hosted credential, asserts the exact
 * method + path + body that left the process, and asserts that nothing was
 * written under a throwaway HOME — no `*.db*`, ever.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allHandlers } from "./index.js";
import { resetStoreCache } from "../../store/index.js";

const originalFetch = globalThis.fetch;

let home: string;
let savedEnv: NodeJS.ProcessEnv;

/** Every file under `dir`, recursively — used to prove nothing was written. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

type Call = { method: string; url: string; body: unknown };

function stubFetch(calls: Call[], contact: Record<string, unknown>): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, url, body: raw ? JSON.parse(raw) : undefined });
    return new Response(JSON.stringify({ contact }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  savedEnv = { ...process.env };
  home = mkdtempSync(join(tmpdir(), "contacts-hosted-"));
  // Scrub every contacts selector a sibling test file may have left in the
  // shared process env (bun runs the suite in one process): a stray
  // CONTACTS_DB_PATH is a RETIRED selector and the resolver refuses it.
  for (const key of Object.keys(process.env)) if (/CONTACTS/.test(key)) delete process.env[key];
  process.env.HOME = home;
  // Keep the station's real Keychain out of the resolution: on station03 the
  // stored api-url disagrees with this test authority and the resolver (rightly)
  // refuses the mismatch. An unknown station has no Keychain tier at all.
  process.env.HASNA_STATION = "no-such-station";
  process.env.HASNA_CONTACTS_API_URL = "https://contacts.example.invalid";
  process.env.HASNA_CONTACTS_API_KEY = "test-api-key";
  resetStoreCache();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetStoreCache();
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
  rmSync(home, { recursive: true, force: true });
});

describe("MCP contact-method tools on the hosted /v1 path", () => {
  test("add_email_to_contact PATCHes /v1/contacts/:id with emails_add and returns the new address", async () => {
    const calls: Call[] = [];
    stubFetch(calls, {
      id: "contact-1",
      display_name: "Ada Lovelace",
      emails: [
        { id: "email-0", address: "ada@old.example", type: "personal", is_primary: false },
        { id: "email-1", address: "ada@example.com", type: "work", is_primary: true },
      ],
    });

    const result = await allHandlers.add_email_to_contact!({
      contact_id: "contact-1",
      address: "ada@example.com",
      type: "work",
      is_primary: true,
    });

    expect(calls).toEqual([
      {
        method: "PATCH",
        url: "https://contacts.example.invalid/v1/contacts/contact-1",
        body: { emails_add: [{ address: "ada@example.com", type: "work", is_primary: true }] },
      },
    ]);
    expect(JSON.parse(result.content[0]!.text as string)).toMatchObject({
      id: "email-1",
      address: "ada@example.com",
    });
    expect(walk(home)).toEqual([]);
  });

  test("add_phone_to_contact PATCHes /v1/contacts/:id with phones_add and returns the new number", async () => {
    const calls: Call[] = [];
    stubFetch(calls, {
      id: "contact-2",
      display_name: "Grace Hopper",
      phones: [{ id: "phone-1", number: "+15550001111", type: "mobile", country_code: "1", is_primary: false }],
    });

    const result = await allHandlers.add_phone_to_contact!({
      contact_id: "contact-2",
      number: "+15550001111",
      type: "mobile",
      country_code: "1",
    });

    expect(calls).toEqual([
      {
        method: "PATCH",
        url: "https://contacts.example.invalid/v1/contacts/contact-2",
        body: { phones_add: [{ number: "+15550001111", type: "mobile", country_code: "1" }] },
      },
    ]);
    expect(JSON.parse(result.content[0]!.text as string)).toMatchObject({
      id: "phone-1",
      number: "+15550001111",
    });
    expect(walk(home)).toEqual([]);
  });

  test("neither tool throws ApiUnavailableError any more", async () => {
    const calls: Call[] = [];
    stubFetch(calls, { id: "contact-3", emails: [], phones: [] });

    await allHandlers.add_email_to_contact!({ contact_id: "contact-3", address: "x@example.com" });
    await allHandlers.add_phone_to_contact!({ contact_id: "contact-3", number: "+15550002222" });

    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "PATCH /v1/contacts/contact-3",
      "PATCH /v1/contacts/contact-3",
    ]);
    expect(walk(home).filter((f) => f.includes(".db"))).toEqual([]);
  });
});
