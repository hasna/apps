import { describe, expect, test } from "bun:test";
import { buildV1OpenApiDocument } from "./openapi.js";
import { resolveCloudDatabaseUrl, resolveSigningSecret, isCloudModeEnabled, CONTACTS_APP_SLUG } from "./cloud.js";
import { ContactsPgStore } from "./pg-store.js";
import { contactListFilterFromUrl } from "./v1.js";
import { PG_MIGRATIONS } from "../db/pg-migrations.js";
import type { PoolQueryClient } from "../generated/storage-kit/query.js";

// ── OpenAPI document is the SDK source of truth ──
describe("buildV1OpenApiDocument", () => {
  const doc = buildV1OpenApiDocument("9.9.9");

  test("declares the v1 CRUD surface", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("9.9.9");
    for (const p of ["/v1/contacts", "/v1/contacts/{id}", "/v1/companies", "/v1/tags", "/v1/stats"]) {
      expect(doc.paths).toHaveProperty(p);
    }
    expect(doc.paths).toHaveProperty("/v1/contacts/{contact_id}/tags/{tag_id}");
    expect(doc.paths).toHaveProperty("/v1/contacts/{contact_id}/projects");
    expect(doc.paths).toHaveProperty("/v1/contacts/{contact_id}/projects/{project_id}");
    expect(doc.paths).toHaveProperty("/v1/projects/{project_id}/contacts");
    expect(doc.paths["/v1/tags"].get.parameters).toContainEqual({
      name: "name",
      in: "query",
      schema: { type: "string" },
    });
    expect(doc.paths["/v1/contacts"].get.parameters).toContainEqual({
      name: "tag_id",
      in: "query",
      schema: { type: "string" },
    });
    expect(doc.components.schemas.Contact.properties.tags).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/Tag" },
    });
    expect(doc.components.schemas.Contact.required).toContain("tags");
    expect(doc.paths["/v1/contacts/{contact_id}/tags/{tag_id}"].put.operationId).toBe("addTagToContact");
    expect(doc.paths["/v1/contacts/{contact_id}/tags/{tag_id}"].delete.operationId).toBe("removeTagFromContact");
    expect(doc.paths["/v1/contacts/{contact_id}/projects"].get.operationId).toBe("getContactProjectIds");
    expect(doc.paths["/v1/contacts/{contact_id}/projects"].put.operationId).toBe("setContactProjects");
    expect(doc.paths["/v1/contacts/{contact_id}/projects/{project_id}"].put.operationId).toBe("linkContactToProject");
    expect(doc.paths["/v1/contacts/{contact_id}/projects/{project_id}"].delete.operationId).toBe("unlinkContactFromProject");
    expect(doc.paths["/v1/projects/{project_id}/contacts"].get.operationId).toBe("listContactIdsByProject");
  });

  test("requires api-key security", () => {
    expect(doc.components.securitySchemes.apiKey).toMatchObject({ type: "apiKey", in: "header", name: "x-api-key" });
    expect(doc.security).toEqual([{ apiKey: [] }]);
  });

  test("every operation has an operationId (needed for SDK generation)", () => {
    const ids: string[] = [];
    for (const item of Object.values(doc.paths)) {
      for (const op of Object.values(item as Record<string, { operationId?: string }>)) {
        if (op.operationId) ids.push(op.operationId);
      }
    }
    expect(ids).toContain("listContacts");
    expect(ids).toContain("createContact");
    expect(ids).toContain("createCompany");
    expect(new Set(ids).size).toBe(ids.length); // unique
  });
});

describe("contactListFilterFromUrl", () => {
  test("passes tag_id and pagination from the HTTP query to the store filter", () => {
    const url = new URL(
      "https://contacts.example/v1/contacts?tag_id=tag-1&company_id=company-1&status=active&q=Ada&limit=10&offset=5",
    );

    expect(contactListFilterFromUrl(url)).toEqual({
      company_id: "company-1",
      status: "active",
      tag_id: "tag-1",
      q: "Ada",
      limit: 10,
      offset: 5,
    });
  });
});

