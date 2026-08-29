/**
 * OpenAPI 3.1 document for the context-serve HTTP surface.
 *
 * One entry per REST endpoint served by src/server/index.ts, kept in
 * lock-step with the route handlers so the SDK surface declared in
 * hasna.contract.json (`generatedFrom: /openapi.json`) is honest and the
 * document cannot silently drift from the served routes. The endpoint table
 * below is the single source for the generated document; the test
 * (src/server/openapi.test.ts) asserts the served GET /openapi.json matches
 * this builder and lists the core routes.
 */

interface Endpoint {
  method: "get" | "post" | "delete" | "patch";
  path: string;
  operationId: string;
  summary: string;
  public?: boolean;
}

const ENDPOINTS: Endpoint[] = [
  { method: "get", path: "/health", operationId: "getHealth", summary: "Liveness probe", public: true },
  { method: "get", path: "/ready", operationId: "getReady", summary: "Readiness probe", public: true },
  { method: "get", path: "/version", operationId: "getVersion", summary: "Version + build info", public: true },
  { method: "get", path: "/api/health", operationId: "getApiHealth", summary: "Legacy liveness surface", public: true },

  { method: "get", path: "/api/libraries", operationId: "listLibraries", summary: "List libraries (optional q full-text search)" },
  { method: "post", path: "/api/libraries", operationId: "createLibrary", summary: "Register a library" },
  { method: "get", path: "/api/libraries/{slug}", operationId: "getLibrary", summary: "Get a library by slug" },
  { method: "delete", path: "/api/libraries/{slug}", operationId: "deleteLibrary", summary: "Delete a library" },
  { method: "post", path: "/api/libraries/{slug}/refresh", operationId: "refreshLibrary", summary: "Re-crawl a library" },
  { method: "post", path: "/api/libraries/{slug}/crawl", operationId: "crawlLibrary", summary: "Compatibility alias for refresh" },
  { method: "get", path: "/api/libraries/{slug}/docs", operationId: "getLibraryDocs", summary: "Get library documentation tree" },
  { method: "get", path: "/api/libraries/{slug}/embeddings", operationId: "getLibraryEmbeddings", summary: "Get library embedding status" },
  { method: "post", path: "/api/libraries/{slug}/embed", operationId: "embedLibrary", summary: "Embed a library" },

  { method: "get", path: "/api/search", operationId: "search", summary: "Full-text or semantic search over chunks" },
  { method: "get", path: "/api/stats", operationId: "getStats", summary: "Store counts (libraries/documents/chunks)" },
  { method: "get", path: "/api/endpoints", operationId: "listEndpoints", summary: "Query indexed API endpoints" },
  { method: "get", path: "/api/ai/status", operationId: "getAiStatus", summary: "AI provider backends status" },
  { method: "post", path: "/api/ai/generate", operationId: "aiGenerate", summary: "AI generation" },
  { method: "post", path: "/api/ai/ask", operationId: "aiAsk", summary: "Ask the docs AI" },

  { method: "get", path: "/api/updates/plan", operationId: "getUpdatePlan", summary: "Plan updates for a library" },
  { method: "post", path: "/api/updates/plan", operationId: "postUpdatePlan", summary: "Create an update plan" },
  { method: "get", path: "/api/live/cycle", operationId: "getLiveCycle", summary: "Dry-run a live refresh cycle" },
  { method: "post", path: "/api/live/cycle", operationId: "postLiveCycle", summary: "Run a live refresh cycle" },

  { method: "post", path: "/api/context/build", operationId: "buildDocsContext", summary: "Build a documentation context payload" },

  { method: "get", path: "/api/publish/readiness", operationId: "getPublishReadiness", summary: "Publish readiness report" },
  { method: "get", path: "/api/verify/readiness", operationId: "verifyReadiness", summary: "Run the readiness verifier (read-only)" },
  { method: "post", path: "/api/verify/readiness", operationId: "verifyReadinessPost", summary: "Run the readiness verifier with options" },
  { method: "get", path: "/api/verify", operationId: "verifyReadinessShort", summary: "Alias for GET /api/verify/readiness" },
  { method: "post", path: "/api/verify", operationId: "verifyReadinessShortPost", summary: "Alias for POST /api/verify/readiness" },
  { method: "get", path: "/api/sources/readiness", operationId: "getSourceReadiness", summary: "Documentation-source readiness report" },
  { method: "get", path: "/api/sources", operationId: "listSources", summary: "List documentation sources" },
  { method: "get", path: "/api/seeds", operationId: "listSeeds", summary: "Select seed libraries" },
  { method: "post", path: "/api/seeds", operationId: "bootstrapSeeds", summary: "Bootstrap seed sources" },

  { method: "get", path: "/api/webhooks", operationId: "listWebhooks", summary: "List webhook endpoints" },
  { method: "post", path: "/api/webhooks", operationId: "createWebhook", summary: "Register a webhook endpoint" },
  { method: "delete", path: "/api/webhooks/{id}", operationId: "deleteWebhook", summary: "Remove a webhook endpoint" },
  { method: "get", path: "/api/webhooks/deliveries", operationId: "listWebhookDeliveries", summary: "List webhook deliveries" },
  { method: "post", path: "/api/webhooks/test", operationId: "testWebhook", summary: "Emit a test webhook event" },

  { method: "post", path: "/mcp", operationId: "mcpJsonRpc", summary: "MCP JSON-RPC over HTTP" },
];

