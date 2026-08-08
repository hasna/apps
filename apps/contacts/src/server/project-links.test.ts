import { describe, expect, test } from "bun:test";
import { handleContactProjectsRoute } from "./v1.js";

function request(path: string, init?: RequestInit): Request {
  return new Request(`https://contacts.example${path}`, init);
}

function projectStore(overrides: Record<string, unknown> = {}) {
  return {
    async getContact(id: string) {
      return id === "missing" ? null : { id, display_name: "Contact" };
    },
    async linkContactToProject() {},
    async unlinkContactFromProject() {
      return true;
    },
    async getContactProjectIds() {
      return ["project-a", "project-b"];
    },
    async setContactProjects(_contactId: string, projectIds: string[]) {
      return [...new Set(projectIds)];
    },
    async listContactIdsByProject() {
      return ["contact-1", "contact-2"];
    },
    async readContactProjectMembership(contactId: string, projectId: string) {
      return { contact_id: contactId, project_id: projectId, linked: false, version: "cpmv_1" };
    },
    async listContactProjectMemberships(projectId: string) {
      return {
        project_id: projectId,
        contact_ids: ["contact-1"],
        complete: true as const,
        membership_revision: "cpml_1",
      };
    },
    async mutateContactProjectMembership(
      direction: "attach" | "detach",
      input: { contact_id: string; project_id: string; operation_id: string; step_id: string; expected_version: string },
    ) {
      return {
        outcome: "accepted" as const,
        operation_id: input.operation_id,
        step_id: input.step_id,
        before: {
          contact_id: input.contact_id,
          project_id: input.project_id,
          linked: direction === "detach",
          version: input.expected_version,
        },
        after: {
          contact_id: input.contact_id,
          project_id: input.project_id,
          linked: direction === "attach",
          version: "cpmv_2",
        },
        receipt_id: "cpmr_1",
      };
    },
    ...overrides,
  };
}

describe("authenticated contact project routes", () => {
  test("returns exact contact-not-found and body-validation errors", async () => {
    const missing = await handleContactProjectsRoute(
      request("/v1/contacts/missing/projects"),
      "GET",
      ["v1", "contacts", "missing", "projects"],
      projectStore(),
    );
    expect(missing?.status).toBe(404);
    expect(await missing?.json()).toEqual({ error: "contact not found" });

    const invalid = await handleContactProjectsRoute(
      request("/v1/contacts/contact-1/projects", {
        method: "PUT",
        body: JSON.stringify({ project_ids: ["project-a", 1] }),
      }),
      "PUT",
      ["v1", "contacts", "contact-1", "projects"],
      projectStore(),
    );
    expect(invalid?.status).toBe(400);
    expect(await invalid?.json()).toEqual({
      error: "project_ids must be an array of non-empty strings",
    });
  });

  test("supports attach, list, replace, detach, and reverse lookup", async () => {
    const calls: Array<{ operation: string; args: string[] }> = [];
    const store = projectStore({
      async linkContactToProject(contactId: string, projectId: string) {
        calls.push({ operation: "attach", args: [contactId, projectId] });
      },
      async setContactProjects(contactId: string, projectIds: string[]) {
        calls.push({ operation: "replace", args: [contactId, ...projectIds] });
        return [...new Set(projectIds)];
      },
      async unlinkContactFromProject(contactId: string, projectId: string) {
        calls.push({ operation: "detach", args: [contactId, projectId] });
        return true;
      },
    });

    const attach = await handleContactProjectsRoute(
      request("/v1/contacts/contact-1/projects/project%2Fa", { method: "PUT" }),
      "PUT",
      ["v1", "contacts", "contact-1", "projects", "project/a"],
      store,
    );
    expect(await attach?.json()).toEqual({
      attached: true,
      contact_id: "contact-1",
      project_id: "project/a",
    });

    const list = await handleContactProjectsRoute(
      request("/v1/contacts/contact-1/projects"),
      "GET",
      ["v1", "contacts", "contact-1", "projects"],
      store,
    );
    expect(await list?.json()).toEqual({
      contact_id: "contact-1",
      project_ids: ["project-a", "project-b"],
    });

    const replace = await handleContactProjectsRoute(
      request("/v1/contacts/contact-1/projects", {
        method: "PUT",
        body: JSON.stringify({ project_ids: ["project-b", "project-a", "project-b"] }),
      }),
      "PUT",
      ["v1", "contacts", "contact-1", "projects"],
      store,
    );
    expect(await replace?.json()).toEqual({
      contact_id: "contact-1",
      project_ids: ["project-b", "project-a"],
    });

    const detach = await handleContactProjectsRoute(
      request("/v1/contacts/contact-1/projects/project%2Fa", { method: "DELETE" }),
      "DELETE",
      ["v1", "contacts", "contact-1", "projects", "project/a"],
      store,
    );
    expect(await detach?.json()).toEqual({
      removed: true,
      contact_id: "contact-1",
      project_id: "project/a",
    });

    const reverse = await handleContactProjectsRoute(
      request("/v1/projects/project%2Fa/contacts"),
      "GET",
      ["v1", "projects", "project/a", "contacts"],
      store,
    );
    expect(await reverse?.json()).toEqual({
      project_id: "project/a",
      contact_ids: ["contact-1", "contact-2"],
    });

    expect(calls).toEqual([
      { operation: "attach", args: ["contact-1", "project/a"] },
      { operation: "replace", args: ["contact-1", "project-b", "project-a", "project-b"] },
      { operation: "detach", args: ["contact-1", "project/a"] },
    ]);
  });

  test("exposes guarded membership read, list, attach, and detach contracts", async () => {
    const store = projectStore();
    const read = await handleContactProjectsRoute(
      request("/v1/projects/project-1/contact-memberships/contact-1"),
      "GET",
      ["v1", "projects", "project-1", "contact-memberships", "contact-1"],
      store,
    );
    expect(await read?.json()).toMatchObject({ linked: false, version: "cpmv_1" });

    const list = await handleContactProjectsRoute(
      request("/v1/projects/project-1/contact-memberships?max_items=1000"),
      "GET",
      ["v1", "projects", "project-1", "contact-memberships"],
      store,
    );
    expect(await list?.json()).toMatchObject({ contact_ids: ["contact-1"], complete: true });

    for (const action of ["attach", "detach"] as const) {
      const response = await handleContactProjectsRoute(
        request(`/v1/projects/project-1/contact-memberships/contact-1/${action}`, {
          method: "POST",
          body: JSON.stringify({
            operation_id: `${action}-contact-1`,
            step_id: `contacts-membership:forward:${action}`,
            expected_version: "cpmv_1",
          }),
        }),
        "POST",
        ["v1", "projects", "project-1", "contact-memberships", "contact-1", action],
        store,
      );
      expect(await response?.json()).toMatchObject({
        outcome: "accepted",
        receipt_id: "cpmr_1",
        after: { linked: action === "attach" },
      });
    }
  });
});
