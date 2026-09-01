import { afterEach, describe, expect, test } from "bun:test";
import { getStore, resetStoreCache } from "./index.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetStoreCache();
});

describe("ApiStore contact project operations", () => {
  test("attaches, lists, replaces, reverse-lists, and detaches through /v1 only", async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });

      const pathname = new URL(url).pathname;
      if (method === "PUT" && pathname === "/v1/contacts/contact-1/projects/project%2Falpha") {
        return Response.json({ attached: true, contact_id: "contact-1", project_id: "project/alpha" });
      }
      if (method === "GET" && pathname === "/v1/contacts/contact-1/projects") {
        return Response.json({ contact_id: "contact-1", project_ids: ["project/alpha", "project-beta"] });
      }
      if (method === "PUT" && pathname === "/v1/contacts/contact-1/projects") {
        return Response.json({ contact_id: "contact-1", project_ids: body.project_ids });
      }
      if (method === "GET" && pathname === "/v1/projects/project%2Falpha/contacts") {
        return Response.json({ project_id: "project/alpha", contact_ids: ["contact-1"] });
      }
      if (method === "DELETE" && pathname === "/v1/contacts/contact-1/projects/project%2Falpha") {
        return Response.json({ removed: true, contact_id: "contact-1", project_id: "project/alpha" });
      }
      return Response.json({ error: "unexpected request" }, { status: 404 });
    }) as typeof fetch;

    const store = getStore({
      HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
      HASNA_CONTACTS_API_KEY: "test-key",
    });

    await store.linkContactToProject("contact-1", "project/alpha");
    expect(await store.getContactProjectIds("contact-1")).toEqual(["project/alpha", "project-beta"]);
    await store.setContactProjects("contact-1", ["project-beta", "project-gamma", "project-beta"]);
    expect(await store.listContactIdsByProject("project/alpha")).toEqual(["contact-1"]);
    await store.unlinkContactFromProject("contact-1", "project/alpha");

    expect(calls).toEqual([
      {
        method: "PUT",
        url: "https://contacts.example.invalid/v1/contacts/contact-1/projects/project%2Falpha",
        body: undefined,
      },
      {
        method: "GET",
        url: "https://contacts.example.invalid/v1/contacts/contact-1/projects",
        body: undefined,
      },
      {
        method: "PUT",
        url: "https://contacts.example.invalid/v1/contacts/contact-1/projects",
        body: { project_ids: ["project-beta", "project-gamma", "project-beta"] },
      },
      {
        method: "GET",
        url: "https://contacts.example.invalid/v1/projects/project%2Falpha/contacts",
        body: undefined,
      },
      {
        method: "DELETE",
        url: "https://contacts.example.invalid/v1/contacts/contact-1/projects/project%2Falpha",
        body: undefined,
      },
    ]);
  });
});
