#!/usr/bin/env bun
// @bun

// src/serve.ts
import { readFileSync as readFileSync2 } from "fs";
import { verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";

// src/generated/storage-kit/mode.ts
var DEPRECATED_STORAGE_MODE_ALIASES = [
  "remote",
  "hybrid",
  "self_hosted"
];
function normalizeStorageMode(value) {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "local")
    return { mode: "local", deprecatedAlias: null };
  if (normalized === "cloud")
    return { mode: "cloud", deprecatedAlias: null };
  if (DEPRECATED_STORAGE_MODE_ALIASES.includes(normalized)) {
    return { mode: "cloud", deprecatedAlias: normalized };
  }
  throw new Error(`Unknown storage mode: ${value}. Use local or cloud.`);
}
function envToken(name) {
  return name.toUpperCase().replace(/-/g, "_");
}
function storageEnvKeys(name) {
  const token = envToken(name);
  return {
    modeKeys: [`HASNA_${token}_STORAGE_MODE`, `${token}_STORAGE_MODE`],
    databaseUrlKeys: [`HASNA_${token}_DATABASE_URL`, `${token}_DATABASE_URL`]
  };
}
function firstEnv(env, keys) {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value)
      return { key, value };
  }
  return null;
}
function resolveStorageMode(name, env = process.env) {
  const { modeKeys, databaseUrlKeys } = storageEnvKeys(name);
  const dbHit = firstEnv(env, databaseUrlKeys);
  const databaseUrlPresent = Boolean(dbHit);
  const databaseUrlSource = dbHit ? dbHit.key : null;
  const modeHit = firstEnv(env, modeKeys);
  if (!modeHit) {
    return {
      mode: "local",
      source: "default",
      deprecatedAlias: null,
      databaseUrlPresent,
      databaseUrlSource,
      warning: null
    };
  }
  const { mode, deprecatedAlias } = normalizeStorageMode(modeHit.value);
  const warnings = [];
  if (deprecatedAlias) {
    warnings.push(`Deprecated storage mode '${deprecatedAlias}' from ${modeHit.key} is treated as 'cloud'. Set ${modeKeys[0]}=cloud instead.`);
  }
  if (mode === "cloud" && !databaseUrlPresent) {
    warnings.push(`cloud mode needs ${databaseUrlKeys[0]} (PURE REMOTE: reads and writes go to cloud Postgres).`);
  }
  if (modeHit.key !== modeKeys[0]) {
    warnings.push(`Using alias env ${modeHit.key}; the canonical key is ${modeKeys[0]}.`);
  }
  return {
    mode,
    source: modeHit.key,
    deprecatedAlias,
    databaseUrlPresent,
    databaseUrlSource,
    warning: warnings.length > 0 ? warnings.join(" ") : null
  };
}
function resolveDatabaseUrl(name, env = process.env) {
  const { databaseUrlKeys } = storageEnvKeys(name);
  const hit = firstEnv(env, databaseUrlKeys);
  return hit ? hit.value : null;
}
// src/generated/storage-kit/tls.ts
import { readFileSync } from "fs";
function sslModeFromConnectionString(connectionString) {
  const queryStart = connectionString.indexOf("?");
  const params = new URLSearchParams(queryStart === -1 ? "" : connectionString.slice(queryStart + 1));
  const sslmode = params.get("sslmode")?.trim().toLowerCase();
  if (sslmode) {
    switch (sslmode) {
      case "disable":
      case "prefer":
      case "require":
      case "verify-ca":
      case "verify-full":
        return sslmode;
      case "allow":
        return "prefer";
      default:
        throw new Error(`Unknown sslmode '${sslmode}' in connection string.`);
    }
  }
  const ssl = params.get("ssl")?.trim().toLowerCase();
  if (ssl && ["1", "true", "yes", "on", "require"].includes(ssl))
    return "require";
  return "disable";
}
function loadCaBundle(options) {
  const env = options.env ?? process.env;
  if (options.ca && options.ca.trim())
    return options.ca;
  const path = options.caCertPath ?? env.PGSSLROOTCERT ?? env.NODE_EXTRA_CA_CERTS;
  if (path && path.trim())
    return readFileSync(path.trim(), "utf8");
  return null;
}
function resolveTlsConfig(connectionString, options = {}) {
  const mode = sslModeFromConnectionString(connectionString);
  if (mode === "disable") {
    return;
  }
  const ca = loadCaBundle(options);
  if (mode === "prefer" || mode === "require") {
    return ca ? { rejectUnauthorized: false, ca } : { rejectUnauthorized: false };
  }
  if (!ca) {
    throw new Error(`sslmode=${mode} requires a CA bundle. Set PGSSLROOTCERT (or pass caCertPath/ca) to the ` + `Amazon RDS global bundle: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`);
  }
  return { rejectUnauthorized: true, ca };
}
// src/generated/storage-kit/query.ts
function wrapExecutor(executor) {
  return {
    async query(sql, params) {
      const result = await executor.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    },
    async many(sql, params) {
      const result = await executor.query(sql, params);
      return result.rows;
    },
    async get(sql, params) {
      const result = await executor.query(sql, params);
      return result.rows[0] ?? null;
    },
    async one(sql, params) {
      const result = await executor.query(sql, params);
      if (result.rows.length !== 1) {
        throw new Error(`Expected exactly one row, got ${result.rows.length}.`);
      }
      return result.rows[0];
    },
    async execute(sql, params) {
      await executor.query(sql, params);
    }
  };
}
function createQueryClient(pool) {
  const base = wrapExecutor(pool);
  return {
    ...base,
    pool,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrapExecutor(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {}
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    }
  };
}
// src/generated/storage-kit/pool.ts
import pg from "pg";
function createPgPool(options) {
  const ssl = resolveTlsConfig(options.connectionString, {
    ...options.ca !== undefined ? { ca: options.ca } : {},
    ...options.caCertPath !== undefined ? { caCertPath: options.caCertPath } : {},
    ...options.env !== undefined ? { env: options.env } : {}
  });
  const config = { connectionString: options.connectionString };
  if (ssl !== undefined)
    config.ssl = ssl;
  if (options.max !== undefined)
    config.max = options.max;
  if (options.idleTimeoutMillis !== undefined)
    config.idleTimeoutMillis = options.idleTimeoutMillis;
  if (options.connectionTimeoutMillis !== undefined)
    config.connectionTimeoutMillis = options.connectionTimeoutMillis;
  if (options.applicationName !== undefined)
    config.application_name = options.applicationName;
  return new pg.Pool(config);
}
function createCloudPoolFromEnv(appName, options = {}) {
  const env = options.env ?? process.env;
  const resolution = resolveStorageMode(appName, env);
  if (resolution.mode !== "cloud") {
    throw new Error(`createCloudPoolFromEnv requires ${appName} storage mode 'cloud', got '${resolution.mode}'. ` + `Set HASNA_${appName.toUpperCase().replace(/-/g, "_")}_STORAGE_MODE=cloud.`);
  }
  const connectionString = resolveDatabaseUrl(appName, env);
  if (!connectionString) {
    throw new Error(`cloud mode for ${appName} needs a database URL. Set ` + `HASNA_${appName.toUpperCase().replace(/-/g, "_")}_DATABASE_URL.`);
  }
  const pool = createPgPool({
    connectionString,
    ...options.ca !== undefined ? { ca: options.ca } : {},
    ...options.caCertPath !== undefined ? { caCertPath: options.caCertPath } : {},
    env,
    ...options.max !== undefined ? { max: options.max } : {},
    ...options.idleTimeoutMillis !== undefined ? { idleTimeoutMillis: options.idleTimeoutMillis } : {},
    ...options.connectionTimeoutMillis !== undefined ? { connectionTimeoutMillis: options.connectionTimeoutMillis } : {},
    ...options.applicationName !== undefined ? { applicationName: options.applicationName } : {}
  });
  return {
    client: createQueryClient(pool),
    connectionSource: resolution.databaseUrlSource ?? "unknown"
  };
}
// src/db/remote-storage.ts
var KNOWLEDGE_APP_NAME = "knowledge";
function createKnowledgeCloudClient() {
  return createCloudPoolFromEnv(KNOWLEDGE_APP_NAME, { applicationName: "@hasna/knowledge" }).client;
}

