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

const configSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "slug", "kind", "category", "agent", "target_path", "format", "output_count", "description", "tags", "is_template", "version", "updated_at"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    slug: { type: "string" },
    kind: { type: "string" },
    category: { type: "string" },
    agent: { type: "string" },
    target_path: { type: "string", nullable: true },
    format: { type: "string" },
    output_count: { type: "number" },
    description: { type: "string", nullable: true },
    tags: { type: "array", items: { type: "string" } },
    is_template: { type: "boolean" },
    version: { type: "number" },
    updated_at: { type: "string" },
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

const configIdentitySchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "slug", "kind", "category", "agent", "format", "is_template", "version", "created_at", "updated_at", "synced_at"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    slug: { type: "string" },
    kind: { type: "string" },
    category: { type: "string" },
    agent: { type: "string" },
    format: { type: "string" },
    is_template: { type: "boolean" },
    version: { type: "number" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
    synced_at: { type: "string", nullable: true },
  },
} as const;

const profileIdentitySchema = {
  type: "object",
  required: ["id", "name", "slug", "created_at", "updated_at"],
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    slug: { type: "string" },
    created_at: { type: "string" },
    updated_at: { type: "string" },
  },
} as const;

const machineSchema = {
  type: "object",
  required: ["id", "hostname", "os", "arch", "last_applied_at", "created_at"],
  properties: {
    id: { type: "string" },
    hostname: { type: "string" },
    os: { type: "string", nullable: true },
    arch: { type: "string", nullable: true },
    last_applied_at: { type: "string", nullable: true },
    created_at: { type: "string" },
  },
} as const;

const snapshotSchema = {
  type: "object",
  required: ["id", "config_id", "content", "version", "created_at"],
  properties: {
    id: { type: "string" },
    config_id: { type: "string" },
    content: { type: "string" },
    version: { type: "number" },
    created_at: { type: "string" },
  },
} as const;

