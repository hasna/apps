/**
 * OpenAPI 3 document for the secrets serve API. Single source of truth for the
 * `/openapi.json` route and the reference shape of the typed SDK client
 * (src/sdk/client.ts), whose method surface mirrors these paths.
 */

export function buildOpenApiDocument(version: string): Record<string, unknown> {
  const secretMetadata = {
    type: "object",
    required: ["key", "type", "created_at", "updated_at"],
    properties: {
      key: { type: "string" },
      type: { type: "string", enum: ["api_key", "password", "token", "credential", "other"] },
      label: { type: "string", nullable: true },
      expires_at: { type: "string", nullable: true },
      created_at: { type: "string" },
      updated_at: { type: "string" },
    },
  };
  const secret = {
    type: "object",
    required: ["key", "value", "type"],
    properties: {
      key: { type: "string" },
      value: { type: "string" },
      type: { type: "string" },
      label: { type: "string", nullable: true },
      expires_at: { type: "string", nullable: true },
      created_at: { type: "string" },
      updated_at: { type: "string" },
    },
  };
  const vaultItemMetadata = {
    type: "object",
    required: ["id", "kind", "title", "domains", "tags", "favorite", "created_at", "updated_at"],
    properties: {
      id: { type: "string" },
      kind: { type: "string" },
      title: { type: "string" },
      subtitle: { type: "string", nullable: true },
      domains: { type: "array", items: { type: "string" } },
      tags: { type: "array", items: { type: "string" } },
      favorite: { type: "boolean" },
      created_at: { type: "string" },
      updated_at: { type: "string" },
    },
  };
  const vaultItem = {
    allOf: [
      { $ref: "#/components/schemas/VaultItemMetadata" },
      { type: "object", required: ["data"], properties: { data: { type: "object", additionalProperties: true } } },
    ],
  };
  const status = {
    type: "object",
    required: ["status", "version", "mode"],
    properties: {
      status: { type: "string" },
      version: { type: "string" },
      mode: { type: "string" },
    },
  };
  const secretVersionMeta = {
    type: "object",
    required: ["version", "change_kind", "created_at", "created_by", "value_length", "fingerprint", "current"],
    properties: {
      version: { type: "integer" },
      change_kind: { type: "string", enum: ["initial", "set", "rotation", "import", "restore", "migration"] },
      reason: { type: "string", nullable: true },
      label: { type: "string", nullable: true },
      created_at: { type: "string" },
      created_by: { type: "string" },
      source_version: { type: "integer", nullable: true },
      batch_id: { type: "string", nullable: true },
      provider_expires_at: { type: "string", nullable: true },
      value_length: { type: "integer" },
      fingerprint: { type: "string", description: "Short keyed fingerprint (16 hex chars); never value material" },
      current: { type: "boolean" },
    },
  };
  const secretVersionCheck = {
    allOf: [
      { $ref: "#/components/schemas/SecretVersionMeta" },
      {
        type: "object",
        required: ["hash"],
        properties: { hash: { type: "string", description: "sha256 of the value — same evidence class as get --check" } },
      },
    ],
  };
  const restoreInput = {
    type: "object",
    required: ["key", "version", "reason", "expected_current_version"],
    properties: {
      key: { type: "string" },
      version: { type: "integer" },
      reason: {
        type: "string",
        description: "Operator note recorded on the new version. Length-bounded and scanned at the store boundary; credential-shaped content is refused with 400.",
      },
      expected_current_version: {
        type: "integer",
        description: "Required. The current version the caller expects; restore is refused with 409 when it differs (concurrency CAS).",
      },
    },
  };

  return {
    openapi: "3.0.3",
    info: { title: "SecretsApi", version, description: "Hasna secrets vault HTTP API" },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Status: status,
        ReadyStatus: {
          allOf: [
            { $ref: "#/components/schemas/Status" },
            { type: "object", properties: { pendingMigrations: { type: "array", items: { type: "string" } } } },
          ],
        },
        SecretMetadata: secretMetadata,
        Secret: secret,
        VaultDecryptionError: {
          type: "object",
          required: ["error", "code", "recovery"],
          properties: {
            error: { type: "string" },
            code: { type: "string", enum: ["VAULT_DECRYPTION_FAILED"] },
            recovery: { type: "string" },
          },
        },
        SecretInput: {
          type: "object",
          required: ["key", "value"],
          properties: {
            key: { type: "string" },
            value: { type: "string" },
            type: { type: "string", enum: ["api_key", "password", "token", "credential", "other"] },
            label: { type: "string", description: "Length-bounded and scanner-checked at the store boundary; credential-shaped content is refused with 400" },
            ttl: { type: "string", description: "e.g. 30d, 24h, 60m" },
            reason: { type: "string", description: "Operator reason recorded on the created version. Length-bounded and scanner-checked at the store boundary; credential-shaped content is refused with 400" },
            change_kind: { type: "string", enum: ["initial", "set", "rotation", "import", "restore", "migration"] },
            batch_id: { type: "string" },
          },
        },
        SecretVersionMeta: secretVersionMeta,
        SecretVersionCheck: secretVersionCheck,
        RestoreInput: restoreInput,
        VaultItemMetadata: vaultItemMetadata,
        VaultItem: vaultItem,
        VaultItemInput: {
          type: "object",
          required: ["kind", "title", "data"],
          properties: {
            id: { type: "string" },
            kind: { type: "string" },
            title: { type: "string" },
            subtitle: { type: "string" },
            domains: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            favorite: { type: "boolean" },
            data: { type: "object", additionalProperties: true },
          },
        },
        UserInput: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            type: { type: "string", enum: ["human", "agent"] },
          },
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/health": { get: { operationId: "health", summary: "Liveness probe", security: [], responses: r("#/components/schemas/Status") } },
      "/ready": { get: { operationId: "ready", summary: "Readiness probe", security: [], responses: r("#/components/schemas/ReadyStatus") } },
      "/version": { get: { operationId: "version", summary: "Version info", security: [], responses: r("#/components/schemas/Status") } },
      "/v1/secrets": {
        get: {
          operationId: "listSecrets",
          summary: "List secret metadata",
          parameters: [{ name: "namespace", in: "query", required: false, schema: { type: "string" } }],
          responses: r("#/components/schemas/SecretMetadata", true, "secrets"),
        },
        post: {
          operationId: "putSecret",
          summary: "Create or update a secret",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/SecretInput" } } } },
          responses: r("#/components/schemas/SecretMetadata"),
        },
        delete: {
          operationId: "deleteSecret",
          summary: "Delete a secret by key",
          parameters: [{ name: "key", in: "query", required: true, schema: { type: "string" } }],
          responses: okResponse(),
        },
      },
      "/v1/secrets/get": {
        get: {
          operationId: "getSecret",
          summary: "Get a secret value by key",
          parameters: [{ name: "key", in: "query", required: true, schema: { type: "string" } }],
          responses: {
            ...r("#/components/schemas/Secret"),
            "422": {
              description: "The configured master key cannot decrypt the stored value",
              content: { "application/json": { schema: { $ref: "#/components/schemas/VaultDecryptionError" } } },
            },
          },
        },
      },
      "/v1/secrets/search": {
        get: {
          operationId: "searchSecrets",
          summary: "Search secret metadata",
          parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
          responses: r("#/components/schemas/SecretMetadata", true, "results"),
        },
      },
      "/v1/secrets/versions": {
        get: {
          operationId: "listSecretVersions",
          summary: "List version metadata (never value material)",
          parameters: [
            { name: "key", in: "query", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: r("#/components/schemas/SecretVersionMeta", true, "versions"),
        },
      },
      "/v1/secrets/versions/check": {
        get: {
          operationId: "checkSecretVersion",
          summary: "Version evidence in the get --check class (length + sha256)",
          parameters: [
            { name: "key", in: "query", required: true, schema: { type: "string" } },
            { name: "version", in: "query", required: true, schema: { type: "integer" } },
          ],
          responses: r("#/components/schemas/SecretVersionCheck", true, "check"),
        },
      },
      "/v1/secrets/restore": {
        post: {
          operationId: "restoreSecretVersion",
          summary: "Append-only restore: copy a historical value server-side into a new current version",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/RestoreInput" } } } },
          responses: {
            ...r("#/components/schemas/SecretVersionMeta", true, "restored"),
            "404": { description: "Key or version not found; zero mutation" },
            "409": { description: "expected_current_version mismatch; zero mutation" },
          },
        },
      },
      "/v1/items": {
        get: {
          operationId: "listItems",
          summary: "List vault item metadata",
          parameters: [{ name: "kind", in: "query", required: false, schema: { type: "string" } }],
          responses: r("#/components/schemas/VaultItemMetadata", true, "items"),
        },
        post: {
          operationId: "putItem",
          summary: "Create or update a vault item",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/VaultItemInput" } } } },
          responses: r("#/components/schemas/VaultItem"),
        },
      },
      "/v1/items/search": {
        get: {
          operationId: "searchItems",
          summary: "Search vault item metadata",
          parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
          responses: r("#/components/schemas/VaultItemMetadata", true, "results"),
        },
      },
      "/v1/items/{id}": {
        get: {
          operationId: "getItem",
          summary: "Get a vault item with decrypted payload",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: r("#/components/schemas/VaultItem"),
        },
        delete: {
          operationId: "deleteItem",
          summary: "Delete a vault item",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: okResponse(),
        },
      },
      "/v1/audit": {
        get: {
          operationId: "listAudit",
          summary: "List audit log entries",
          parameters: [
            { name: "key", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: okResponse(),
        },
      },
      "/v1/users": {
        get: {
          operationId: "listUsers",
          summary: "List registered users",
          parameters: [{ name: "type", in: "query", required: false, schema: { type: "string" } }],
          responses: okResponse(),
        },
        post: {
          operationId: "registerUser",
          summary: "Register a user or agent",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/UserInput" } } } },
          responses: okResponse(),
        },
      },
    },
  };
}

function r(ref: string, wrapArray = false, wrapKey = "data"): Record<string, unknown> {
  const schema = wrapArray
    ? { type: "object", properties: { [wrapKey]: { type: "array", items: { $ref: ref } } } }
    : { $ref: ref };
  return { "200": { description: "OK", content: { "application/json": { schema } } } };
}

function okResponse(): Record<string, unknown> {
  return { "200": { description: "OK", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } };
}