// src/remote-client.ts
var REMOTE_KNOWLEDGE_CONTRACT_VERSION = 1;
function knowledgeRegistryContract(input) {
  return {
    contract_version: REMOTE_KNOWLEDGE_CONTRACT_VERSION,
    service: "open-knowledge",
    mode: input.mode,
    capabilities: [
      "registry",
      "search",
      "ask",
      "build",
      "sync",
      "status",
      "logs",
      "artifacts",
      "open-files-source-refs",
      "s3-generated-artifacts"
    ],
    endpoints: {
      registry: "/api/v1/knowledge/registry",
      search: "/api/v1/knowledge/search",
      ask: "/api/v1/knowledge/ask",
      build: "/api/v1/knowledge/build",
      sync: "/api/v1/knowledge/sync",
      run_status: "/api/v1/knowledge/runs/{run_id}",
      run_logs: "/api/v1/knowledge/runs/{run_id}/logs",
      run_artifacts: "/api/v1/knowledge/runs/{run_id}/artifacts"
    },
    source_contract: {
      owner: "open-files",
      preferred_ref: "open-files",
      allowed_schemes: input.sourceSchemes,
      raw_source_bytes_stored_in_open_knowledge: false
    },
    artifact_contract: {
      storage_type: input.storageType,
      uri_prefix: input.artifactUriPrefix,
      generated_only: true
    }
  };
}