const limitParameter = { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } } as const;
const cursorParameter = { name: "cursor", in: "query", schema: { type: "integer", minimum: 0, maximum: 100_000 } } as const;
const configViewParameter = {
  name: "view",
  in: "query",
  description: "Use summary for a content-free list projection, or identity for the smallest metadata-only projection.",
  schema: { type: "string", enum: ["summary", "identity"] },
} as const;
const identityViewParameter = {
  name: "view",
  in: "query",
  description: "Use identity for a metadata-only projection that omits instruction content, paths, outputs, and private profile fields.",
  schema: { type: "string", enum: ["identity"] },
} as const;
const idempotencyKeyParameter = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description: "Optional visible-ASCII request key (1-255 characters). Replays the first committed response for the same authenticated principal, operation, and canonical JSON body; reuse with a different body returns 409.",
  schema: { type: "string", minLength: 1, maxLength: 255, pattern: "^[!-~]+$" },
} as const;
const idempotencyConflictResponse = {
  description: "The Idempotency-Key was already used for a different request body.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["error", "code"],
        properties: {
          error: { type: "string" },
          code: { type: "string", const: "IDEMPOTENCY_KEY_REUSED" },
        },
      },
    },
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
        ConfigSummary: configSummarySchema,
        ConfigIdentity: configIdentitySchema,
        Profile: profileSchema,
        ProfileIdentity: profileIdentitySchema,
        Machine: machineSchema,
        ConfigSnapshot: snapshotSchema,
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
            expected_version: { type: "integer", minimum: 1, description: "Atomically require this current version; a mismatch returns 409 without changing the config or snapshots." },
            name: { type: "string" },
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
            synced_at: { type: "string", nullable: true },
          },
        },
        ConditionalUpdateConfigInput: {
          type: "object",
          required: ["expected_version"],
          properties: {
            expected_version: { type: "integer", minimum: 1, description: "Atomically require this current version; a mismatch returns 409 without changing the config or snapshots." },
            name: { type: "string" },
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
            synced_at: { type: "string", nullable: true },
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
        UpdateProfileInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string", nullable: true },
            selectors: { type: "object" },
            variables: { type: "object" },
          },
        },
        PruneSnapshotsInput: {
          type: "object",
          properties: {
            keep: { type: "integer", minimum: 0, default: 10 },
          },
        },
        MachineAppliedInput: {
          type: "object",
          required: ["hostname"],
          properties: {
            hostname: { type: "string" },
          },
        },
        FeedbackInput: {
          type: "object",
          required: ["message"],
          properties: {
            message: { type: "string" },
            email: { type: "string" },
            category: { type: "string" },
            version: { type: "string" },
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
        NativeAgentMetadata: {
          type: "object",
          additionalProperties: false,
          required: ["name", "description"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" },
            description: { type: "string", minLength: 1, maxLength: 4096, pattern: "^[^\r\n\u0000]+$" },
            frontmatter: {
              type: "string",
              maxLength: 16384,
              description: "Optional complete reviewed newline-terminated flat YAML header; runtime validation requires its name and description scalars to match the explicit metadata.",
            },
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
            nativeAgent: { $ref: "#/components/schemas/NativeAgentMetadata" },
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
            configs: { type: "array", items: { $ref: "#/components/schemas/Config" } },
            items: { type: "array", items: { $ref: "#/components/schemas/Config" } },
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
        BoundedConfigSummaryPage: {
          type: "object",
          required: ["items", "total", "limit", "cursor", "next_cursor", "has_more", "complete", "truncated", "source_bounded"],
          properties: {
            configs: { type: "array", items: { $ref: "#/components/schemas/ConfigSummary" } },
            items: { type: "array", items: { $ref: "#/components/schemas/ConfigSummary" } },
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
        BoundedConfigIdentityPage: {
          type: "object",
          required: ["items", "total", "limit", "cursor", "next_cursor", "has_more", "complete", "truncated", "source_bounded"],
          properties: {
            configs: { type: "array", items: { $ref: "#/components/schemas/ConfigIdentity" } },
            items: { type: "array", items: { $ref: "#/components/schemas/ConfigIdentity" } },
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
        BoundedProfileIdentityPage: {
          type: "object",
          required: ["items", "total", "limit", "cursor", "next_cursor", "has_more", "complete", "truncated", "source_bounded"],
          properties: {
            profiles: { type: "array", items: { $ref: "#/components/schemas/ProfileIdentity" } },
            items: { type: "array", items: { $ref: "#/components/schemas/ProfileIdentity" } },
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
        BoundedSnapshotPage: {
          type: "object",
          required: ["items", "total", "limit", "cursor", "next_cursor", "has_more", "complete", "truncated", "source_bounded"],
          properties: {
            snapshots: { type: "array", items: { $ref: "#/components/schemas/ConfigSnapshot" } },
            items: { type: "array", items: { $ref: "#/components/schemas/ConfigSnapshot" } },
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
        BoundedMachinePage: {
          type: "object",
          required: ["items", "total", "limit", "cursor", "next_cursor", "has_more", "complete", "truncated", "source_bounded"],
          properties: {
            machines: { type: "array", items: { $ref: "#/components/schemas/Machine" } },
            items: { type: "array", items: { $ref: "#/components/schemas/Machine" } },
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
        BoundedProfileConfigBindingPage: {
          type: "object",
          required: ["items", "total", "limit", "cursor", "next_cursor", "has_more", "complete", "truncated", "source_bounded"],
          properties: {
            bindings: { type: "array", items: { $ref: "#/components/schemas/ProfileConfigBinding" } },
            items: { type: "array", items: { $ref: "#/components/schemas/ProfileConfigBinding" } },
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
        BoundedProfileAssetBindingPage: {
          type: "object",
          required: ["items", "total", "limit", "cursor", "next_cursor", "has_more", "complete", "truncated", "source_bounded"],
          properties: {
            assets: { type: "array", items: { $ref: "#/components/schemas/ProfileAssetBinding" } },
            items: { type: "array", items: { $ref: "#/components/schemas/ProfileAssetBinding" } },
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
            { name: "search", in: "query", schema: { type: "string", maxLength: 512 } },
            limitParameter,
            cursorParameter,
            { name: "tag", in: "query", schema: { type: "array", items: { type: "string" } } },
            configViewParameter,
          ],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    anyOf: [
                      { $ref: "#/components/schemas/BoundedConfigPage" },
                      { $ref: "#/components/schemas/BoundedConfigSummaryPage" },
                      { $ref: "#/components/schemas/BoundedConfigIdentityPage" },
                    ],
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "createConfig",
          summary: "Create a config",
          parameters: [idempotencyKeyParameter],
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
            "409": idempotencyConflictResponse,
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
            "400": { description: "Invalid expected_version; must be a positive safe integer." },
            "409": { description: "CONFIG_VERSION_CONFLICT: expected_version no longer matches; config and snapshots are unchanged." },
            "200": {
              content: {
                "application/json": {
                  schema: { type: "object", properties: { config: { $ref: "#/components/schemas/Config" } } },
                },
              },
            },
          },
        },
        put: {
          operationId: "putConfig",
          summary: "Update a config via PUT",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateConfigInput" } } },
          },
          responses: {
            "400": { description: "Invalid expected_version; must be a positive safe integer." },
            "409": { description: "CONFIG_VERSION_CONFLICT: expected_version no longer matches; config and snapshots are unchanged." },
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
      "/v1/configs/{id}/conditional-update": {
        post: {
          operationId: "conditionalUpdateConfig",
          summary: "Atomically update a config only if its current version matches",
          description: "Requires expected_version. Older servers return 404 without changing the config. Clients must never retry through an unconditional update route.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ConditionalUpdateConfigInput" } } },
          },
          responses: {
            "200": {
              content: { "application/json": { schema: { type: "object", properties: { config: { $ref: "#/components/schemas/Config" } } } } },
            },
            "400": { description: "expected_version is required and must be a positive safe integer." },
            "404": { description: "Config not found, or conditional updates are unsupported by this server." },
            "409": { description: "CONFIG_VERSION_CONFLICT: config and snapshots are unchanged." },
          },
        },
      },
      "/v1/configs/{id}/snapshots": {
        get: {
          operationId: "listSnapshots",
          summary: "List a config's version snapshots",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            limitParameter,
            cursorParameter,
          ],
          responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/BoundedSnapshotPage" } } } } },
        },
        post: {
          operationId: "createSnapshot",
          summary: "Snapshot a config's current content",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            idempotencyKeyParameter,
          ],
          requestBody: {
            required: false,
            content: { "application/json": { schema: { type: "object", properties: { content: { type: "string" }, version: { type: "integer" } } } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { type: "object", properties: { snapshot: { $ref: "#/components/schemas/ConfigSnapshot" } } } } } },
            "409": idempotencyConflictResponse,
          },
        },
      },
      "/v1/configs/{id}/snapshots/prune": {
        post: {
          operationId: "pruneSnapshots",
          summary: "Prune older snapshots for a config",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: false,
            content: { "application/json": { schema: { $ref: "#/components/schemas/PruneSnapshotsInput" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", required: ["pruned"], properties: { pruned: { type: "integer" } } } } } },
          },
        },
      },
      "/v1/configs/{id}/snapshots/{version}": {
        get: {
          operationId: "getSnapshotByVersion",
          summary: "Get one config snapshot by version",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "version", in: "path", required: true, schema: { type: "integer" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { snapshot: { $ref: "#/components/schemas/ConfigSnapshot" } } } } } },
          },
        },
      },
      "/v1/profiles": {
        get: {
          operationId: "listProfiles",
          summary: "List profiles with producer-side bounds",
          parameters: [limitParameter, cursorParameter, identityViewParameter],
          responses: {
            "200": {
              content: {
                "application/json": {
                  schema: {
                    oneOf: [
                      { $ref: "#/components/schemas/BoundedProfilePage" },
                      { $ref: "#/components/schemas/BoundedProfileIdentityPage" },
                    ],
                  },
                },
              },
            },
          },
        },
        post: {
          operationId: "createProfile",
          summary: "Create a profile",
          parameters: [idempotencyKeyParameter],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateProfileInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { type: "object", properties: { profile: { $ref: "#/components/schemas/Profile" } } } } } },
            "409": idempotencyConflictResponse,
          },
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
        patch: {
          operationId: "updateProfile",
          summary: "Update a profile",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateProfileInput" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { profile: { $ref: "#/components/schemas/Profile" } } } } } },
          },
        },
        put: {
          operationId: "putProfile",
          summary: "Update a profile via PUT",
          description: "Compatibility update route. Like PATCH, omitted properties remain unchanged.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateProfileInput" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { profile: { $ref: "#/components/schemas/Profile" } } } } } },
          },
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
            idempotencyKeyParameter,
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
            "409": idempotencyConflictResponse,
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
            idempotencyKeyParameter,
          ],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", required: ["binding"], properties: { binding: { $ref: "#/components/schemas/ProfileConfigBindingSpec" } } } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { binding: { $ref: "#/components/schemas/ProfileConfigBinding" } } } } } },
            "409": idempotencyConflictResponse,
          },
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
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            limitParameter,
            cursorParameter,
          ],
          responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/BoundedProfileConfigBindingPage" } } } } },
        },
      },
      "/v1/profiles/{id}/assets": {
        get: {
          operationId: "getProfileAssetBindings",
          summary: "List typed asset bindings for a profile",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            limitParameter,
            cursorParameter,
          ],
          responses: { "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/BoundedProfileAssetBindingPage" } } } } },
        },
        post: {
          operationId: "addAssetToProfile",
          summary: "Add a content-addressed asset binding to a profile",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            idempotencyKeyParameter,
          ],
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/AddProfileAssetInput" } } } },
          responses: {
            "201": { content: { "application/json": { schema: { type: "object", properties: { asset: { $ref: "#/components/schemas/ProfileAssetBinding" } } } } } },
            "409": idempotencyConflictResponse,
          },
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
            idempotencyKeyParameter,
          ],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["binding"], properties: { binding: { $ref: "#/components/schemas/ProfileAssetBindingSpec" } } } } } },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { asset: { $ref: "#/components/schemas/ProfileAssetBinding" } } } } } },
            "409": idempotencyConflictResponse,
          },
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
      "/v1/snapshots/{id}": {
        get: {
          operationId: "getSnapshot",
          summary: "Get a snapshot by id",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", properties: { snapshot: { $ref: "#/components/schemas/ConfigSnapshot" } } } } } },
          },
        },
      },
      "/v1/machines/applied": {
        post: {
          operationId: "markMachineApplied",
          summary: "Mark a machine as having applied its resolved instructions",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/MachineAppliedInput" } } },
          },
          responses: {
            "200": { content: { "application/json": { schema: { type: "object", required: ["updated"], properties: { updated: { type: "boolean", const: true } } } } } },
          },
        },
      },
      "/v1/machines": {
        get: {
          operationId: "listMachines",
          summary: "List registered machines with producer-side bounds",
          parameters: [limitParameter, cursorParameter, identityViewParameter],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/BoundedMachinePage" } } } },
          },
        },
        post: {
          operationId: "registerMachine",
          summary: "Register or refresh a machine",
          parameters: [idempotencyKeyParameter],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["hostname"],
                  properties: {
                    hostname: { type: "string" },
                    os: { type: "string", nullable: true },
                    arch: { type: "string", nullable: true },
                  },
                },
              },
            },
          },
          responses: {
            "201": { content: { "application/json": { schema: { type: "object", properties: { machine: { $ref: "#/components/schemas/Machine" } } } } } },
            "409": idempotencyConflictResponse,
          },
        },
      },
      "/v1/feedback": {
        post: {
          operationId: "createFeedback",
          summary: "Submit Instructions feedback",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/FeedbackInput" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { type: "object", required: ["ok"], properties: { ok: { type: "boolean", const: true } } } } } },
          },
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
