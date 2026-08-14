/**
 * OpenAPI 3.1 document for the versioned `/v1` cloud API. This is the SINGLE
 * source of truth the typed SDK is generated from (see scripts/generate-sdk.ts)
 * and is served live at `GET /openapi.json` and `GET /v1/openapi.json`.
 */
import { getPackageVersion } from "../lib/package-version.js";

const configSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    slug: { type: "string" },
    kind: { type: "string" },
    category: { type: "string" },
    agent: { type: "string" },
    target_path: { type: "string", nullable: true },
    outputs: { type: "array", items: { type: "object" } },
    format: { type: "string" },
    content: { type: "string" },
    description: { type: "string", nullable: true },
    tags: { type: "array", items: { type: "string" } },
    is_template: { type: "boolean" },
    version: { type: "number" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
    synced_at: { type: "string", nullable: true },
  },
} as const;

const profileSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    slug: { type: "string" },
    description: { type: "string", nullable: true },
    selectors: { type: "object" },
    variables: { type: "object" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

export function buildV1OpenApiDocument(version = getPackageVersion()) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Instructions V1 API",
      version,
      description:
        "Versioned cloud API for @hasna/instructions (A1 pure-remote). Authenticate with an API key via the `x-api-key` header or `Authorization: Bearer <token>`. Reads require `instructions:read`, writes require `instructions:write` (an `instructions:*` key satisfies both).",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Config: configSchema,
        Profile: profileSchema,
        CreateConfigInput: {
          type: "object",
          required: ["name", "category", "content"],
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            content: { type: "string" },
            kind: { type: "string" },
            agent: { type: "string" },
            target_path: { type: "string" },
            format: { type: "string" },
            description: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            is_template: { type: "boolean" },
          },
        },
        UpdateConfigInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            category: { type: "string" },
            agent: { type: "string" },
            content: { type: "string" },
            description: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            is_template: { type: "boolean" },
          },
        },
        CreateProfileInput: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            selectors: { type: "object" },
            variables: { type: "object" },
          },
        },
        AddProfileConfigInput: {
          type: "object",
          required: ["config_id"],
          properties: {
            config_id: { type: "string" },
          },
        },
        ProfileConfigBindingSpec: {
          type: "object",
          required: ["schema", "activation", "required", "fallback"],
          properties: {
            schema: { type: "string", const: "hasna.instructions.profile-config-binding/v1" },
            activation: { type: "object" },
            required: { type: "boolean" },
            fallback: { type: "string", enum: ["fail", "flatten", "promote-always", "omit"] },
            providers: { type: "array", items: { type: "object" } },
            depends_on: { type: "array", items: { type: "string" } },
            replaces: { type: "array", items: { type: "string" } },
            conflicts_with: { type: "array", items: { type: "string" } },
          },
        },
        ProfileConfigBinding: {
          type: "object",
          required: ["profile_id", "config_id", "sort_order", "binding"],
          properties: {
            profile_id: { type: "string" },
            config_id: { type: "string" },
            sort_order: { type: "integer" },
            binding: { $ref: "#/components/schemas/ProfileConfigBindingSpec" },
          },
        },
        ProfileAssetBindingSpec: {
          type: "object",
          required: ["schema", "assetKey", "kind", "enabled", "required", "selector", "source", "destination", "uninstall", "rollback"],
          properties: {
            schema: { type: "string", const: "hasna.instructions.profile-asset-binding/v1" },
            assetKey: { type: "string", minLength: 1 },
            kind: { type: "string", enum: ["skill", "workflow", "plugin", "extension", "hook", "custom-agent"] },
            enabled: { type: "boolean" },
            required: { type: "boolean" },
            selector: {
              type: "object",
              required: ["provider", "versionRange", "surface", "scope"],
              properties: {
                provider: { type: "string" },
                versionRange: { type: "string" },
                surface: { type: "string" },
                scope: { type: "string", enum: ["global", "project", "session"] },
              },
            },
            source: {
              type: "object",
              required: ["kind", "locator", "digest", "immutable", "allowed"],
              properties: {
                kind: { type: "string", enum: ["skill", "workflow", "plugin", "extension", "hook", "custom-agent"] },
                locator: { type: "string" },
                digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
                immutable: { type: "boolean" },
                allowed: { type: "boolean" },
              },
            },
            destination: {
              type: "object",
              required: ["strategy", "root", "relativePath"],
              properties: {
                strategy: { type: "string", enum: ["emit-file", "install-local", "install-marketplace", "unsupported"] },
                root: { type: "string", enum: ["target-home", "project-root"] },
                relativePath: { type: "string", minLength: 1 },
              },
            },
            uninstall: { type: "string", enum: ["remove-managed", "retain"] },
            rollback: { type: "string", enum: ["snapshot", "installer-receipt", "none"] },
          },
        },
        ProfileAssetBinding: {
          type: "object",
          required: ["profile_id", "source_config_id", "sort_order", "binding"],
          properties: {
            profile_id: { type: "string" },
            source_config_id: { type: "string" },
            sort_order: { type: "integer" },
            binding: { $ref: "#/components/schemas/ProfileAssetBindingSpec" },
          },
        },
        AddProfileAssetInput: {
          type: "object",
          required: ["source_config_id", "binding"],
          properties: {
            source_config_id: { type: "string" },
            binding: { $ref: "#/components/schemas/ProfileAssetBindingSpec" },
          },
        },
        ProfileConfigAddedResponse: {
          type: "object",
          required: ["added"],
          properties: {
            added: { type: "boolean", const: true },
          },
        },
        ProfileConfigRemovedResponse: {
          type: "object",
          required: ["removed"],
          properties: {
            removed: { type: "boolean", const: true },
          },
        },
        ProfileWithConfigs: {
          type: "object",
          properties: {
            ...profileSchema.properties,
            configs: { type: "array", items: { $ref: "#/components/schemas/Config" } },
          },
        },
        BoundedProfilePage: {
          type: "object",
          required: ["items", "total", "limit", "cursor", "next_cursor", "has_more", "complete", "truncated", "source_bounded"],
          properties: {
            profiles: { type: "array", items: { $ref: "#/components/schemas/Profile" } },
            items: { type: "array", items: { $ref: "#/components/schemas/Profile" } },
            count: { type: "number" },
            total: { type: "number" },
            limit: { type: "number" },
            cursor: { type: "number" },
            next_cursor: { type: "number", nullable: true },
            has_more: { type: "boolean" },
            complete: { type: "boolean" },
            truncated: { type: "boolean", const: false },
            source_bounded: { type: "boolean" },
          },
        },
        BoundedConfigPage: {
          type: "object",
          required: ["items", "total", "limit", "cursor", "next_cursor", "has_more", "complete", "truncated", "source_bounded"],
          properties: {
            items: { type: "array", items: { $ref: "#/components/schemas/Config" } },
            total: { type: "number" },
            limit: { type: "number" },
            cursor: { type: "number" },
            next_cursor: { type: "number", nullable: true },
            has_more: { type: "boolean" },
            complete: { type: "boolean" },
            truncated: { type: "boolean", const: false },
            source_bounded: { type: "boolean" },
          },
        },
        ProfileShowResponse: {
          type: "object",
          required: ["profile", "configs"],
          properties: {
            profile: { $ref: "#/components/schemas/ProfileWithConfigs" },
            configs: { $ref: "#/components/schemas/BoundedConfigPage" },
          },
        },
        ProfileResolutionRead: {
          type: "object",
          required: ["profile", "scanned", "total", "batch_limit", "source_bounded", "complete", "truncated"],
          properties: {
            profile: { oneOf: [{ $ref: "#/components/schemas/Profile" }, { type: "null" }] },
            scanned: { type: "number", nullable: true },
            total: { type: "number", nullable: true },
            batch_limit: { type: "number", nullable: true },
            source_bounded: { type: "boolean" },
            complete: { type: "boolean", const: true },
            truncated: { type: "boolean", const: false },
          },
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/v1/configs": {
        get: {
          operationId: "listConfigs",
          summary: "List configs",
          parameters: [
            { name: "category", in: "query", schema: { type: "string" } },
            { name: "agent", in: "query", schema: { type: "string" } },
            { name: "kind", in: "query", schema: { type: "string" } },
            { name: "search", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      configs: { type: "array", items: { $ref: "#/components/schemas/Config" } },
                      count: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "createConfig",
          summary: "Create a config",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateConfigInput" } } },
          },
          responses: {
            "201": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { config: { $ref: "#/components/schemas/Config" } } },
                },
              },
            },
          },
        },
      },
      "/v1/configs/{id}": {
        get: {
          operationId: "getConfig",
          summary: "Get a config by id or slug",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { config: { $ref: "#/components/schemas/Config" } } },
                },
              },
            },
          },
        },
        patch: {
          operationId: "updateConfig",
          summary: "Update a config",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateConfigInput" } } },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { config: { $ref: "#/components/schemas/Config" } } },
                },
              },
            },
          },
        },
        delete: {
          operationId: "deleteConfig",
          summary: "Delete a config",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { deleted: { type: "boolean" }, id: { type: "string" } } },
                },
              },
            },
          },
        },
      },
      "/v1/configs/{id}/snapshots": {
        get: {
          operationId: "listSnapshots",
          summary: "List a config's version snapshots",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { snapshots: { type: "array", items: { type: "object" } }, count: { type: "number" } } } } } } },
        },
        post: {
          operationId: "createSnapshot",
          summary: "Snapshot a config's current content",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "201": { content: { "application/json": { schema: { type: "object", properties: { snapshot: { type: "object" } } } } } } },
        },
      },
      "/v1/profiles": {
        get: {
          operationId: "listProfiles",
          summary: "List profiles with producer-side bounds",
          parameters: [
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "cursor", in: "query", schema: { type: "integer", minimum: 0 } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/BoundedProfilePage" },
                },
              },
            },
          },
        },
        post: {
          operationId: "createProfile",
          summary: "Create a profile",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateProfileInput" } } },
          },
          responses: { "201": { content: { "application/json": { schema: { type: "object", properties: { profile: { $ref: "#/components/schemas/Profile" } } } } } } },
        },
      },
      "/v1/profiles/resolve": {
        get: {
          operationId: "resolveProfile",
          summary: "Resolve a machine profile by scanning producer-bounded batches",
          parameters: [
            { name: "hostname", in: "query", schema: { type: "string" } },
            { name: "os", in: "query", schema: { type: "string" } },
            { name: "arch", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProfileResolutionRead" },
                },
              },
            },
          },
        },
      },
      "/v1/profiles/{id}": {
        get: {
          operationId: "getProfile",
          summary: "Get a profile (with its configs) by id or slug",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
            { name: "cursor", in: "query", schema: { type: "integer", minimum: 0 } },
          ],
          responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ProfileShowResponse" } } } } },
        },
        delete: {
          operationId: "deleteProfile",
          summary: "Delete a profile",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { deleted: { type: "boolean" }, id: { type: "string" } } } } } } },
        },
      },
      "/v1/profiles/{id}/configs": {
        post: {
          operationId: "addConfigToProfile",
          summary: "Add a config to a profile",
          description: "Requires an API key with the `instructions:write` scope.",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AddProfileConfigInput" },
              },
            },
          },
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProfileConfigAddedResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/profiles/{id}/configs/{configId}": {
        put: {
          operationId: "setProfileConfigBinding",
          summary: "Set the schema-versioned binding for one profile config",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "configId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["binding"], properties: { binding: { $ref: "#/components/schemas/ProfileConfigBindingSpec" } } } } },
          },
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { binding: { $ref: "#/components/schemas/ProfileConfigBinding" } } } } } } },
        },
        delete: {
          operationId: "removeConfigFromProfile",
          summary: "Remove a config from a profile",
          description: "Requires an API key with the `instructions:write` scope.",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "configId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProfileConfigRemovedResponse" },
                },
              },
            },
          },
        },
      },
      "/v1/profiles/{id}/bindings": {
        get: {
          operationId: "getProfileConfigBindings",
          summary: "List schema-versioned config bindings for a profile",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { bindings: { type: "array", items: { $ref: "#/components/schemas/ProfileConfigBinding" } } } } } } } },
        },
      },
      "/v1/profiles/{id}/assets": {
        get: {
          operationId: "getProfileAssetBindings",
          summary: "List typed asset bindings for a profile",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { assets: { type: "array", items: { $ref: "#/components/schemas/ProfileAssetBinding" } } } } } } } },
        },
        post: {
          operationId: "addAssetToProfile",
          summary: "Add a content-addressed asset binding to a profile",
          security: [{ apiKey: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AddProfileAssetInput" } } } },
          responses: { "201": { content: { "application/json": { schema: { type: "object", properties: { asset: { $ref: "#/components/schemas/ProfileAssetBinding" } } } } } } },
        },
      },
      "/v1/profiles/{id}/assets/{assetKey}": {
        put: {
          operationId: "setProfileAssetBinding",
          summary: "Replace one schema-versioned profile asset binding",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "assetKey", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["binding"], properties: { binding: { $ref: "#/components/schemas/ProfileAssetBindingSpec" } } } } } },
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { asset: { $ref: "#/components/schemas/ProfileAssetBinding" } } } } } } },
        },
        delete: {
          operationId: "removeAssetFromProfile",
          summary: "Remove one managed asset binding from a profile",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "assetKey", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { removed: { type: "boolean", const: true } } } } } } },
        },
      },
      "/v1/stats": {
        get: {
          operationId: "getStats",
          summary: "Aggregate config counts by category",
          responses: { "200": { content: { "application/json": { schema: { type: "object", properties: { total: { type: "number" } } } } } } },
        },
      },
    },
  };
}