// src/workspace.ts
import { dirname, join, resolve } from "path";
var HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "knowledge");
var LEGACY_HASNA_KNOWLEDGE_APP_PATH = join(".hasna", "apps", "knowledge");

// src/store.ts
function makeId() {
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function makeShortId(id) {
  return id.replace(/^k_/, "").slice(0, 12);
}

// src/serve.ts
var KNOWLEDGE_SERVE_APP = "knowledge";
function normalizeCloudDatabaseUrl(env = process.env) {
  const key = "HASNA_KNOWLEDGE_DATABASE_URL";
  const url = env[key] ?? env.KNOWLEDGE_DATABASE_URL;
  if (!url)
    return url;
  const lower = url.toLowerCase();
  const needsCompat = (lower.includes("sslmode=require") || lower.includes("sslmode=prefer")) && !lower.includes("uselibpqcompat");
  if (!needsCompat)
    return url;
  const updated = url.includes("?") ? `${url}&uselibpqcompat=true` : `${url}?uselibpqcompat=true`;
  env[key] = updated;
  return updated;
}
function resolveVersion() {
  if (process.env.HASNA_KNOWLEDGE_VERSION)
    return process.env.HASNA_KNOWLEDGE_VERSION;
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync2(url, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return process.env.npm_package_version ?? "0.0.0";
  }
}
function resolveSigningSecret(env = process.env) {
  const secret = env.HASNA_KNOWLEDGE_API_SIGNING_KEY ?? env.API_KEY_SIGNING_SECRET ?? env.HASNA_API_SIGNING_KEY;
  if (!secret) {
    throw new Error("knowledge-serve requires an API signing secret: set HASNA_KNOWLEDGE_API_SIGNING_KEY " + "(or API_KEY_SIGNING_SECRET / HASNA_API_SIGNING_KEY).");
  }
  return secret;
}
function rowToItem(row) {
  const parseJson = (value, fallback) => {
    if (value == null)
      return fallback;
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    }
    return value;
  };
  return {
    id: String(row.id),
    short_id: row.short_id ?? null,
    title: String(row.title ?? ""),
    content: String(row.content ?? ""),
    url: row.url ?? null,
    tags: parseJson(row.tags, []),
    metadata: parseJson(row.metadata, {}),
    archived: Boolean(row.archived),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

class NoteRepo {
  client;
  constructor(client) {
    this.client = client;
  }
  async create(input) {
    if (!input.title || typeof input.title !== "string") {
      throw new HttpError(400, "title is required");
    }
    const id = makeId();
    const now = new Date().toISOString();
    const row = await this.client.get(`INSERT INTO knowledge_items (id, short_id, title, content, url, tags, metadata, archived, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,FALSE,$8,$9)
       RETURNING *`, [
      id,
      makeShortId(id),
      input.title,
      input.content ?? "",
      input.url ?? null,
      JSON.stringify(input.tags ?? []),
      JSON.stringify(input.metadata ?? {}),
      now,
      now
    ]);
    return rowToItem(row);
  }
  async list(options = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const where = [];
    const params = [];
    if (!options.includeArchived)
      where.push("archived = FALSE");
    if (options.search) {
      params.push(`%${options.search}%`);
      where.push(`(title ILIKE $${params.length} OR content ILIKE $${params.length})`);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const totalRow = await this.client.get(`SELECT count(*)::text AS count FROM knowledge_items ${whereSql}`, params);
    const rows = await this.client.many(`SELECT * FROM knowledge_items ${whereSql} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    return { items: rows.map(rowToItem), total: Number(totalRow?.count ?? 0) };
  }
  async get(idOrShort) {
    const row = await this.client.get(`SELECT * FROM knowledge_items WHERE id = $1 OR short_id = $1 LIMIT 1`, [idOrShort]);
    return row ? rowToItem(row) : null;
  }
  async update(idOrShort, patch) {
    const existing = await this.get(idOrShort);
    if (!existing)
      return null;
    const sets = [];
    const params = [];
    const push = (col, val, cast = "") => {
      params.push(val);
      sets.push(`${col} = $${params.length}${cast}`);
    };
    if (patch.title !== undefined)
      push("title", patch.title);
    if (patch.content !== undefined)
      push("content", patch.content);
    if (patch.url !== undefined)
      push("url", patch.url);
    if (patch.tags !== undefined)
      push("tags", JSON.stringify(patch.tags), "::jsonb");
    if (patch.metadata !== undefined)
      push("metadata", JSON.stringify(patch.metadata), "::jsonb");
    if (patch.archived !== undefined)
      push("archived", patch.archived);
    push("updated_at", new Date().toISOString());
    params.push(existing.id);
    const row = await this.client.get(`UPDATE knowledge_items SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`, params);
    return row ? rowToItem(row) : null;
  }
  async delete(idOrShort) {
    const existing = await this.get(idOrShort);
    if (!existing)
      return false;
    await this.client.execute(`DELETE FROM knowledge_items WHERE id = $1`, [existing.id]);
    return true;
  }
}
function knowledgeOpenApi(version) {
  const noteSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      short_id: { type: "string", nullable: true },
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      archived: { type: "boolean" },
      created_at: { type: "string" },
      updated_at: { type: "string" }
    },
    required: ["id", "title", "content", "tags", "archived", "created_at", "updated_at"]
  };
  const noteInput = {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true }
    },
    required: ["title"]
  };
  const notePatch = {
    type: "object",
    properties: {
      title: { type: "string" },
      content: { type: "string" },
      url: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      metadata: { type: "object", additionalProperties: true },
      archived: { type: "boolean" }
    }
  };
  return {
    openapi: "3.0.3",
    info: { title: "Knowledge", version, description: "@hasna/knowledge self-hosted HTTP API" },
    components: {
      securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "x-api-key" } },
      schemas: {
        Note: noteSchema,
        NoteInput: noteInput,
        NotePatch: notePatch,
        NoteList: {
          type: "object",
          properties: {
            items: { type: "array", items: { $ref: "#/components/schemas/Note" } },
            total: { type: "integer" }
          },
          required: ["items", "total"]
        }
      }
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/notes": {
        get: {
          operationId: "listNotes",
          summary: "List knowledge items",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "search", in: "query", schema: { type: "string" } }
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/NoteList" } } } }
          }
        },
        post: {
          operationId: "createNote",
          summary: "Create a knowledge item",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/NoteInput" } } }
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Note" } } } }
          }
        }
      },
      "/v1/notes/{id}": {
        get: {
          operationId: "getNote",
          summary: "Fetch a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Note" } } } }
          }
        },
        patch: {
          operationId: "updateNote",
          summary: "Update a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/NotePatch" } } }
          },
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Note" } } } }
          }
        },
        delete: {
          operationId: "deleteNote",
          summary: "Delete a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "204": {} }
        }
      },
      "/v1/registry": {
        get: {
          operationId: "getRegistry",
          summary: "Knowledge registry contract",
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }
          }
        }
      }
    }
  };
}

class HttpError extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
function createServeHandler(deps) {
  const repo = new NoteRepo(deps.client);
  const mode2 = "cloud";
  const authOrThrow = async (req, requiredScopes) => {
    const url = new URL(req.url);
    const decision = await deps.verifier.authenticate(req.headers, {
      method: req.method,
      path: url.pathname,
      requiredScopes
    });
    if (decision.ok === false) {
      throw new HttpError(decision.status, decision.message);
    }
    deps.store.touchLastUsed(decision.principal.kid).catch(() => {});
    return decision.principal;
  };
  return async (req) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();
    try {
      if (path === "/health" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode: mode2 });
      }
      if (path === "/version" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode: mode2 });
      }
      if (path === "/ready" && method === "GET") {
        try {
          await deps.client.query("SELECT 1");
          return json({ status: "ready", version: deps.version, mode: mode2 });
        } catch {
          return json({ status: "unavailable", version: deps.version, mode: mode2 }, 503);
        }
      }
      if (path === "/openapi.json" && method === "GET") {
        return json(knowledgeOpenApi(deps.version));
      }
      if (path === "/v1/registry" && method === "GET") {
        await authOrThrow(req, ["knowledge:read"]);
        return json(knowledgeRegistryContract({
          mode: "hosted",
          sourceSchemes: ["open-files", "s3", "web", "file"],
          storageType: "s3",
          artifactUriPrefix: process.env.HASNA_KNOWLEDGE_S3_PREFIX ?? null
        }));
      }
      if (path === "/v1/notes") {
        if (method === "GET") {
          await authOrThrow(req, ["knowledge:read"]);
          const result = await repo.list({
            limit: url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined,
            offset: url.searchParams.has("offset") ? Number(url.searchParams.get("offset")) : undefined,
            search: url.searchParams.get("search") ?? undefined,
            includeArchived: url.searchParams.get("includeArchived") === "true"
          });
          return json(result);
        }
        if (method === "POST") {
          await authOrThrow(req, ["knowledge:write"]);
          const body = await req.json().catch(() => ({}));
          const item = await repo.create(body);
          return json(item, 201);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      const noteMatch = path.match(/^\/v1\/notes\/([^/]+)$/);
      if (noteMatch) {
        const id = decodeURIComponent(noteMatch[1]);
        if (method === "GET") {
          await authOrThrow(req, ["knowledge:read"]);
          const item = await repo.get(id);
          return item ? json(item) : json({ error: "not_found" }, 404);
        }
        if (method === "PATCH") {
          await authOrThrow(req, ["knowledge:write"]);
          const body = await req.json().catch(() => ({}));
          const item = await repo.update(id, body);
          return item ? json(item) : json({ error: "not_found" }, 404);
        }
        if (method === "DELETE") {
          await authOrThrow(req, ["knowledge:write"]);
          const ok = await repo.delete(id);
          return ok ? new Response(null, { status: 204 }) : json({ error: "not_found" }, 404);
        }
        return json({ error: "method_not_allowed" }, 405);
      }
      return json({ error: "not_found", path }, 404);
    } catch (error) {
      if (error instanceof HttpError) {
        const reason = error.status === 401 || error.status === 403 ? "unauthorized" : "error";
        return json({ error: reason, message: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : "internal error";
      return json({ error: "internal", message }, 500);
    }
  };
}
async function startKnowledgeServe(options = {}) {
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? env.HASNA_KNOWLEDGE_SERVE_PORT ?? 8080);
  const hostname = options.hostname ?? env.HOST ?? "0.0.0.0";
  const version = resolveVersion();
  normalizeCloudDatabaseUrl(env);
  const client = createKnowledgeCloudClient();
  const store = new ApiKeyStore(client);
  const verifier = verifyApiKey({
    app: KNOWLEDGE_SERVE_APP,
    signingSecret: resolveSigningSecret(env),
    isRevoked: store.isRevoked,
    audit: (e) => {
      if (e.outcome === "deny") {
        console.warn(`[knowledge-serve] auth deny kid=${e.kid ?? "-"} reason=${e.reason} ${e.method} ${e.path}`);
      }
    }
  });
  const handler = createServeHandler({ client, verifier, store, version });
  const BunGlobal = globalThis.Bun;
  if (!BunGlobal?.serve) {
    throw new Error("knowledge-serve requires the Bun runtime (Bun.serve unavailable).");
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler });
  console.log(`[knowledge-serve] listening on http://${hostname}:${server.port} (mode=cloud, version=${version})`);
  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop();
      await client.close();
    }
  };
}

// src/serve-entry.ts
var running = await startKnowledgeServe();
var shutdown = async (signal) => {
  console.log(`[knowledge-serve] received ${signal}, shutting down`);
  await running.stop();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
