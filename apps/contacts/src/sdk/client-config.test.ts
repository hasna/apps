import { describe, expect, test } from "bun:test";
import { ContactsV1Client } from "./index.js";

describe("public ContactsV1Client configuration", () => {
  test("requires an explicit HTTPS authority and nonempty API key", () => {
    expect(() => new ContactsV1Client({ baseUrl: "", apiKey: "key" })).toThrow("absolute HTTPS URL");
    expect(() => new ContactsV1Client({ baseUrl: "http://contacts.example.invalid", apiKey: "key" })).toThrow("must use HTTPS");
    expect(() => new ContactsV1Client({ baseUrl: "https://contacts.example.invalid", apiKey: "   " })).toThrow("requires an API key");
    expect(() => new ContactsV1Client({ baseUrl: "https://user:pass@contacts.example.invalid", apiKey: "key" })).toThrow("must not contain credentials");
  });

  test("normalizes /v1 once and never follows redirects", async () => {
    const calls: Array<{ url: string; redirect: RequestRedirect | undefined; key: string | null }> = [];
    const client = new ContactsV1Client({
      baseUrl: "https://contacts.example.invalid/v1/",
      apiKey: "test-key",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        calls.push({ url: String(input), redirect: init?.redirect, key: headers.get("x-api-key") });
        return Response.json({ contacts: [], count: 0 });
      }) as typeof fetch,
    });

    await client.listContacts();
    expect(calls).toEqual([{
      url: "https://contacts.example.invalid/v1/contacts",
      redirect: "manual",
      key: "test-key",
    }]);
  });
});