// ── Env resolution (A1 pure-remote wiring) ──
describe("cloud env resolution", () => {
  test("resolveCloudDatabaseUrl honors precedence", () => {
    expect(resolveCloudDatabaseUrl({ HASNA_CONTACTS_DATABASE_URL: "a", CONTACTS_DATABASE_URL: "b", DATABASE_URL: "c" } as never)).toBe("a");
    expect(resolveCloudDatabaseUrl({ CONTACTS_DATABASE_URL: "b", DATABASE_URL: "c" } as never)).toBe("b");
    expect(resolveCloudDatabaseUrl({ DATABASE_URL: "c" } as never)).toBe("c");
    expect(resolveCloudDatabaseUrl({} as never)).toBeUndefined();
  });

  test("resolveSigningSecret honors precedence", () => {
    expect(resolveSigningSecret({ HASNA_CONTACTS_API_SIGNING_KEY: "x", HASNA_API_SIGNING_KEY: "y" } as never)).toBe("x");
    expect(resolveSigningSecret({ HASNA_API_SIGNING_KEY: "y" } as never)).toBe("y");
    expect(resolveSigningSecret({} as never)).toBeUndefined();
  });

  test("isCloudModeEnabled reflects DSN presence", () => {
    expect(isCloudModeEnabled({ DATABASE_URL: "c" } as never)).toBe(true);
    expect(isCloudModeEnabled({ HASNA_CONTACTS_STORAGE_MODE: "cloud" } as never)).toBe(true);
    expect(isCloudModeEnabled({ CONTACTS_STORAGE_MODE: "self_hosted" } as never)).toBe(true);
    expect(isCloudModeEnabled({ HASNA_CONTACTS_STORAGE_MODE: "local" } as never)).toBe(false);
    expect(isCloudModeEnabled({} as never)).toBe(false);
  });

  test("app slug is contacts", () => {
    expect(CONTACTS_APP_SLUG).toBe("contacts");
  });
});

// ── ContactsPgStore issues correct SQL and maps rows (shim client, no live DB) ──
function shim(rows: Record<string, unknown>[]): { client: PoolQueryClient; calls: { sql: string; params: unknown[] }[] } {
  const calls: { sql: string; params: unknown[] }[] = [];
  const record = <T>(sql: string, params: readonly unknown[] = []): T => {
    calls.push({ sql, params: [...params] });
    return undefined as T;
  };
  const client = {
    async query<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      return { rows: rows as T[], rowCount: rows.length };
    },
    async many<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      return rows as T[];
    },
    async get<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      return (rows[0] ?? null) as T | null;
    },
    async one<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      return rows[0] as T;
    },
    async execute(sql: string, params?: readonly unknown[]) {
      record(sql, params);
    },
    pool: {} as never,
    async transaction() {
      throw new Error("not used");
    },
    async close() {},
  } as unknown as PoolQueryClient;
  return { client, calls };
}

function taggedContactShim(options: { contacts?: Record<string, unknown>[]; tags?: Record<string, unknown>[] } = {}): {
  client: PoolQueryClient;
  calls: { sql: string; params: unknown[] }[];
} {
  const calls: { sql: string; params: unknown[] }[] = [];
  const defaultContact = {
    id: "contact-1", first_name: "Ada", last_name: "Lovelace", display_name: "Ada Lovelace",
    nickname: null, avatar_url: null, notes: null, birthday: null, company_id: null,
    job_title: null, source: "manual", custom_fields: "{}", last_contacted_at: null,
    website: null, preferred_contact_method: null, status: "active", follow_up_at: null,
    archived: false, project_id: null, sensitivity: "normal", do_not_contact: false,
    priority: 3, timezone: null, created_at: "2026-07-22T00:00:00.000Z", updated_at: "2026-07-22T00:00:00.000Z",
  };
  const defaultTag = {
    contact_id: "contact-1", id: "tag-1", name: "monthly accounting", color: "#6366f1",
    description: null, created_at: "2026-07-22T00:00:00.000Z",
  };
  const contacts = options.contacts ?? [defaultContact];
  const tags = options.tags ?? [defaultTag];
  const record = (sql: string, params: readonly unknown[] = []) => calls.push({ sql, params: [...params] });
  const client = {
    async query<T>(sql: string, params?: readonly unknown[]) { record(sql, params); return { rows: [], rowCount: 0 } as { rows: T[]; rowCount: number }; },
    async many<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      if (sql.includes("SELECT ct.contact_id, t.*")) return tags as T[];
      if (sql.includes("SELECT * FROM contacts")) return contacts as T[];
      return [] as T[];
    },
    async get<T>(sql: string, params?: readonly unknown[]) {
      record(sql, params);
      if (sql.includes("COUNT(*)")) return { count: String(contacts.length) } as T;
      if (sql.includes("INSERT INTO contacts") || sql.startsWith("UPDATE contacts")) return (contacts[0] ?? null) as T | null;
      if (sql.includes("FROM contacts WHERE id")) return (contacts[0] ?? null) as T;
      return null;
    },
    async one<T>(sql: string, params?: readonly unknown[]) { record(sql, params); return contacts[0] as T; },
    async execute(sql: string, params?: readonly unknown[]) { record(sql, params); },
    pool: {} as never,
    async transaction() { throw new Error("not used"); },
    async close() {},
  } as unknown as PoolQueryClient;
  return { client, calls };
}

