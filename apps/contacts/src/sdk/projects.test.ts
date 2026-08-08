import { describe, expect, test } from "bun:test";
import { ContactsV1Client } from "./v1.generated.js";

describe("ContactsV1Client project links", () => {
  test("generates typed methods for every project-link route", async () => {
    const calls: Array<{ method: string; pathname: string; body: unknown }> = [];
    const client = new ContactsV1Client({
      baseUrl: "https://contacts.example",
      apiKey: "test-key",
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const pathname = new URL(url).pathname;
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        calls.push({ method, pathname, body });

        if (method === "GET" && pathname.endsWith("/projects")) {
          return Response.json({ contact_id: "contact-1", project_ids: ["project-1"] });
        }
        if (method === "GET") {
          return Response.json({ project_id: "project-1", contact_ids: ["contact-1"] });
        }
        if (method === "DELETE") {
          return Response.json({ removed: true, contact_id: "contact-1", project_id: "project-1" });
        }
        if (pathname.endsWith("/projects")) {
          return Response.json({ contact_id: "contact-1", project_ids: body.project_ids });
        }
        return Response.json({ attached: true, contact_id: "contact-1", project_id: "project-1" });
      }) as typeof fetch,
    });

    expect(await client.linkContactToProject("contact-1", "project-1")).toMatchObject({ attached: true });
    expect(await client.getContactProjectIds("contact-1")).toMatchObject({ project_ids: ["project-1"] });
    expect(await client.setContactProjects("contact-1", { project_ids: ["project-1"] })).toMatchObject({
      project_ids: ["project-1"],
    });
    expect(await client.listContactIdsByProject("project-1")).toMatchObject({ contact_ids: ["contact-1"] });
    expect(await client.unlinkContactFromProject("contact-1", "project-1")).toMatchObject({ removed: true });

    expect(calls).toEqual([
      { method: "PUT", pathname: "/v1/contacts/contact-1/projects/project-1", body: undefined },
      { method: "GET", pathname: "/v1/contacts/contact-1/projects", body: undefined },
      {
        method: "PUT",
        pathname: "/v1/contacts/contact-1/projects",
        body: { project_ids: ["project-1"] },
      },
      { method: "GET", pathname: "/v1/projects/project-1/contacts", body: undefined },
      { method: "DELETE", pathname: "/v1/contacts/contact-1/projects/project-1", body: undefined },
    ]);
  });
});
