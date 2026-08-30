/**
 * Versioned `/v1` HTTP API for `contacts-serve` (A1 pure-remote).
 *
 * Every handler goes through the vendored-kit Postgres store (`ContactsPgStore`)
 * which reads/writes the shared RDS directly. Auth is enforced by the contracts
 * API-key verifier: reads require `contacts:read`, writes require
 * `contacts:write` (a `contacts:*` key satisfies both). This is a real wrapper
 * over the relational schema — there are NO stubs; unknown routes 404.
 */
import type {
  CreateCompanyInput,
  CreateContactInput,
  CreateTagInput,
  UpdateCompanyInput,
  UpdateContactInput,
  UpdateTagInput,
} from "../types/index.js";
import type {
  ContactProjectMembershipListResult,
  ContactProjectMembershipMutationInput,
  ContactProjectMembershipMutationResult,
  ContactProjectMembershipSnapshot,
} from "../types/project-memberships.js";
import { ContactProjectMembershipConflictError } from "../types/project-memberships.js";
import { getCloudClient, getCloudVerifier, ensureCloudSchemaBestEffort, CONTACTS_APP_SLUG } from "./cloud.js";
import { getContactsPgStore, type ContactListFilter } from "./pg-store.js";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function error(status: number, message: string, extra?: Record<string, unknown>): Response {
  return json({ error: message, ...(extra ?? {}) }, status);
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    const text = await req.text();
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Convert the public contact-list query surface into a typed cloud-store filter. */
export function contactListFilterFromUrl(url: URL): ContactListFilter {
  return {
    ...(url.searchParams.get("company_id") ? { company_id: url.searchParams.get("company_id")! } : {}),
    ...(url.searchParams.get("status") ? { status: url.searchParams.get("status")! } : {}),
    ...(url.searchParams.get("tag_id") ? { tag_id: url.searchParams.get("tag_id")! } : {}),
    ...(url.searchParams.get("q") ? { q: url.searchParams.get("q")! } : {}),
    ...(url.searchParams.get("limit") ? { limit: Number(url.searchParams.get("limit")) } : {}),
    ...(url.searchParams.get("offset") ? { offset: Number(url.searchParams.get("offset")) } : {}),
  };
}

type ContactProjectsStore = {
  getContact(id: string): Promise<unknown | null>;
  linkContactToProject(contactId: string, projectId: string): Promise<void>;
  unlinkContactFromProject(contactId: string, projectId: string): Promise<boolean>;
  getContactProjectIds(contactId: string): Promise<string[]>;
  setContactProjects(contactId: string, projectIds: string[]): Promise<string[]>;
  listContactIdsByProject(projectId: string): Promise<string[]>;
  readContactProjectMembership(contactId: string, projectId: string): Promise<ContactProjectMembershipSnapshot>;
  listContactProjectMemberships(projectId: string, maxItems: number): Promise<ContactProjectMembershipListResult>;
  mutateContactProjectMembership(
    direction: "attach" | "detach",
    input: ContactProjectMembershipMutationInput,
  ): Promise<ContactProjectMembershipMutationResult>;
};

/**
 * Handle the authenticated contact-project membership routes. Authentication
 * remains at the outer `/v1` boundary; this helper is exported only so the
 * route contract can be tested without a live signing key or PostgreSQL pool.
 */
export async function handleContactProjectsRoute(
  req: Request,
  method: string,
  segments: string[],
  store: ContactProjectsStore,
): Promise<Response | null> {
  const resource = segments[1];
  const id = segments[2];
  const sub = segments[3];

  if (resource === "contacts" && id && sub === "projects") {
    const contact = await store.getContact(id);
    if (!contact) return error(404, "contact not found");

    const projectId = segments[4];
    if (projectId) {
      if (method === "PUT") {
        await store.linkContactToProject(id, projectId);
        return json({ attached: true, contact_id: id, project_id: projectId });
      }
      if (method === "DELETE") {
        const removed = await store.unlinkContactFromProject(id, projectId);
        return json({ removed, contact_id: id, project_id: projectId });
      }
      return error(405, `method ${method} not allowed on /v1/contacts/:contact_id/projects/:project_id`);
    }

    if (method === "GET") {
      return json({ contact_id: id, project_ids: await store.getContactProjectIds(id) });
    }
    if (method === "PUT") {
      const body = await readJson<{ project_ids?: unknown }>(req);
      if (
        !body ||
        !Array.isArray(body.project_ids) ||
        !body.project_ids.every((value) => typeof value === "string" && value.trim().length > 0)
      ) {
        return error(400, "project_ids must be an array of non-empty strings");
      }
      const projectIds = await store.setContactProjects(id, body.project_ids as string[]);
      return json({ contact_id: id, project_ids: projectIds });
    }
    return error(405, `method ${method} not allowed on /v1/contacts/:contact_id/projects`);
  }

  if (resource === "projects" && id && sub === "contacts") {
    if (method === "GET") {
      return json({ project_id: id, contact_ids: await store.listContactIdsByProject(id) });
    }
    return error(405, `method ${method} not allowed on /v1/projects/:project_id/contacts`);
  }

  if (resource === "projects" && id && sub === "contact-memberships") {
    const contactId = segments[4];
    const action = segments[5];
    if (!contactId) {
      if (method !== "GET") {
        return error(405, `method ${method} not allowed on /v1/projects/:project_id/contact-memberships`);
      }
      const rawMaxItems = new URL(req.url).searchParams.get("max_items");
      const maxItems = rawMaxItems === null ? 1000 : Number(rawMaxItems);
      if (!Number.isInteger(maxItems) || maxItems < 1) return error(400, "max_items must be a positive integer");
      return json(await store.listContactProjectMemberships(id, maxItems));
    }
    if (!action) {
      if (method !== "GET") {
        return error(405, `method ${method} not allowed on /v1/projects/:project_id/contact-memberships/:contact_id`);
      }
      const contact = await store.getContact(contactId);
      if (!contact) return error(404, "contact not found");
      return json(await store.readContactProjectMembership(contactId, id));
    }
    if ((action === "attach" || action === "detach") && method === "POST") {
      const body = await readJson<{
        operation_id?: unknown;
        step_id?: unknown;
        expected_version?: unknown;
      }>(req);
      if (
        !body
        || typeof body.operation_id !== "string"
        || typeof body.step_id !== "string"
        || typeof body.expected_version !== "string"
        || body.operation_id.trim().length === 0
        || body.step_id.trim().length === 0
        || body.expected_version.trim().length === 0
      ) {
        return error(400, "operation_id, step_id, and expected_version are required non-empty strings");
      }
      return json(await store.mutateContactProjectMembership(action, {
        contact_id: contactId,
        project_id: id,
        operation_id: body.operation_id,
        step_id: body.step_id,
        expected_version: body.expected_version,
      }));
    }
    return error(405, `method ${method} not allowed on contact-project membership route`);
  }

  return null;
}

/**
 * Handle a `/v1/*` request. Returns `null` when the path is not a `/v1` route so
 * the caller can fall through to other handlers.
 */
export async function handleV1Request(req: Request, url: URL): Promise<Response | null> {
  const path = url.pathname;
  if (path !== "/v1" && !path.startsWith("/v1/")) return null;

  const method = req.method.toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD";
  const requiredScopes = [isWrite ? `${CONTACTS_APP_SLUG}:write` : `${CONTACTS_APP_SLUG}:read`];

  // ── Auth (contracts API-key verifier) ──
  let verifier;
  try {
    verifier = getCloudVerifier();
  } catch (e) {
    return error(503, (e as Error).message);
  }
  const decision = await verifier.authenticate(req.headers, { method, path, requiredScopes });
  if (!decision.ok) {
    return error(decision.status, decision.message, { reason: decision.reason });
  }

  // Best-effort, run-once schema ensure. The DML-only app role can't (and must
  // not) run DDL — the migration task owns schema — so this never throws and
  // never blocks the API on a permission boundary.
  await ensureCloudSchemaBestEffort();
  const store = getContactsPgStore(getCloudClient());

  let segments: string[];
  try {
    segments = path.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment)); // ["v1", resource, id?, sub?]
  } catch {
    return error(400, "invalid URL path encoding");
  }
  const resource = segments[1];
  const id = segments[2];
  const sub = segments[3];
  const qp = (name: string): string | undefined => url.searchParams.get(name) ?? undefined;
  const qn = (name: string): number | undefined => {
    const v = url.searchParams.get(name);
    return v === null ? undefined : Number(v);
  };

  try {
    const projectLinks = await handleContactProjectsRoute(req, method, segments, store);
    if (projectLinks) return projectLinks;

    // ── /v1/contacts/:id/<sub> — per-contact derived reads ──
    if (resource === "contacts" && id && sub) {
      if (sub === "tags") {
        const tagId = segments[4];
        if (!tagId) return error(400, "tag id required");
        if (method === "PUT") {
          await store.addTagToContact(id, tagId);
          return json({ attached: true, contact_id: id, tag_id: tagId });
        }
        if (method === "DELETE") {
          const removed = await store.removeTagFromContact(id, tagId);
          return json({ removed, contact_id: id, tag_id: tagId });
        }
        return error(405, `method ${method} not allowed on /v1/contacts/:contact_id/tags/:tag_id`);
      }
      if (method === "GET" && sub === "timeline") return json({ timeline: await store.getContactTimeline(id, qn("limit") ?? 50) });
      if (method === "GET" && sub === "brief") return json({ brief: await store.getContactBrief(id, qp("context")) });
      if (method === "GET" && sub === "brief-text") return json({ text: await store.generateBrief(id) });
      if (method === "GET" && sub === "card") return json({ card: await store.getContactCard(id) });
      if (method === "GET" && sub === "freshness") return json({ freshness: await store.getFreshnessScore(id) });
      if (method === "GET" && sub === "signals") return json({ signals: await store.getRelationshipSignals(id) });
      if (method === "GET" && sub === "notes") return json({ notes: qp("company_id") ? await store.listNotesForContactAtCompany(id, qp("company_id")!) : await store.listNotes(id) });
      if (method === "GET" && sub === "consent") return json({ consent: await store.listContactConsent(id) });
      if (method === "GET" && sub === "identities") return json({ identities: await store.getContactIdentities(id) });
      if (method === "GET" && sub === "groups") return json({ groups: await store.listGroupsForContact(id) });
      if (method === "GET" && sub === "org-memberships") return json({ org_members: await store.listOrgMembersForContact(id) });
      if (method === "GET" && sub === "relationships") return json({ relationships: await store.listRelationships({ contact_id: id }) });
      if (method === "GET" && sub === "company-relationships") return json({ relationships: await store.listCompanyRelationships({ contact_id: id }) });
      if (method === "GET" && sub === "field-history") return json({ history: await store.getFieldHistory(id, qp("field_name")) });
      if (method === "GET" && sub === "field-at") return json({ fields: await store.getContactAt(id, qp("timestamp") ?? new Date().toISOString()) });
      if (sub === "job-history") {
        if (method === "GET") return json({ job_history: await store.getJobHistory(id) });
        if (method === "POST") { const body = await readJson<Record<string, unknown>>(req); return json({ job: await store.addJobEntry(id, body ?? {}) }, 201); }
      }
      if (sub === "learnings") {
        if (method === "GET") return json({ learnings: await store.getLearnings(id, { type: qp("type"), min_importance: qn("min_importance"), visibility: qp("visibility") }) });
        if (method === "POST") { const body = await readJson<Record<string, unknown>>(req); return json({ learning: await store.saveLearning(id, body ?? {}) }, 201); }
      }
      if (sub === "consent" && method === "POST") { const body = await readJson<{ channel: string; status: string; source?: string }>(req); if (!body) return error(400, "invalid JSON body"); return json({ consent: await store.setContactConsent(id, body.channel, body.status, body.source) }); }
      if (sub === "field-verify" && method === "POST") { const body = await readJson<{ field_name: string; source?: string }>(req); if (!body) return error(400, "invalid JSON body"); await store.markFieldVerified(id, body.field_name, body.source); return json({ ok: true }); }
      return error(404, `unknown /v1/contacts/:id/${sub}`);
    }

    // ── /v1/contacts ──
    if (resource === "contacts") {
      if (!id) {
        if (method === "GET") {
          const result = await store.listContacts(contactListFilterFromUrl(url));
          return json(result);
        }
        if (method === "POST") {
          const body = await readJson<CreateContactInput>(req);
          if (!body) return error(400, "invalid JSON body");
          const contact = await store.createContact(body);
          return json({ contact }, 201);
        }
        return error(405, `method ${method} not allowed on /v1/contacts`);
      }
      if (method === "GET") {
        const contact = await store.getContact(id);
        return contact ? json({ contact }) : error(404, "contact not found");
      }
      if (method === "PATCH" || method === "PUT") {
        const body = await readJson<UpdateContactInput>(req);
        if (!body) return error(400, "invalid JSON body");
        const contact = await store.updateContact(id, body);
        return contact ? json({ contact }) : error(404, "contact not found");
      }
      if (method === "DELETE") {
        const deleted = await store.deleteContact(id);
        return deleted ? json({ deleted: true, id }) : error(404, "contact not found");
      }
      return error(405, `method ${method} not allowed on /v1/contacts/:id`);
    }

    // ── /v1/companies ──
    if (resource === "companies") {
      if (!id) {
        if (method === "GET") {
          const result = await store.listCompanies({
            ...(url.searchParams.get("industry") ? { industry: url.searchParams.get("industry")! } : {}),
            ...(url.searchParams.get("limit") ? { limit: Number(url.searchParams.get("limit")) } : {}),
            ...(url.searchParams.get("offset") ? { offset: Number(url.searchParams.get("offset")) } : {}),
          });
          return json(result);
        }
        if (method === "POST") {
          const body = await readJson<CreateCompanyInput>(req);
          if (!body || typeof body.name !== "string" || !body.name.trim()) {
            return error(400, "name is required");
          }
          const company = await store.createCompany(body);
          return json({ company }, 201);
        }
        return error(405, `method ${method} not allowed on /v1/companies`);
      }
      if (method === "GET") {
        const company = await store.getCompany(id);
        return company ? json({ company }) : error(404, "company not found");
      }
      if (method === "PATCH" || method === "PUT") {
        const body = await readJson<UpdateCompanyInput>(req);
        if (!body) return error(400, "invalid JSON body");
        const company = await store.updateCompany(id, body);
        return company ? json({ company }) : error(404, "company not found");
      }
      if (method === "DELETE") {
        const deleted = await store.deleteCompany(id);
        return deleted ? json({ deleted: true, id }) : error(404, "company not found");
      }
      return error(405, `method ${method} not allowed on /v1/companies/:id`);
    }

    // ── /v1/tags ──
    if (resource === "tags") {
      if (!id) {
        if (method === "GET") {
          const name = url.searchParams.get("name");
          const tag = name !== null ? await store.getTagByName(name) : null;
          const tags = name !== null ? (tag ? [tag] : []) : await store.listTags();
          return json({ tags, count: tags.length });
        }
        if (method === "POST") {
          const body = await readJson<CreateTagInput>(req);
          if (!body || typeof body.name !== "string" || !body.name.trim()) {
            return error(400, "name is required");
          }
          const tag = await store.createTag(body);
          return json({ tag }, 201);
        }
        return error(405, `method ${method} not allowed on /v1/tags`);
      }
      if (method === "GET") {
        const tag = await store.getTag(id);
        return tag ? json({ tag }) : error(404, "tag not found");
      }
      if (method === "PATCH" || method === "PUT") {
        const body = await readJson<UpdateTagInput>(req);
        if (!body) return error(400, "invalid JSON body");
        const tag = await store.updateTag(id, body);
        return tag ? json({ tag }) : error(404, "tag not found");
      }
      if (method === "DELETE") {
        const deleted = await store.deleteTag(id);
        return deleted ? json({ deleted: true, id }) : error(404, "tag not found");
      }
      return error(405, `method ${method} not allowed on /v1/tags/:id`);
    }

    // ── /v1/stats ──
    if (resource === "stats" && method === "GET") {
      return json(await store.stats());
    }

    // ── /v1/deals ──
    if (resource === "deals") {
      if (id && sub === "team" && method === "GET") return json({ team: await store.getDealTeam(id) });
      if (id && sub === "roles" && method === "POST") { const b = await readJson<{ contact_id: string; account_role: string }>(req); if (!b) return error(400, "invalid JSON body"); return json({ role: await store.setDealContactRole(id, b.contact_id, b.account_role) }, 201); }
      if (!id) {
        if (method === "GET") return json({ deals: await store.listDeals({ stage: qp("stage"), contact_id: qp("contact_id"), company_id: qp("company_id") }) });
        if (method === "POST") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ deal: await store.createDeal(b) }, 201); }
        return error(405, `method ${method} not allowed on /v1/deals`);
      }
      if (method === "GET") { const d = await store.getDeal(id); return d ? json({ deal: d }) : error(404, "deal not found"); }
      if (method === "PATCH" || method === "PUT") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); const d = await store.updateDeal(id, b); return d ? json({ deal: d }) : error(404, "deal not found"); }
      if (method === "DELETE") return (await store.deleteDeal(id)) ? json({ deleted: true, id }) : error(404, "deal not found");
      return error(405, "method not allowed");
    }

    // ── /v1/events ──
    if (resource === "events") {
      if (!id) {
        if (method === "GET") return json({ events: await store.listEvents({ contact_id: qp("contact_id"), company_id: qp("company_id"), type: qp("type"), date_from: qp("date_from"), date_to: qp("date_to") }) });
        if (method === "POST") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ event: await store.logEvent(b) }, 201); }
        return error(405, "method not allowed");
      }
      if (method === "DELETE") return (await store.deleteEvent(id)) ? json({ deleted: true, id }) : error(404, "event not found");
      return error(405, "method not allowed");
    }

    // ── /v1/tasks ──
    if (resource === "tasks") {
      if (id === "overdue" && method === "GET") return json({ tasks: await store.listOverdueTasks() });
      if (id === "escalations" && method === "GET") return json({ escalations: await store.checkEscalations() });
      if (!id) {
        if (method === "GET") return json({ tasks: await store.listContactTasks({ contact_id: qp("contact_id"), entity_id: qp("entity_id"), status: qp("status"), priority: qp("priority") }) });
        if (method === "POST") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ task: await store.createContactTask(b) }, 201); }
        return error(405, "method not allowed");
      }
      if (method === "PATCH" || method === "PUT") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); const t = await store.updateContactTask(id, b); return t ? json({ task: t }) : error(404, "task not found"); }
      if (method === "DELETE") return (await store.deleteContactTask(id)) ? json({ deleted: true, id }) : error(404, "task not found");
      return error(405, "method not allowed");
    }

    // ── /v1/applications ──
    if (resource === "applications") {
      if (id === "follow-up-due" && method === "GET") return json({ applications: await store.listFollowUpDueApplications() });
      if (!id) {
        if (method === "GET") return json({ applications: await store.listApplications({ type: qp("type"), status: qp("status"), provider_company_id: qp("provider_company_id"), applicant_contact_id: qp("applicant_contact_id") }) });
        if (method === "POST") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ application: await store.createApplication(b) }, 201); }
        return error(405, "method not allowed");
      }
      if (method === "PATCH" || method === "PUT") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); const a = await store.updateApplication(id, b); return a ? json({ application: a }) : error(404, "application not found"); }
      return error(405, "method not allowed");
    }

    // ── /v1/groups ──
    if (resource === "groups") {
      if (id === "for-contact" && sub && method === "GET") return json({ groups: await store.listGroupsForContact(sub) });
      if (id === "for-company" && sub && method === "GET") return json({ groups: await store.listGroupsForCompany(sub) });
      if (id && sub === "contacts") {
        if (method === "GET") return json({ contact_ids: await store.listContactsInGroup(id) });
        if (method === "POST") { const b = await readJson<{ contact_id: string }>(req); if (!b?.contact_id) return error(400, "contact_id required"); return json(await store.addContactToGroup(b.contact_id, id)); }
        if (method === "DELETE") { const cid = segments[4]; if (!cid) return error(400, "contact id required"); await store.removeContactFromGroup(cid, id); return json({ ok: true }); }
      }
      if (id && sub === "companies") {
        if (method === "GET") return json({ company_ids: await store.listCompaniesInGroup(id) });
        if (method === "POST") { const b = await readJson<{ company_id: string }>(req); if (!b?.company_id) return error(400, "company_id required"); return json(await store.addCompanyToGroup(b.company_id, id)); }
        if (method === "DELETE") { const coid = segments[4]; if (!coid) return error(400, "company id required"); await store.removeCompanyFromGroup(coid, id); return json({ ok: true }); }
      }
      if (!id) {
        if (method === "GET") return json({ groups: await store.listGroups(qp("project_id")) });
        if (method === "POST") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ group: await store.createGroup(b) }, 201); }
        return error(405, "method not allowed");
      }
      if (method === "GET") { const g = await store.getGroup(id); return g ? json({ group: g }) : error(404, "group not found"); }
      if (method === "PATCH" || method === "PUT") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); const g = await store.updateGroup(id, b); return g ? json({ group: g }) : error(404, "group not found"); }
      if (method === "DELETE") return (await store.deleteGroup(id)) ? json({ deleted: true, id }) : error(404, "group not found");
      return error(405, "method not allowed");
    }

    // ── /v1/vendor-comms ──
    if (resource === "vendor-comms") {
      if (id === "missing-invoices" && method === "GET") return json({ communications: await store.listMissingInvoices() });
      if (id === "pending-follow-ups" && method === "GET") return json({ communications: await store.listPendingFollowUps() });
      if (id && sub === "mark-done" && method === "POST") { const c = await store.markFollowUpDone(id); return c ? json({ communication: c }) : error(404, "not found"); }
      if (!id) {
        if (method === "GET") { const companyId = qp("company_id"); if (!companyId) return error(400, "company_id required"); return json({ communications: await store.listVendorCommunications(companyId, { type: qp("type"), status: qp("status"), direction: qp("direction") }) }); }
        if (method === "POST") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ communication: await store.logVendorCommunication(b) }, 201); }
      }
      return error(405, "method not allowed");
    }

    // ── /v1/org-members ──
    if (resource === "org-members") {
      if (!id) {
        if (method === "GET") { if (qp("contact_id")) return json({ org_members: await store.listOrgMembersForContact(qp("contact_id")!) }); if (qp("company_id")) return json({ org_members: await store.listOrgMembers(qp("company_id")!) }); return error(400, "company_id or contact_id required"); }
        if (method === "POST") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ org_member: await store.addOrgMember(b) }, 201); }
        return error(405, "method not allowed");
      }
      if (method === "PATCH" || method === "PUT") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); const m = await store.updateOrgMember(id, b); return m ? json({ org_member: m }) : error(404, "not found"); }
      if (method === "DELETE") return (await store.removeOrgMember(id)) ? json({ deleted: true, id }) : error(404, "not found");
      return error(405, "method not allowed");
    }

    // ── /v1/notes ──
    if (resource === "notes") {
      if (!id) {
        if (method === "GET") { const cid = qp("contact_id"); if (!cid) return error(400, "contact_id required"); return json({ notes: qp("company_id") ? await store.listNotesForContactAtCompany(cid, qp("company_id")!) : await store.listNotes(cid) }); }
        if (method === "POST") { const b = await readJson<{ contact_id: string; body: string; created_by?: string; company_id?: string }>(req); if (!b?.contact_id || !b?.body) return error(400, "contact_id and body required"); return json({ note: await store.addNote(b.contact_id, b.body, b.created_by, b.company_id) }, 201); }
        return error(405, "method not allowed");
      }
      if (method === "DELETE") { await store.deleteNote(id); return json({ ok: true }); }
      return error(405, "method not allowed");
    }

    // ── /v1/relationships & /v1/company-relationships ──
    if (resource === "relationships") {
      if (!id) {
        if (method === "GET") return json({ relationships: await store.listRelationships({ contact_id: qp("contact_id") }) });
        if (method === "POST") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ relationship: await store.createRelationship(b) }, 201); }
      }
      if (method === "DELETE" && id) { await store.deleteRelationship(id); return json({ ok: true }); }
      return error(405, "method not allowed");
    }
    if (resource === "company-relationships") {
      if (!id) {
        if (method === "GET") return json({ relationships: await store.listCompanyRelationships({ contact_id: qp("contact_id"), company_id: qp("company_id") }) });
        if (method === "POST") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ relationship: await store.createCompanyRelationship(b) }, 201); }
      }
      if (method === "DELETE" && id) { await store.deleteCompanyRelationship(id); return json({ ok: true }); }
      return error(405, "method not allowed");
    }

    // ── /v1/learnings ──
    if (resource === "learnings") {
      if (id === "search" && method === "GET") return json({ learnings: await store.searchLearnings(qp("q") ?? "", { type: qp("type"), contact_id: qp("contact_id") }) });
      if (id === "stale" && method === "GET") return json({ learnings: await store.getStaleLearnings(qn("days_old") ?? 30, qn("min_confidence") ?? 0) });
      if (id === "maintenance" && method === "POST") return json(await store.runLearningMaintenance());
      if (id && sub === "confirm" && method === "POST") { await store.confirmLearning(id); return json({ ok: true }); }
      return error(404, "unknown /v1/learnings route");
    }

    // ── /v1/locks & /v1/activity ──
    if (resource === "locks") {
      if (id && method === "GET") { const l = await store.checkContactLock(id); return json({ lock: l }); }
      if (!id && method === "POST") { const b = await readJson<{ contact_id: string; agent_name: string; ttl_seconds?: number; reason?: string; session_id?: string }>(req); if (!b) return error(400, "invalid JSON body"); return json(await store.acquireContactLock(b.contact_id, b.agent_name, b.ttl_seconds, b.reason, b.session_id)); }
      if (id && method === "DELETE") { const released = await store.releaseContactLock(id, qp("agent_name") ?? ""); return json({ released }); }
      return error(405, "method not allowed");
    }
    if (resource === "activity") {
      if (method === "GET") { const cid = qp("contact_id"); if (!cid) return error(400, "contact_id required"); return json({ activity: await store.getAgentActivity(cid, qn("limit") ?? 20) }); }
      if (method === "POST") { const b = await readJson<{ contact_id: string; agent_name: string; action: string; details?: string; session_id?: string }>(req); if (!b) return error(400, "invalid JSON body"); await store.logAgentActivity(b.contact_id, b.agent_name, b.action, b.details, b.session_id); return json({ ok: true }, 201); }
      return error(405, "method not allowed");
    }

    // ── /v1/identity ──
    if (resource === "identity") {
      if (id === "resolve" && method === "POST") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ matches: await store.resolveContactIdentity(b) }); }
      if (!id) {
        if (method === "GET") { const cid = qp("contact_id"); if (!cid) return error(400, "contact_id required"); return json({ identities: await store.getContactIdentities(cid) }); }
        if (method === "POST") { const b = await readJson<{ contact_id: string; system: string; external_id: string; external_url?: string; confidence?: "verified" | "inferred" }>(req); if (!b) return error(400, "invalid JSON body"); return json({ identity: await store.addContactIdentity(b.contact_id, b.system, b.external_id, b.external_url, b.confidence) }, 201); }
      }
      return error(405, "method not allowed");
    }

    // ── /v1/signals ──
    if (resource === "signals") {
      if (id === "ghost" && method === "GET") return json({ signals: await store.getGhostContacts() });
      if (id === "warming" && method === "GET") return json({ signals: await store.getWarmingContacts() });
      if (id === "recompute" && method === "POST") return json(await store.recomputeSignals());
      if (!id && method === "GET") { const cid = qp("contact_id"); if (!cid) return error(400, "contact_id required"); return json({ signals: await store.getRelationshipSignals(cid) }); }
      return error(405, "method not allowed");
    }

    // ── /v1/freshness ──
    if (resource === "freshness") {
      if (id === "stale" && method === "GET") return json({ contacts: await store.getStaleContacts(qn("threshold") ?? 40) });
      if (id === "verify" && method === "POST") { const b = await readJson<{ contact_id: string; field_name: string; source?: string }>(req); if (!b) return error(400, "invalid JSON body"); await store.markFieldVerified(b.contact_id, b.field_name, b.source); return json({ ok: true }); }
      if (id && method === "GET") return json({ freshness: await store.getFreshnessScore(id) });
      return error(405, "method not allowed");
    }

    // ── /v1/graph ──
    if (resource === "graph") {
      if (id === "strength" && sub && method === "GET") return json({ strength: await store.computeRelationshipStrength(sub) });
      if (id === "warm-path" && method === "GET") return json({ path: await store.findWarmPath(qp("from") ?? "", qp("to") ?? "") });
      if (id === "company" && sub && method === "GET") return json({ connections: await store.findConnectionsAtCompany(sub) });
      if (id === "cooling" && method === "GET") return json({ cooling: await store.detectCoolingRelationships() });
      return error(404, "unknown /v1/graph route");
    }

    // ── /v1/org-chart ──
    if (resource === "org-chart") {
      if (id === "coverage" && sub && method === "GET") return json({ coverage: await store.getCoverageGaps(sub) });
      if (!id) {
        if (method === "GET") { const cid = qp("company_id"); if (!cid) return error(400, "company_id required"); return json({ edges: await store.listOrgChart(cid) }); }
        if (method === "POST") { const b = await readJson<{ company_id: string; contact_a_id: string; contact_b_id: string; edge_type: string; inferred?: boolean }>(req); if (!b) return error(400, "invalid JSON body"); return json({ edge: await store.addOrgChartEdge(b.company_id, b.contact_a_id, b.contact_b_id, b.edge_type, b.inferred) }, 201); }
      }
      return error(405, "method not allowed");
    }

    // ── /v1/audiences ──
    if (resource === "audiences") {
      if (id && sub === "resolve" && method === "GET") return json({ resolution: await store.resolveAudience(id, qp("channel") ?? "email") });
      if (!id) {
        if (method === "GET") return json({ audiences: await store.listAudiences() });
        if (method === "POST") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ audience: await store.createAudience(b) }, 201); }
        return error(405, "method not allowed");
      }
      if (method === "GET") return json({ audience: await store.getAudience(id) });
      if (method === "PATCH" || method === "PUT") { const b = await readJson<Record<string, unknown>>(req); if (!b) return error(400, "invalid JSON body"); return json({ audience: await store.updateAudience(id, b) }); }
      if (method === "DELETE") { await store.deleteAudience(id); return json({ deleted: true, id }); }
      return error(405, "method not allowed");
    }

    // ── /v1/consent ──
    if (resource === "consent") {
      if (method === "GET") { const cid = qp("contact_id"); if (!cid) return error(400, "contact_id required"); return json({ consent: await store.listContactConsent(cid) }); }
      if (method === "POST") { const b = await readJson<{ contact_id: string; channel: string; status: string; source?: string }>(req); if (!b) return error(400, "invalid JSON body"); return json({ consent: await store.setContactConsent(b.contact_id, b.channel, b.status, b.source) }); }
      return error(405, "method not allowed");
    }

    // ── /v1/suppressions ──
    if (resource === "suppressions") {
      if (method === "GET") return json({ suppressions: await store.listSuppressions({ channel: qp("channel"), unsyncedOnly: qp("unsynced") === "1" || qp("unsynced") === "true" }) });
      if (method === "POST") { const b = await readJson<{ channel: string; address: string; contact_id?: string; reason?: string }>(req); if (!b) return error(400, "invalid JSON body"); return json({ suppression: await store.suppressAddress(b) }, 201); }
      if (method === "DELETE") { const channel = qp("channel"); const address = qp("address"); if (!channel || !address) return error(400, "channel and address required"); await store.unsuppressAddress(channel, address); return json({ ok: true }); }
      return error(405, "method not allowed");
    }

    // ── field history / job history direct ──
    if (resource === "field-history" && method === "GET") {
      const cid = qp("contact_id"); if (!cid) return error(400, "contact_id required");
      if (id === "at") return json({ fields: await store.getContactAt(cid, qp("timestamp") ?? new Date().toISOString()) });
      return json({ history: await store.getFieldHistory(cid, qp("field_name")) });
    }
    if (resource === "job-history") {
      if (method === "GET") { const cid = qp("contact_id"); if (!cid) return error(400, "contact_id required"); return json({ job_history: await store.getJobHistory(cid) }); }
      if (method === "POST") { const b = await readJson<Record<string, unknown> & { contact_id: string }>(req); if (!b?.contact_id) return error(400, "contact_id required"); return json({ job: await store.addJobEntry(b.contact_id, b) }, 201); }
    }

    // ── derived collections ──
    if (resource === "cold-contacts" && method === "GET") return json({ contacts: await store.listColdContacts(qn("days") ?? 30) });
    if (resource === "not-contacted" && method === "GET") return json({ contacts: await store.listContactsNotContactedSince(qn("days") ?? 90, qn("limit") ?? 50) });
    if (resource === "followup-due-contacts" && method === "GET") return json({ contacts: await store.listFollowupDueContacts(qp("on_or_before") ?? new Date().toISOString()) });
    if (resource === "contacts-for-context" && method === "GET") return json({ contacts: await store.findContactsForContext(qp("topic") ?? "", qn("limit") ?? 20) });
    if (resource === "email-duplicates" && method === "GET") return json({ duplicates: await store.findEmailDuplicates() });
    if (resource === "name-duplicates" && method === "GET") return json({ duplicates: await store.findNameDuplicates() });
    if (resource === "contact-audit" && method === "GET") return json({ audit: await store.listContactAudit() });
    if (resource === "upcoming" && method === "GET") return json({ items: await store.getUpcomingItems(qn("days") ?? 7) });
    if (resource === "network-stats" && method === "GET") return json({ stats: await store.getNetworkStats() });
    if (resource === "recent-events" && method === "GET") return json({ events: await store.getRecentContactEvents(qp("since"), qp("types") ? qp("types")!.split(",") : undefined) });
    if (resource === "vault-status" && method === "GET") return json({ vault: await store.vaultStatus() });
    if (resource === "assemble-context" && method === "POST") { const b = await readJson<{ contact_ids: string[]; format?: string }>(req); if (!b) return error(400, "invalid JSON body"); return json({ context: await store.assembleContext(b.contact_ids ?? [], b.format ?? "meeting_prep") }); }

    return error(404, `unknown /v1 resource: ${resource ?? "(root)"}`);
  } catch (e) {
    const msg = (e as Error).message || "internal error";
    if (e instanceof ContactProjectMembershipConflictError) return error(409, msg);
    // Foreign-key / constraint violations surface as 400 to the client.
    if (/violates|constraint|invalid input|duplicate key/i.test(msg)) return error(400, msg);
    return error(500, msg);
  }
}