const pkg = require("../../package.json") as { version: string };

/**
 * Security requirement for protected operations: Bearer OR x-context-token.
 * OpenAPI security is OR across array entries, AND within an entry, so two
 * single-scheme entries express "either scheme satisfies".
 */
const PROTECTED_SECURITY = [{ bearerAuth: [] }, { xContextToken: [] }];
const PUBLIC_SECURITY: never[] = [];

/** Build the OpenAPI 3.1 document for the context HTTP surface. */
export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const endpoint of ENDPOINTS) {
    const pathItem = (paths[endpoint.path] ??= {});
    pathItem[endpoint.method] = {
      operationId: endpoint.operationId,
      summary: endpoint.summary,
      // The `public` marker is load-bearing: protected /api/* and /mcp
      // operations REQUIRE one of the declared security schemes, so the
      // machine-readable contract cannot be read as unauthenticated
      // (release-review P1). Enforcement is conditional on configuration
      // (see info.description): when no token is configured the server
      // serves openly, but the contract states the secured contract.
      security: endpoint.public ? PUBLIC_SECURITY : PROTECTED_SECURITY,
      responses: {
        "200": { description: "OK" },
        "400": { description: "Bad request" },
        "401": { description: "Missing or invalid credentials" },
        "403": { description: "Insufficient permissions" },
        "404": { description: "Not found" },
        "500": { description: "Internal error" },
      },
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Context API",
      version: pkg.version,
      description:
        "Self-hosted documentation context server for AI coding agents. " +
        "Data routes under /api/* and /mcp require HTTP auth when CONTEXT_HTTP_TOKEN or " +
        "CONTEXT_REQUIRE_HTTP_AUTH is set; /api/health (legacy liveness), " +
        "/health, /ready, /version and /openapi.json are public by contract. " +
        "Protected operations accept either `Authorization: Bearer <token>` " +
        "or the `x-context-token` header (see components.securitySchemes).",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Bearer token matching CONTEXT_HTTP_TOKEN / HASNA_CONTEXT_HTTP_TOKEN.",
        },
        xContextToken: {
          type: "apiKey",
          in: "header",
          name: "x-context-token",
          description: "Token matching CONTEXT_HTTP_TOKEN / HASNA_CONTEXT_HTTP_TOKEN.",
        },
      },
    },
    paths,
  };
}
