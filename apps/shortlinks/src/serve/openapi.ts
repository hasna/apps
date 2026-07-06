/**
 * OpenAPI 3 description of the shortlinks serve HTTP API.
 *
 * This is the single source of truth for the generated SDK
 * (`@hasna/shortlinks-sdk`) — run `bun run sdk:generate` after changing it —
 * and is also served live at `GET /openapi.json`.
 */

export function buildOpenApiDocument(version: string): Record<string, unknown> {
  const linkSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      domain_id: { type: "string" },
      hostname: { type: "string" },
      slug: { type: "string" },
      destination_url: { type: "string" },
      title: { type: "string", nullable: true },
      active: { type: "boolean" },
      expires_at: { type: "string", nullable: true },
      short_url: { type: "string" },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string" },
      updated_at: { type: "string" },
    },
    required: ["id", "domain_id", "hostname", "slug", "destination_url", "active", "created_at"],
  };

  const domainSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      hostname: { type: "string" },
      provider: { type: "string" },
      default_domain: { type: "boolean" },
      origin_url: { type: "string", nullable: true },
      notes: { type: "string", nullable: true },
      metadata: { type: "object", additionalProperties: true },
      created_at: { type: "string" },
      updated_at: { type: "string" },
    },
    required: ["id", "hostname", "provider", "default_domain", "created_at"],
  };

  const linkStatsSchema = {
    type: "object",
    properties: {
      link: { $ref: "#/components/schemas/Link" },
      clicks: { type: "integer" },
      last_clicked_at: { type: "string", nullable: true },
      top_referrers: {
        type: "array",
        items: {
          type: "object",
          properties: { referer: { type: "string", nullable: true }, clicks: { type: "integer" } },
        },
      },
      top_user_agents: {
        type: "array",
        items: {
          type: "object",
          properties: { user_agent: { type: "string", nullable: true }, clicks: { type: "integer" } },
        },
      },
    },
    required: ["link", "clicks"],
  };

  const probe = (extra: Record<string, unknown> = {}) => ({
    type: "object",
    properties: {
      status: { type: "string" },
      version: { type: "string" },
      mode: { type: "string" },
      ...extra,
    },
    required: ["status", "version", "mode"],
  });

  return {
    openapi: "3.0.3",
    info: {
      title: "ShortlinksApi",
      version,
      description:
        "Shortlink manager — custom domains, click tracking, and shortlink CRUD with API-key auth. PURE REMOTE (Amendment A1): reads/writes RDS Postgres directly.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Link: linkSchema,
        Domain: domainSchema,
        LinkStats: linkStatsSchema,
        LinkList: { type: "array", items: linkSchema },
        DomainList: { type: "array", items: domainSchema },
        TotalStats: {
          type: "object",
          properties: {
            domains: { type: "integer" },
            links: { type: "integer" },
            clicks: { type: "integer" },
          },
          required: ["domains", "links", "clicks"],
        },
        CreateLinkRequest: {
          type: "object",
          properties: {
            url: { type: "string", description: "Destination URL (http/https)." },
            domain: { type: "string", description: "Hostname; defaults to the default domain." },
            slug: { type: "string", description: "Custom slug; generated when omitted." },
            title: { type: "string" },
            expires_at: { type: "string", description: "ISO date/time." },
            length: { type: "integer", description: "Generated slug length." },
            metadata: { type: "object", additionalProperties: true },
          },
          required: ["url"],
        },
        AddDomainRequest: {
          type: "object",
          properties: {
            hostname: { type: "string" },
            provider: { type: "string" },
            default: { type: "boolean" },
            origin_url: { type: "string" },
            notes: { type: "string" },
            metadata: { type: "object", additionalProperties: true },
          },
          required: ["hostname"],
        },
        DeleteResponse: {
          type: "object",
          properties: { deleted: { type: "boolean" }, slug: { type: "string" } },
          required: ["deleted"],
        },
        HealthStatus: probe({ db_latency_ms: { type: "integer" } }),
        ReadyStatus: probe({ pending_migrations: { type: "array", items: { type: "string" } } }),
        VersionInfo: probe({ name: { type: "string" } }),
        ErrorResponse: {
          type: "object",
          properties: { error: { type: "string" }, reason: { type: "string" } },
          required: ["error"],
        },
      },
    },
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          summary: "Liveness probe.",
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/HealthStatus" } } } },
          },
        },
      },
      "/ready": {
        get: {
          operationId: "getReady",
          summary: "Readiness probe (DB reachable and schema migrated).",
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/ReadyStatus" } } } },
          },
        },
      },
      "/version": {
        get: {
          operationId: "getVersion",
          summary: "Service version and mode.",
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/VersionInfo" } } } },
          },
        },
      },
      "/v1/stats": {
        get: {
          operationId: "getStats",
          summary: "Total domains/links/clicks counts.",
          security: [{ apiKey: [] }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/TotalStats" } } } },
          },
        },
      },
      "/v1/domains": {
        get: {
          operationId: "listDomains",
          summary: "List configured domains.",
          security: [{ apiKey: [] }],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/DomainList" } } } },
          },
        },
        post: {
          operationId: "addDomain",
          summary: "Add or update a domain.",
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/AddDomainRequest" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Domain" } } } },
          },
        },
      },
      "/v1/links": {
        get: {
          operationId: "listLinks",
          summary: "List shortlinks.",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "domain", in: "query", schema: { type: "string" } },
            { name: "active", in: "query", schema: { type: "boolean" } },
            { name: "limit", in: "query", schema: { type: "integer" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/LinkList" } } } },
          },
        },
        post: {
          operationId: "createLink",
          summary: "Create a shortlink.",
          security: [{ apiKey: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateLinkRequest" } } },
          },
          responses: {
            "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Link" } } } },
          },
        },
      },
      "/v1/links/{slug}": {
        get: {
          operationId: "getLink",
          summary: "Get a shortlink by slug.",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "domain", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Link" } } } },
          },
        },
        delete: {
          operationId: "deleteLink",
          summary: "Delete a shortlink.",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "domain", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/DeleteResponse" } } } },
          },
        },
      },
      "/v1/links/{slug}/enable": {
        post: {
          operationId: "enableLink",
          summary: "Enable a shortlink.",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "domain", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Link" } } } },
          },
        },
      },
      "/v1/links/{slug}/disable": {
        post: {
          operationId: "disableLink",
          summary: "Disable a shortlink.",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "domain", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Link" } } } },
          },
        },
      },
      "/v1/links/{slug}/stats": {
        get: {
          operationId: "getLinkStats",
          summary: "Click stats for a shortlink.",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "domain", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/LinkStats" } } } },
          },
        },
      },
      "/v1/resolve/{slug}": {
        get: {
          operationId: "resolveLink",
          summary: "Resolve a slug to its destination without recording a click.",
          security: [{ apiKey: [] }],
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "domain", in: "query", schema: { type: "string" } },
          ],
          responses: {
            "200": { content: { "application/json": { schema: { $ref: "#/components/schemas/Link" } } } },
          },
        },
      },
    },
  };
}
