#!/usr/bin/env bun
// @bun

// src/serve.ts
import { readFileSync } from "fs";

// src/anchored-fs.ts
import {
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "fs";
var DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
var FILE_READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;
var ANCHORED_FILESYSTEM_SUPPORT = Object.freeze({
  supportedPlatforms: ["linux", "darwin"],
  unsupportedBehavior: "fail-closed-before-filesystem-io"
});

// src/input-limits.ts
var DANGEROUS_DATA_KEYS = new Set(["__proto__", "prototype", "constructor"]);

// src/runtime-role.ts
var MAX_KNOWLEDGE_DIAGNOSTIC_BYTES = 384;
var CONTAINMENT_MESSAGES = {
  KNOWLEDGE_RUNTIME_INTENT_INVALID: "runtime intent was rejected before Knowledge I/O",
  KNOWLEDGE_CONFIG_INVALID: "configuration was rejected before Knowledge I/O",
  KNOWLEDGE_HOSTED_CONTAINED: "hosted capability is unavailable during Stage A",
  KNOWLEDGE_AUTHORITY_UNAVAILABLE: "trusted authority is unavailable during Stage A",
  KNOWLEDGE_PROJECT_FORBIDDEN: "project authority denied Knowledge access",
  KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED: "positive hosted authority is disabled during Stage A",
  KNOWLEDGE_OPERATOR_REQUIRED: "operator capability is required for this operation"
};

class KnowledgeContainmentError extends Error {
  code;
  status;
  role;
  surface;
  name = "KnowledgeContainmentError";
  constructor(code, status, role, surface, _detail) {
    const message = `${code}: ${CONTAINMENT_MESSAGES[code]}`;
    super(Buffer.byteLength(message) <= MAX_KNOWLEDGE_DIAGNOSTIC_BYTES ? message : `${code}: contained`);
    this.code = code;
    this.status = status;
    this.role = role;
    this.surface = surface;
  }
  toJSON() {
    const payload = {
      ok: false,
      code: this.code,
      status: this.status,
      role: this.role,
      surface: this.surface,
      message: this.message
    };
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_KNOWLEDGE_DIAGNOSTIC_BYTES) {
      return { ...payload, message: `${this.code}: contained` };
    }
    return payload;
  }
}
function authorityContainmentError(authority, surface = "server") {
  if (!authority || authority.trust === "missing" || authority.trust === "untrusted") {
    return new KnowledgeContainmentError("KNOWLEDGE_AUTHORITY_UNAVAILABLE", 503, "hosted-server", surface, "trusted tenant and project authority is unavailable");
  }
  if (authority.projectGrants.length === 0) {
    return new KnowledgeContainmentError("KNOWLEDGE_PROJECT_FORBIDDEN", 403, "hosted-server", surface, "the trusted principal has no Knowledge project grant");
  }
  return new KnowledgeContainmentError("KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED", 503, "hosted-server", surface, "positive hosted access is intentionally disabled during Stage A");
}