describe("ContactsPgStore", () => {
  test("createContact derives display_name from first/last and maps the row", async () => {
    const now = "2026-07-06T00:00:00.000Z";
    const { client, calls } = shim([
      {
        id: "c1", first_name: "Ada", last_name: "Lovelace", display_name: "Ada Lovelace",
        nickname: null, avatar_url: null, notes: null, birthday: null, company_id: null,
        job_title: null, source: "manual", custom_fields: "{}", last_contacted_at: null,
        website: null, preferred_contact_method: null, status: "active", follow_up_at: null,
        archived: false, project_id: null, sensitivity: "normal", do_not_contact: false,
        priority: 3, timezone: null, created_at: now, updated_at: now,
      },
    ]);
    const store = new ContactsPgStore(client);
    const contact = await store.createContact({ first_name: "Ada", last_name: "Lovelace" });
    expect(contact.display_name).toBe("Ada Lovelace");
    expect(contact.custom_fields).toEqual({});
    expect(contact.created_at).toBe(now);
    // the derived display_name landed in the INSERT params
    expect(calls[0]!.sql).toContain("INSERT INTO contacts");
    expect(calls[0]!.params).toContain("Ada Lovelace");
  });

  test("createContact returns the advertised empty tags membership shape", async () => {
    const { client, calls } = taggedContactShim({ tags: [] });
    const store = new ContactsPgStore(client);

    const contact = await store.createContact({ first_name: "Ada", last_name: "Lovelace" });

    expect({ contact }).toEqual(expect.objectContaining({
      contact: expect.objectContaining({ tags: [] }),
    }));
    expect(calls.some((call) => call.sql.includes("SELECT ct.contact_id, t.*"))).toBe(true);
  });

  test("listContacts builds a tsquery filter and parameterizes limit/offset", async () => {
    const { client, calls } = shim([{ count: "0" }]);
    const store = new ContactsPgStore(client);
    await store.listContacts({ q: "widget", limit: 10, offset: 5 });
    const listCall = calls.find((c) => c.sql.includes("SELECT * FROM contacts"));
    expect(listCall).toBeDefined();
    expect(listCall!.sql).toContain("plainto_tsquery");
    expect(listCall!.params).toContain("widget");
    expect(listCall!.params).toContain(10);
    expect(listCall!.params).toContain(5);
  });

  test("updateContact with no fields is a no-op read", async () => {
    const { client, calls } = shim([]);
    const store = new ContactsPgStore(client);
    await store.updateContact("c1", {});
    // should SELECT, never UPDATE, when there are no changed columns
    expect(calls.every((c) => !c.sql.startsWith("UPDATE"))).toBe(true);
  });

  test("looks up tags by exact name with a parameterized query", async () => {
    const now = "2026-07-22T00:00:00.000Z";
    const { client, calls } = shim([{ id: "tag-1", name: "monthly accounting", color: "#6366f1", description: null, created_at: now }]);
    const store = new ContactsPgStore(client);

    expect(await store.getTagByName("monthly accounting")).toMatchObject({
      id: "tag-1",
      name: "monthly accounting",
    });
    expect(calls[0]).toEqual({
      sql: "SELECT * FROM tags WHERE name = $1",
      params: ["monthly accounting"],
    });
  });

  test("attaches a tag idempotently without a local database fallback", async () => {
    const { client, calls } = shim([]);
    const store = new ContactsPgStore(client);

    await store.addTagToContact("contact-1", "tag-1");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.sql).toContain("INSERT INTO contact_tags (contact_id, tag_id)");
    expect(calls[0]!.sql).toContain("ON CONFLICT (contact_id, tag_id) DO NOTHING");
    expect(calls[0]!.params).toEqual(["contact-1", "tag-1"]);
  });

  test("getContact returns cloud tag memberships", async () => {
    const { client, calls } = taggedContactShim();
    const store = new ContactsPgStore(client);

    const contact = await store.getContact("contact-1");

    expect(contact).toEqual(expect.objectContaining({
      id: "contact-1",
      tags: [expect.objectContaining({ id: "tag-1", name: "monthly accounting" })],
    }));
    expect(calls.find((call) => call.sql.includes("SELECT ct.contact_id, t.*"))?.params).toEqual([["contact-1"]]);
  });

  test("getContact returns an empty tags array when the contact has no memberships", async () => {
    const { client } = taggedContactShim({ tags: [] });
    const store = new ContactsPgStore(client);

    expect(await store.getContact("contact-1")).toEqual(expect.objectContaining({
      id: "contact-1",
      tags: [],
    }));
  });

  test("updateContact preserves and returns tag memberships", async () => {
    const { client, calls } = taggedContactShim();
    const store = new ContactsPgStore(client);

    const contact = await store.updateContact("contact-1", { job_title: "Programmer" });

    expect({ contact }).toEqual(expect.objectContaining({
      contact: expect.objectContaining({
        id: "contact-1",
        tags: [expect.objectContaining({ id: "tag-1", name: "monthly accounting" })],
      }),
    }));
    expect(calls.find((call) => call.sql.startsWith("UPDATE contacts"))?.params).toEqual(["contact-1", "Programmer"]);
  });

  test("listContacts applies tag_id to data and count queries and returns tags", async () => {
    const { client, calls } = taggedContactShim();
    const store = new ContactsPgStore(client);

    const listed = await store.listContacts({ tag_id: "tag-1", limit: 10, offset: 5 });

    expect(listed).toEqual({
      count: 1,
      contacts: [expect.objectContaining({
        id: "contact-1",
        tags: [expect.objectContaining({ id: "tag-1", name: "monthly accounting" })],
      })],
    });
    const countCall = calls.find((call) => call.sql.includes("COUNT(*)"));
    const listCall = calls.find((call) => call.sql.includes("SELECT * FROM contacts"));
    const expectedTagFilter =
      "EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = contacts.id AND ct.tag_id = $1)";
    expect(countCall).toEqual({
      sql: expect.stringContaining(expectedTagFilter),
      params: ["tag-1"],
    });
    expect(listCall).toEqual({
      sql: expect.stringContaining(expectedTagFilter),
      params: ["tag-1", 10, 5],
    });
  });

  test("listContacts avoids a tag lookup when the filtered page is empty", async () => {
    const { client, calls } = taggedContactShim({ contacts: [], tags: [] });
    const store = new ContactsPgStore(client);

    expect(await store.listContacts({ tag_id: "tag-1" })).toEqual({ contacts: [], count: 0 });
    expect(calls.some((call) => call.sql.includes("SELECT ct.contact_id, t.*"))).toBe(false);
  });

  test("defines the forward tag-first index required by filtered count and pagination", () => {
    const tagFilterMigration = PG_MIGRATIONS.find((sql) =>
      sql.includes("idx_contact_tags_tag_contact"))!;

    expect(tagFilterMigration).toContain(
      "CREATE INDEX IF NOT EXISTS idx_contact_tags_tag_contact ON contact_tags(tag_id, contact_id)",
    );
    expect(tagFilterMigration).toContain("INSERT INTO _migrations (version) VALUES (13)");
  });
});
