// OpenAPI 3.1 document for the hooks registry HTTP API (hooks-serve).
//
// The document describes the routes handleServeRequest actually implements,
// so the generatedFrom contract (hasna.contract.json sdk surface) references
// a real artifact rather than a fiction. Keep this in lock-step with
// src/serve.ts: a route added there belongs here too, and vice versa.

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Hooks Registry API",
    version: "0.1.0",
    description:
      "Local registry HTTP API for @hasna/hooks: catalog, lock, and artifact reads are open; publishing (PUT /api/v1/hooks) requires the API key (authorization: Bearer or x-api-key).",
  },
  servers: [{ url: "/" }],
  paths: {
    "/health": {
      get: {
        summary: "Liveness probe",
        operationId: "getHealth",
        responses: {
          "200": {
            description: "Service is alive",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
    },
    "/ready": {
      get: {
        summary: "Readiness probe — the hooks.lock store is readable",
        operationId: "getReady",
        responses: {
          "200": { description: "Lock store is readable" },
          "503": { description: "Lock store is not readable" },
        },
      },
    },
    "/version": {
      get: {
        summary: "Package version",
        operationId: "getVersion",
        responses: {
          "200": {
            description: "The installed @hasna/hooks version",
            content: {
              "application/json": {
                schema: { type: "object", properties: { version: { type: "string" } } },
              },
            },
          },
        },
      },
    },
    "/openapi.json": {
      get: {
        summary: "This OpenAPI document",
        operationId: "getOpenApi",
        responses: { "200": { description: "OpenAPI 3.1 document" } },
      },
    },
    "/api/v1/catalog": {
      get: {
        summary: "List the full hook catalog with versions and sha256",
        operationId: "getCatalog",
        responses: {
          "200": {
            description: "Catalog entries",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    hooks: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          version: { type: "string" },
                          sha256: { type: "string" },
                          events: { type: "array", items: { type: "string" } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/lock": {
      get: {
        summary: "Read the published hooks.lock with per-hook versions",
        operationId: "getLock",
        responses: { "200": { description: "The lock file" } },
      },
    },
    "/api/v1/hooks/{name}/{version}": {
      get: {
        summary: "Fetch one hook's manifest and script",
        operationId: "getHookArtifact",
        parameters: [
          { name: "name", in: "path", required: true, schema: { type: "string" } },
          { name: "version", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Hook artifact; x-hook-sha256 header carries the script hash",
          },
          "400": { description: "Invalid URL encoding or semver version" },
          "404": { description: "Hook not found locally" },
        },
      },
    },
    "/api/v1/hooks": {
      put: {
        summary: "Publish/retrust a hook (requires the API key)",
        operationId: "putHook",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { name: { type: "string" }, version: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Hook retrusted and pin updated" },
          "401": { description: "Missing or invalid API key" },
          "404": { description: "Hook not found in local store" },
          "409": { description: "Version mismatch with the local store" },
        },
        security: [{ apiKey: [] }],
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: {
        type: "http",
        scheme: "bearer",
        description: "The registry API key — resolved by the client through the @hasna/contracts chain (HASNA_HOOKS_API_KEY, the Keychain item hasna.credentials.hooks.api-key, or ~/.hasna/hooks/config/credentials); the server compares the inbound bearer/x-api-key value.",
      },
    },
  },
} as const;
