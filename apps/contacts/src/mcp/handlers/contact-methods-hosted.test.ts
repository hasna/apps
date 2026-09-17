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

function stubFetch(calls: Call[], responseBody: unknown): void {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, url, body: raw ? JSON.parse(raw) : undefined });
    return new Response(JSON.stringify(responseBody), {
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
  process.env.HASNA_HOME = home;
  process.env.HASNA_DATA_HOME = home;
  process.env.HASNA_STATE_HOME = home;
  process.env.HASNA_CONFIG_HOME = home;
  delete process.env.HASNA_PROFILE;
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
  test("add_email_to_contact PATCHes /v1/contacts/:id and returns the updated contact", async () => {
    const calls: Call[] = [];
    stubFetch(calls, { contact: {
      id: "contact-1",
      display_name: "Ada Lovelace",
      emails: [
        { id: "email-0", contact_id: "contact-1", address: "ada@old.example", type: "personal", is_primary: false },
        { id: "email-1", contact_id: "contact-1", address: "ada@example.com", type: "work", is_primary: true },
      ],
    } });

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
      id: "contact-1",
      emails: [
        { id: "email-0", address: "ada@old.example" },
        { id: "email-1", address: "ada@example.com" },
      ],
    });
    expect(walk(home)).toEqual([]);
  });

  test("add_phone_to_contact PATCHes /v1/contacts/:id and returns the updated contact", async () => {
    const calls: Call[] = [];
    stubFetch(calls, { contact: {
      id: "contact-2",
      display_name: "Grace Hopper",
      phones: [{ id: "phone-1", contact_id: "contact-2", number: "+15550001111", type: "mobile", country_code: "1", is_primary: false }],
    } });

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
      id: "contact-2",
      phones: [{ id: "phone-1", number: "+15550001111" }],
    });
    expect(walk(home)).toEqual([]);
  });

  test("duplicate-safe responses preserve the full-contact output contract", async () => {
    const calls: Call[] = [];
    stubFetch(calls, { contact: {
      id: "contact-3",
      emails: [{ id: "email-3", contact_id: "contact-3", address: "X@Example.com" }],
      phones: [{ id: "phone-3", contact_id: "contact-3", number: "+15550002222" }],
    } });

    const emailResult = await allHandlers.add_email_to_contact!({ contact_id: "contact-3", address: "x@example.com" });
    const phoneResult = await allHandlers.add_phone_to_contact!({ contact_id: "contact-3", number: "+15550002222" });

    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "PATCH /v1/contacts/contact-3",
      "PATCH /v1/contacts/contact-3",
    ]);
    expect(JSON.parse(emailResult.content[0]!.text as string)).toMatchObject({ id: "contact-3" });
    expect(JSON.parse(phoneResult.content[0]!.text as string)).toMatchObject({ id: "contact-3" });
    expect(walk(home)).toEqual([]);
  });

  test.each([
    ["missing contact envelope", {}],
    ["null contact", { contact: null }],
    ["mismatched contact", { contact: { id: "contact-other", emails: [{ id: "email-4", contact_id: "contact-other", address: "x@example.com" }] } }],
    ["missing appended method", { contact: { id: "contact-4", emails: [] } }],
    ["method owned by another contact", { contact: { id: "contact-4", emails: [{ id: "email-4", contact_id: "contact-other", address: "x@example.com" }] } }],
  ])("rejects a malformed successful response: %s", async (_case, responseBody) => {
    const calls: Call[] = [];
    stubFetch(calls, responseBody);

    await expect(allHandlers.add_email_to_contact!({ contact_id: "contact-4", address: "x@example.com" }))
      .rejects.toThrow(/malformed \/v1 response for addEmailToContact/);
    expect(calls).toHaveLength(1);
    expect(walk(home)).toEqual([]);
  });


  test("rejects a phone response that omits the requested number", async () => {
    const calls: Call[] = [];
    stubFetch(calls, { contact: { id: "contact-6", phones: [] } });

    await expect(allHandlers.add_phone_to_contact!({ contact_id: "contact-6", number: "+15550004444" }))
      .rejects.toThrow(/malformed \/v1 response for addPhoneToContact/);
    expect(calls).toHaveLength(1);
    expect(walk(home)).toEqual([]);
  });

  test("propagates hosted transport failure without falling back to local storage", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("hosted transport unavailable");
    }) as unknown as typeof fetch;

    await expect(allHandlers.add_phone_to_contact!({ contact_id: "contact-5", number: "+15550003333" }))
      .rejects.toThrow("hosted transport unavailable");
    expect(calls).toBeGreaterThan(0);
    expect(walk(home)).toEqual([]);
  });
});
