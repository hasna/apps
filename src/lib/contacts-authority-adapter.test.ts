import { describe, expect, test } from "bun:test";
import { ContactsHttpProjectMembershipAuthority } from "./contacts-authority-adapter.js";
import {
  ProjectContactLinkOperationError,
  attachProjectContact,
} from "./project-contact-links.js";
import type { ProjectStore } from "../store/project-store.js";
import type { ProjectResourceLinkMutationRequest } from "../types/workspace.js";

describe("ContactsHttpProjectMembershipAuthority", () => {
  test("canonicalizes the default service instance identically with or without a trailing slash", () => {
    const fetchImpl = async (): Promise<Response> => Response.json({});
    const withoutSlash = new ContactsHttpProjectMembershipAuthority({
      baseUrl: "https://contacts.example.test",
      apiKey: "test-key",
      fetchImpl,
    });
    const withSlash = new ContactsHttpProjectMembershipAuthority({
      baseUrl: "https://contacts.example.test/",
      apiKey: "test-key",
      fetchImpl,
    });

    expect(withoutSlash.service_instance).toBe("https://contacts.example.test/");
    expect(withSlash.service_instance).toBe(withoutSlash.service_instance);
  });

  test("maps the concrete Contacts membership API to the coordinator contract", async () => {
    const requests: Array<{ method: string; path: string; authorization: string | null; body: unknown }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({
        method: init?.method ?? "GET",
        path: `${url.pathname}${url.search}`,
        authorization: new Headers(init?.headers).get("authorization"),
        body,
      });
      if (url.pathname.endsWith("/contact-memberships/contact-1")) {
        return Response.json({
          contact_id: "contact-1",
          project_id: "project-1",
          linked: false,
          version: "membership-v1",
        });
      }
      if (url.pathname.endsWith("/contact-memberships")) {
        return Response.json({
          project_id: "project-1",
          contact_ids: ["contact-1"],
          complete: true,
          membership_revision: "membership-list-v1",
        });
      }
      return Response.json({
        outcome: "accepted",
        operation_id: body.operation_id,
        step_id: body.step_id,
        before: {
          contact_id: "contact-1",
          project_id: "project-1",
          linked: false,
          version: body.expected_version,
        },
        after: {
          contact_id: "contact-1",
          project_id: "project-1",
          linked: url.pathname.endsWith("/attach"),
          version: "membership-v2",
        },
        receipt_id: "contact-membership-receipt-1",
      });
    };
    const adapter = new ContactsHttpProjectMembershipAuthority({
      baseUrl: "https://contacts.example.test",
      apiKey: "test-key",
      serviceInstance: "urn:hasna:contacts:test",
      fetchImpl,
    });

    expect(await adapter.readMembership({ contact_id: "contact-1", project_id: "project-1" }))
      .toMatchObject({ linked: false, version: "membership-v1" });
    expect(await adapter.listProjectMemberships({ project_id: "project-1", max_items: 1000 }))
      .toMatchObject({ contact_ids: ["contact-1"], complete: true });
    expect(await adapter.attach({
      contact_id: "contact-1",
      project_id: "project-1",
      operation_id: "attach-contact-1",
      step_id: "contacts-membership:forward:v1",
      expected_version: "membership-v1",
    })).toMatchObject({ outcome: "accepted", receipt_id: "contact-membership-receipt-1" });
    expect(await adapter.detach({
      contact_id: "contact-1",
      project_id: "project-1",
      operation_id: "detach-contact-1",
      step_id: "contacts-membership:forward:v2",
      expected_version: "membership-v2",
    })).toMatchObject({ outcome: "accepted", receipt_id: "contact-membership-receipt-1" });

    expect(requests).toEqual([
      {
        method: "GET",
        path: "/v1/projects/project-1/contact-memberships/contact-1",
        authorization: "Bearer test-key",
        body: null,
      },
      {
        method: "GET",
        path: "/v1/projects/project-1/contact-memberships?max_items=1000",
        authorization: "Bearer test-key",
        body: null,
      },
      {
        method: "POST",
        path: "/v1/projects/project-1/contact-memberships/contact-1/attach",
        authorization: "Bearer test-key",
        body: {
          operation_id: "attach-contact-1",
          step_id: "contacts-membership:forward:v1",
          expected_version: "membership-v1",
        },
      },
      {
        method: "POST",
        path: "/v1/projects/project-1/contact-memberships/contact-1/detach",
        authorization: "Bearer test-key",
        body: {
          operation_id: "detach-contact-1",
          step_id: "contacts-membership:forward:v2",
          expected_version: "membership-v2",
        },
      },
    ]);
  });

  test("drives compensation through the concrete HTTP adapter when the Projects CAS is refused", async () => {
    const projectId = "wks_eHb1kcLUzgQVJQt6L0CCB";
    const contactId = "6b68e131-abe5-43b7-92cd-9930b04611df";
    let linked = false;
    let version = 1;
    const mutations: Array<{ direction: string; operation_id: string; step_id: string }> = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      const snapshot = () => ({
        contact_id: contactId,
        project_id: projectId,
        linked,
        version: `membership-v${version}`,
      });
      if ((init?.method ?? "GET") === "GET") return Response.json(snapshot());
      const body = JSON.parse(String(init?.body)) as {
        operation_id: string;
        step_id: string;
        expected_version: string;
      };
      if (body.expected_version !== snapshot().version) {
        return Response.json({ error: "expected_version conflict" }, { status: 409 });
      }
      const before = snapshot();
      const direction = url.pathname.endsWith("/attach") ? "attach" : "detach";
      mutations.push({ direction, operation_id: body.operation_id, step_id: body.step_id });
      linked = direction === "attach";
      version += 1;
      return Response.json({
        outcome: "accepted",
        operation_id: body.operation_id,
        step_id: body.step_id,
        before,
        after: snapshot(),
        receipt_id: `cmr_${mutations.length}`,
      });
    };
    const adapter = new ContactsHttpProjectMembershipAuthority({
      baseUrl: "https://contacts.example.test",
      apiKey: "test-key",
      serviceInstance: "urn:hasna:contacts:test",
      fetchImpl,
    });
    const projectRead = {
      ok: true as const,
      project_id: projectId,
      project: {
        id: projectId,
        slug: "reges-kpmg",
        name: "REGES / KPMG",
        description: null,
        kind: "generic" as const,
        status: "active" as const,
        root_id: null,
        recipe_id: null,
        canonical_machine: null,
        primary_path: null,
        git_remote: null,
        s3_bucket: null,
        s3_prefix: null,
        tags: [],
        integrations: {},
        metadata: {},
        last_opened_at: null,
        created_at: "2026-08-08 12:00:00",
        updated_at: "2026-08-08 12:00:00",
        synced_at: null,
      },
      current_revision: "2026-08-08 12:00:00",
      links: [],
      link_count: 0,
      max_items: 1000,
      collection_digest: "project-links-v1",
      complete: true as const,
      truncated: false as const,
      response_control: {
        response_byte_limit: 100_000,
        time_budget_ms: 5_000,
        response_bytes: 1_000,
        elapsed_ms: 1,
        complete: true as const,
        truncated: false as const,
      },
    };
    const projects = {
      async readProjectResourceLinks() {
        return projectRead;
      },
      async mutateProjectResourceLinks(input: ProjectResourceLinkMutationRequest) {
        return {
          ok: false,
          dry_run: false,
          outcome: "terminal_nonacceptance" as const,
          mode: input.mode,
          idempotency_key: "gpm_terminal_nonacceptance",
          request_digest: "request",
          precondition_digest: "precondition",
          project_id: projectId,
          expected_revision: input.expected_revision,
          current_revision: projectRead.current_revision,
          before: {
            project: projectRead.project,
            links: projectRead.links,
            collection_digest: projectRead.collection_digest,
          },
          after: null,
          receipt: {
            receipt_id: "gpmr_terminal_nonacceptance",
            operation_id: input.operation_id,
            step_id: input.step_id,
            direction: "forward" as const,
            idempotency_key: "gpm_terminal_nonacceptance",
            target_id: projectId,
            request_digest: "request",
            precondition_digest: "precondition",
            expected_revision: input.expected_revision,
            outcome: "terminal_nonacceptance" as const,
            reason: "stale_revision",
            result_project_id: null,
            duplicate_of_receipt_id: null,
            before: null,
            after: null,
            post_revision: null,
            created_at: "2026-08-08 12:00:01",
          },
          response_control: projectRead.response_control,
        };
      },
      async rollbackProjectResourceLinks() {
        throw new Error("unexpected Projects rollback");
      },
    } as unknown as Pick<
      ProjectStore,
      "readProjectResourceLinks" | "mutateProjectResourceLinks" | "rollbackProjectResourceLinks"
    >;

    let thrown: unknown;
    try {
      await attachProjectContact({ projects, contacts: adapter }, {
        project_id: projectId,
        contact_id: contactId,
        operation_id: "concrete-adapter-compensation",
        max_items: 1000,
        response_byte_limit: 100_000,
        time_budget_ms: 5_000,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProjectContactLinkOperationError);
    expect(thrown).toMatchObject({
      code: "PROJECT_CONTACT_LINK_PROJECT_WRITE_FAILED_COMPENSATED",
      compensated: true,
    });
    expect(linked).toBe(false);
    expect(mutations).toHaveLength(2);
    expect(mutations.map((mutation) => mutation.direction)).toEqual(["attach", "detach"]);
    expect(mutations[0]!.operation_id).toBe(mutations[1]!.operation_id);
    expect(mutations[0]!.step_id).not.toBe(mutations[1]!.step_id);
  });
});
