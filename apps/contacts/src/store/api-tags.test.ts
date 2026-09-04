import { afterEach, describe, expect, test } from "bun:test";
import { getStore, resetStoreCache } from "./index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetStoreCache();
});

describe("ApiStore contact tag operations", () => {
  test("looks up a tag by name and attaches/removes it without local fallback", async () => {
    const calls: Array<{ method: string; url: string; apiKey: string | null }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({
        method,
        url,
        apiKey: new Headers(init?.headers).get("x-api-key"),
      });
      if (method === "GET") {
        return new Response(JSON.stringify({
          tags: [{ id: "tag-1", name: "monthly accounting", color: "#6366f1" }],
          count: 1,
        }), { status: 200 });
      }
      if (method === "PUT") {
        return new Response(JSON.stringify({ attached: true, contact_id: "contact-1", tag_id: "tag-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ removed: true, contact_id: "contact-1", tag_id: "tag-1" }), { status: 200 });
    }) as typeof fetch;

    const store = getStore({
      HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
      HASNA_CONTACTS_API_KEY: "test-api-key",
    });

    expect(store.mode).toBe("api");
    expect(await store.getTagByName("monthly accounting")).toMatchObject({
      id: "tag-1",
      name: "monthly accounting",
    });
    await store.addTagToContact("contact-1", "tag-1");
    await store.removeTagFromContact("contact-1", "tag-1");

    expect(calls).toEqual([
      {
        method: "GET",
        url: "https://contacts.example.invalid/v1/tags?name=monthly+accounting",
        apiKey: "test-api-key",
      },
      {
        method: "PUT",
        url: "https://contacts.example.invalid/v1/contacts/contact-1/tags/tag-1",
        apiKey: "test-api-key",
      },
      {
        method: "DELETE",
        url: "https://contacts.example.invalid/v1/contacts/contact-1/tags/tag-1",
        apiKey: "test-api-key",
      },
    ]);
  });

  test("rejects an unfiltered legacy response instead of attaching the wrong tag", async () => {
    globalThis.fetch = (async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      tags: [
        { id: "wrong-tag", name: "another workflow", color: "#dc2626" },
        { id: "tag-1", name: "monthly accounting", color: "#6366f1" },
      ],
      count: 2,
    }), { status: 200 })) as typeof fetch;

    const store = getStore({
      HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
      HASNA_CONTACTS_API_KEY: "test-api-key",
    });

    expect(await store.getTagByName("monthly accounting")).toMatchObject({
      id: "tag-1",
      name: "monthly accounting",
    });
    expect(await store.getTagByName("missing tag")).toBeNull();
  });
});