// src/serve.ts
function resolveVersion() {
  if (process.env.HASNA_KNOWLEDGE_VERSION)
    return process.env.HASNA_KNOWLEDGE_VERSION;
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(url, "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return process.env.npm_package_version ?? "0.0.0";
  }
}
function knowledgeOpenApi(version) {
  const containmentResponseRefs = {
    "403": { $ref: "#/components/responses/KnowledgeProjectForbidden" },
    "503": { $ref: "#/components/responses/KnowledgeUnavailable" }
  };
  const stageAOperation = {
    description: "Disabled during Stage A. Project-authority containment is evaluated before authentication; future positive authority is explicitly deferred.",
    deprecated: true,
    security: [],
    "x-knowledge-stage-a-containment": "pre-auth",
    "x-knowledge-operation-enabled": false
  };
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
    info: {
      title: "Knowledge",
      version,
      description: "@hasna/knowledge Stage-A contained HTTP API; data operations fail before authentication or datastore access."
    },
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
        },
        KnowledgeContainmentResponse: {
          type: "object",
          properties: {
            ok: { type: "boolean", enum: [false] },
            code: {
              type: "string",
              enum: [
                "KNOWLEDGE_AUTHORITY_UNAVAILABLE",
                "KNOWLEDGE_PROJECT_FORBIDDEN",
                "KNOWLEDGE_POSITIVE_AUTHORITY_DISABLED"
              ]
            },
            status: { type: "integer", enum: [403, 503] },
            role: { type: "string", enum: ["hosted-server"] },
            surface: { type: "string", enum: ["server"] },
            message: { type: "string" }
          },
          required: ["ok", "code", "status", "role", "surface", "message"]
        }
      },
      responses: {
        KnowledgeProjectForbidden: {
          description: "Trusted server-side authority has zero Knowledge project grants; evaluated before authentication.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/KnowledgeContainmentResponse" } }
          }
        },
        KnowledgeUnavailable: {
          description: "Authority is missing or untrusted, or positive hosted authority remains disabled; evaluated before authentication.",
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/KnowledgeContainmentResponse" } }
          }
        }
      }
    },
    security: [],
    paths: {
      "/v1/notes": {
        get: {
          ...stageAOperation,
          operationId: "listNotes",
          summary: "List knowledge items",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer" } },
            { name: "offset", in: "query", schema: { type: "integer" } },
            { name: "search", in: "query", schema: { type: "string" } }
          ],
          responses: {
            ...containmentResponseRefs
          }
        },
        post: {
          ...stageAOperation,
          operationId: "createNote",
          summary: "Create a knowledge item",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/NoteInput" } } }
          },
          responses: {
            ...containmentResponseRefs
          }
        }
      },
      "/v1/notes/{id}": {
        get: {
          ...stageAOperation,
          operationId: "getNote",
          summary: "Fetch a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            ...containmentResponseRefs
          }
        },
        patch: {
          ...stageAOperation,
          operationId: "updateNote",
          summary: "Update a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/NotePatch" } } }
          },
          responses: {
            ...containmentResponseRefs
          }
        },
        delete: {
          ...stageAOperation,
          operationId: "deleteNote",
          summary: "Delete a knowledge item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            ...containmentResponseRefs
          }
        }
      },
      "/v1/registry": {
        get: {
          ...stageAOperation,
          operationId: "getRegistry",
          summary: "Knowledge registry contract",
          responses: {
            ...containmentResponseRefs
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
  const internalDeps = deps;
  const mode = "contained";
  return async (req) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method.toUpperCase();
    try {
      if (path === "/health" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode });
      }
      if (path === "/version" && method === "GET") {
        return json({ status: "ok", version: deps.version, mode });
      }
      if (path === "/ready" && method === "GET") {
        const error = authorityContainmentError(internalDeps.authority, "server");
        const { status: httpStatus, ...containment } = error.toJSON();
        return json({
          status: "unavailable",
          http_status: httpStatus,
          version: deps.version,
          mode,
          ...containment
        }, 503);
      }
      if (path === "/openapi.json" && method === "GET") {
        return json(knowledgeOpenApi(deps.version));
      }
      if (path === "/v1/registry" || path === "/v1/notes" || path.startsWith("/v1/notes/")) {
        const error = authorityContainmentError(internalDeps.authority, "server");
        return json(error.toJSON(), error.status);
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
  const runtimeOptions = options;
  const env = options.env ?? process.env;
  const port = options.port ?? Number(env.PORT ?? env.HASNA_KNOWLEDGE_SERVE_PORT ?? 8080);
  const hostname = options.hostname ?? env.HOST ?? "0.0.0.0";
  const version = runtimeOptions.version ?? resolveVersion();
  const handler = createServeHandler({
    client: undefined,
    verifier: undefined,
    store: undefined,
    version
  });
  const BunGlobal = globalThis.Bun;
  if (!BunGlobal?.serve) {
    throw new Error("knowledge-serve requires the Bun runtime (Bun.serve unavailable).");
  }
  const server = BunGlobal.serve({ port, hostname, fetch: handler });
  console.log(`[knowledge-serve] listening on http://${hostname}:${server.port} (mode=contained, version=${version})`);
  return {
    port: server.port,
    hostname,
    stop: async () => {
      server.stop();
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
