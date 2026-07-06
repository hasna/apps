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
import { getCloudClient, getCloudVerifier, ensureCloudSchemaBestEffort, CONTACTS_APP_SLUG } from "./cloud.js";
import { getContactsPgStore } from "./pg-store.js";

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

  const segments = path.split("/").filter(Boolean); // ["v1", resource, id?]
  const resource = segments[1];
  const id = segments[2];

  try {
    // ── /v1/contacts ──
    if (resource === "contacts") {
      if (!id) {
        if (method === "GET") {
          const result = await store.listContacts({
            ...(url.searchParams.get("company_id") ? { company_id: url.searchParams.get("company_id")! } : {}),
            ...(url.searchParams.get("status") ? { status: url.searchParams.get("status")! } : {}),
            ...(url.searchParams.get("q") ? { q: url.searchParams.get("q")! } : {}),
            ...(url.searchParams.get("limit") ? { limit: Number(url.searchParams.get("limit")) } : {}),
            ...(url.searchParams.get("offset") ? { offset: Number(url.searchParams.get("offset")) } : {}),
          });
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
          const tags = await store.listTags();
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

    return error(404, `unknown /v1 resource: ${resource ?? "(root)"}`);
  } catch (e) {
    const msg = (e as Error).message || "internal error";
    // Foreign-key / constraint violations surface as 400 to the client.
    if (/violates|constraint|invalid input|duplicate key/i.test(msg)) return error(400, msg);
    return error(500, msg);
  }
}
