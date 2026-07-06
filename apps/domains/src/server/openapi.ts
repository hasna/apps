/**
 * OpenAPI 3.1 description of the domains-serve HTTP API.
 *
 * This is the single source of truth for the versioned `/v1` surface and the
 * generated SDK (`src/sdk`, produced by `@hasna/contracts` generateSdkFromOpenApi).
 */

export interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: { schemas: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
  security?: Record<string, unknown[]>[];
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

function jsonResponse(schema: unknown, description: string) {
  return { description, content: { "application/json": { schema } } };
}

function jsonBody(schema: unknown) {
  return { required: true, content: { "application/json": { schema } } };
}

export function buildOpenApiSpec(version: string): OpenApiDoc {
  const idParam = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
    description: "Resource identifier (UUID).",
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "domains",
      version,
      description:
        "Domain portfolio, registrar, marketplace, and DNS management HTTP API (self_hosted). API-key authenticated.",
    },
    security: [{ apiKey: [] }],
    paths: {
      "/health": {
        get: {
          operationId: "getHealth",
          summary: "Liveness probe (DB reachable).",
          responses: { "200": jsonResponse(ref("HealthResponse"), "Service healthy") },
        },
      },
      "/ready": {
        get: {
          operationId: "getReady",
          summary: "Readiness probe (DB reachable and schema migrated).",
          responses: {
            "200": jsonResponse(ref("ReadyResponse"), "Service ready"),
            "503": jsonResponse(ref("ReadyResponse"), "Not ready"),
          },
        },
      },
      "/version": {
        get: {
          operationId: "getVersion",
          summary: "Service version and mode.",
          responses: { "200": jsonResponse(ref("VersionResponse"), "Version info") },
        },
      },
      "/v1/domains": {
        get: {
          operationId: "listDomains",
          summary: "List domains.",
          parameters: [
            { name: "search", in: "query", required: false, schema: { type: "string" } },
            { name: "status", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
            { name: "offset", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: { "200": jsonResponse(ref("DomainList"), "A page of domains") },
        },
        post: {
          operationId: "createDomain",
          summary: "Create a domain.",
          requestBody: jsonBody(ref("CreateDomainInput")),
          responses: {
            "201": jsonResponse(ref("Domain"), "Created"),
            "400": jsonResponse(ref("Error"), "Invalid input"),
            "409": jsonResponse(ref("Error"), "Already exists"),
          },
        },
      },
      "/v1/domains/{id}": {
        get: {
          operationId: "getDomain",
          summary: "Get a domain by id.",
          parameters: [idParam],
          responses: {
            "200": jsonResponse(ref("Domain"), "The domain"),
            "404": jsonResponse(ref("Error"), "Not found"),
          },
        },
        patch: {
          operationId: "updateDomain",
          summary: "Update a domain.",
          parameters: [idParam],
          requestBody: jsonBody(ref("UpdateDomainInput")),
          responses: {
            "200": jsonResponse(ref("Domain"), "Updated"),
            "404": jsonResponse(ref("Error"), "Not found"),
          },
        },
        delete: {
          operationId: "deleteDomain",
          summary: "Delete a domain.",
          parameters: [idParam],
          responses: { "200": jsonResponse(ref("DeleteResult"), "Deleted") },
        },
      },
      "/v1/stats": {
        get: {
          operationId: "getDomainStats",
          summary: "Portfolio statistics.",
          responses: { "200": jsonResponse(ref("DomainStats"), "Stats") },
        },
      },
      "/v1/domains/{id}/dns": {
        get: {
          operationId: "listDnsRecords",
          summary: "List DNS records for a domain.",
          parameters: [idParam],
          responses: { "200": jsonResponse(ref("DnsRecordList"), "DNS records") },
        },
        post: {
          operationId: "createDnsRecord",
          summary: "Create a DNS record for a domain.",
          parameters: [idParam],
          requestBody: jsonBody(ref("CreateDnsRecordInput")),
          responses: {
            "201": jsonResponse(ref("DnsRecord"), "Created"),
            "404": jsonResponse(ref("Error"), "Domain not found"),
          },
        },
      },
      "/v1/dns/{id}": {
        get: {
          operationId: "getDnsRecord",
          summary: "Get a DNS record by id.",
          parameters: [idParam],
          responses: {
            "200": jsonResponse(ref("DnsRecord"), "The record"),
            "404": jsonResponse(ref("Error"), "Not found"),
          },
        },
        delete: {
          operationId: "deleteDnsRecord",
          summary: "Delete a DNS record.",
          parameters: [idParam],
          responses: { "200": jsonResponse(ref("DeleteResult"), "Deleted") },
        },
      },
      "/v1/domains/{id}/offers": {
        get: {
          operationId: "listOffers",
          summary: "List marketplace offers for a domain.",
          parameters: [idParam],
          responses: { "200": jsonResponse(ref("OfferList"), "Offers") },
        },
        post: {
          operationId: "createOffer",
          summary: "Create a marketplace offer for a domain.",
          parameters: [idParam],
          requestBody: jsonBody(ref("CreateOfferInput")),
          responses: {
            "201": jsonResponse(ref("DomainOffer"), "Created"),
            "404": jsonResponse(ref("Error"), "Domain not found"),
          },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Error: {
          type: "object",
          properties: { error: { type: "string" }, reason: { type: "string" } },
          required: ["error"],
        },
        HealthResponse: {
          type: "object",
          properties: {
            status: { type: "string" },
            version: { type: "string" },
            mode: { type: "string" },
            latencyMs: { type: "number" },
          },
          required: ["status", "version", "mode"],
        },
        ReadyResponse: {
          type: "object",
          properties: {
            status: { type: "string" },
            version: { type: "string" },
            mode: { type: "string" },
            pendingMigrations: { type: "array", items: { type: "string" } },
          },
          required: ["status", "version", "mode"],
        },
        VersionResponse: {
          type: "object",
          properties: {
            status: { type: "string" },
            version: { type: "string" },
            mode: { type: "string" },
          },
          required: ["status", "version", "mode"],
        },
        DeleteResult: {
          type: "object",
          properties: { id: { type: "string" }, deleted: { type: "boolean" } },
          required: ["id", "deleted"],
        },
        Domain: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            registrar: { type: "string", nullable: true },
            status: { type: "string" },
            registered_at: { type: "string", nullable: true },
            expires_at: { type: "string", nullable: true },
            auto_renew: { type: "boolean" },
            is_premium: { type: "boolean" },
            premium_price: { type: "number", nullable: true },
            standard_price: { type: "number", nullable: true },
            purchase_price: { type: "number", nullable: true },
            purchase_date: { type: "string", nullable: true },
            nameservers: { type: "array", items: { type: "string" } },
            whois: { type: "object", additionalProperties: true },
            ssl_expires_at: { type: "string", nullable: true },
            ssl_issuer: { type: "string", nullable: true },
            notes: { type: "string", nullable: true },
            metadata: { type: "object", additionalProperties: true },
            created_at: { type: "string" },
            updated_at: { type: "string" },
          },
          required: ["id", "name", "status", "auto_renew", "is_premium", "created_at", "updated_at"],
        },
        DomainList: {
          type: "object",
          properties: {
            domains: { type: "array", items: ref("Domain") },
            count: { type: "integer" },
          },
          required: ["domains", "count"],
        },
        CreateDomainInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            registrar: { type: "string" },
            status: { type: "string" },
            registered_at: { type: "string" },
            expires_at: { type: "string" },
            auto_renew: { type: "boolean" },
            is_premium: { type: "boolean" },
            premium_price: { type: "number" },
            standard_price: { type: "number" },
            purchase_price: { type: "number" },
            purchase_date: { type: "string" },
            nameservers: { type: "array", items: { type: "string" } },
            whois: { type: "object", additionalProperties: true },
            ssl_expires_at: { type: "string" },
            ssl_issuer: { type: "string" },
            notes: { type: "string" },
            metadata: { type: "object", additionalProperties: true },
          },
          required: ["name"],
        },
        UpdateDomainInput: {
          type: "object",
          properties: {
            name: { type: "string" },
            registrar: { type: "string", nullable: true },
            status: { type: "string" },
            registered_at: { type: "string", nullable: true },
            expires_at: { type: "string", nullable: true },
            auto_renew: { type: "boolean" },
            is_premium: { type: "boolean" },
            premium_price: { type: "number", nullable: true },
            standard_price: { type: "number", nullable: true },
            purchase_price: { type: "number", nullable: true },
            purchase_date: { type: "string", nullable: true },
            nameservers: { type: "array", items: { type: "string" } },
            whois: { type: "object", additionalProperties: true },
            ssl_expires_at: { type: "string", nullable: true },
            ssl_issuer: { type: "string", nullable: true },
            notes: { type: "string", nullable: true },
            metadata: { type: "object", additionalProperties: true },
          },
        },
        DnsRecord: {
          type: "object",
          properties: {
            id: { type: "string" },
            domain_id: { type: "string" },
            type: { type: "string" },
            name: { type: "string" },
            value: { type: "string" },
            ttl: { type: "integer" },
            priority: { type: "integer", nullable: true },
            created_at: { type: "string" },
          },
          required: ["id", "domain_id", "type", "name", "value", "ttl", "created_at"],
        },
        DnsRecordList: {
          type: "object",
          properties: {
            records: { type: "array", items: ref("DnsRecord") },
            count: { type: "integer" },
          },
          required: ["records", "count"],
        },
        CreateDnsRecordInput: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"] },
            name: { type: "string" },
            value: { type: "string" },
            ttl: { type: "integer" },
            priority: { type: "integer" },
          },
          required: ["type", "name", "value"],
        },
        DomainOffer: {
          type: "object",
          properties: {
            id: { type: "string" },
            domain_id: { type: "string" },
            our_offer: { type: "number", nullable: true },
            their_ask: { type: "number", nullable: true },
            status: { type: "string" },
            notes: { type: "string", nullable: true },
            created_at: { type: "string" },
          },
          required: ["id", "domain_id", "status", "created_at"],
        },
        OfferList: {
          type: "object",
          properties: {
            offers: { type: "array", items: ref("DomainOffer") },
            count: { type: "integer" },
          },
          required: ["offers", "count"],
        },
        CreateOfferInput: {
          type: "object",
          properties: {
            our_offer: { type: "number" },
            their_ask: { type: "number" },
            status: { type: "string" },
            notes: { type: "string" },
          },
        },
        DomainStats: {
          type: "object",
          properties: {
            total: { type: "integer" },
            active: { type: "integer" },
            expired: { type: "integer" },
            transferring: { type: "integer" },
            redemption: { type: "integer" },
            auto_renew_enabled: { type: "integer" },
            expiring_30_days: { type: "integer" },
            ssl_expiring_30_days: { type: "integer" },
          },
          required: ["total"],
        },
      },
    },
  };
}
