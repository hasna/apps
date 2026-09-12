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
      "Registry + hook-event HTTP API for @hasna/hooks: catalog, lock, and artifact reads are open; publishing (PUT /api/v1/hooks) and every hook-event route (/api/v1/events, /api/v1/events/summary, /api/v1/feedback) require the API key (authorization: Bearer or x-api-key). The event routes persist to the server's PostgreSQL and answer 503 when no store is configured — never with empty data.",
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
    "/api/v1/events": {
      post: {
        summary: "Record one or more hook events (requires the API key)",
        operationId: "postHookEvents",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  { $ref: "#/components/schemas/HookEventInput" },
                  { type: "array", items: { $ref: "#/components/schemas/HookEventInput" }, maxItems: 100 },
                  {
                    type: "object",
                    properties: {
                      events: { type: "array", items: { $ref: "#/components/schemas/HookEventInput" }, maxItems: 100 },
                    },
                    required: ["events"],
                  },
                ],
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Events persisted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    events: { type: "array", items: { $ref: "#/components/schemas/HookEvent" } },
                    count: { type: "integer" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid event payload" },
          "401": { description: "Missing or invalid API key" },
          "503": { description: "The server has no event store configured" },
        },
        security: [{ apiKey: [] }],
      },
      get: {
        summary: "Query hook events (requires the API key)",
        operationId: "listHookEvents",
        parameters: [
          { name: "hook", in: "query", schema: { type: "string" }, description: "Exact hook name" },
          { name: "session", in: "query", schema: { type: "string" }, description: "Session id prefix" },
          { name: "since", in: "query", schema: { type: "string" }, description: "ISO timestamp or duration (30m, 2h, 7d)" },
          { name: "q", in: "query", schema: { type: "string" }, description: "Substring match on tool_input or error" },
          { name: "errors_only", in: "query", schema: { type: "boolean" } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 500 } },
        ],
        responses: {
          "200": {
            description: "Matching events, newest first",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    events: { type: "array", items: { $ref: "#/components/schemas/HookEvent" } },
                    count: { type: "integer" },
                  },
                },
              },
            },
          },
          "401": { description: "Missing or invalid API key" },
          "503": { description: "The server has no event store configured" },
        },
        security: [{ apiKey: [] }],
      },
      delete: {
        summary: "Delete hook events (requires the API key)",
        operationId: "deleteHookEvents",
        parameters: [
          { name: "hook", in: "query", schema: { type: "string" }, description: "Only delete events for this hook" },
        ],
        responses: {
          "200": {
            description: "Number of deleted rows",
            content: {
              "application/json": {
                schema: { type: "object", properties: { deleted: { type: "integer" } } },
              },
            },
          },
          "401": { description: "Missing or invalid API key" },
          "503": { description: "The server has no event store configured" },
        },
        security: [{ apiKey: [] }],
      },
    },
    "/api/v1/events/summary": {
      get: {
        summary: "Per-hook execution counts and error rates (requires the API key)",
        operationId: "getHookEventSummary",
        parameters: [
          { name: "since", in: "query", schema: { type: "string" }, description: "ISO timestamp or duration (24h, 7d)" },
        ],
        responses: {
          "200": {
            description: "Summary rows",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    since: { type: ["string", "null"] },
                    hooks: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          hook_name: { type: "string" },
                          total: { type: "integer" },
                          errors: { type: "integer" },
                          error_rate: { type: "string" },
                        },
                      },
                    },
                    totals: {
                      type: "object",
                      properties: {
                        events: { type: "integer" },
                        errors: { type: "integer" },
                        hooks_active: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Missing or invalid API key" },
          "503": { description: "The server has no event store configured" },
        },
        security: [{ apiKey: [] }],
      },
    },
    "/api/v1/feedback": {
      post: {
        summary: "Send feedback about the service (requires the API key)",
        operationId: "postFeedback",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message"],
                properties: {
                  message: { type: "string" },
                  email: { type: "string" },
                  category: { type: "string", enum: ["bug", "feature", "general"] },
                  version: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Feedback stored",
            content: {
              "application/json": {
                schema: { type: "object", properties: { ok: { type: "boolean" }, id: { type: "string" } } },
              },
            },
          },
          "400": { description: "Missing message" },
          "401": { description: "Missing or invalid API key" },
          "503": { description: "The server has no event store configured" },
        },
        security: [{ apiKey: [] }],
      },
    },
  },
  components: {
    schemas: {
      HookEventInput: {
        type: "object",
        required: ["session_id", "hook_name", "event_type"],
        properties: {
          session_id: { type: "string" },
          hook_name: { type: "string" },
          event_type: {
            type: "string",
            enum: [
              "PreToolUse",
              "PostToolUse",
              "Stop",
              "Notification",
              "SessionStart",
              "SessionEnd",
              "UserPromptSubmit",
              "SubagentStart",
            ],
          },
          tool_name: { type: ["string", "null"] },
          tool_input: { type: ["string", "null"] },
          result: { type: ["string", "null"], enum: ["continue", "block", null] },
          error: { type: ["string", "null"] },
          duration_ms: { type: ["integer", "null"] },
          project_dir: { type: ["string", "null"] },
          metadata: { type: ["string", "null"] },
          timestamp: { type: "string" },
        },
      },
      HookEvent: {
        allOf: [
          { $ref: "#/components/schemas/HookEventInput" },
          {
            type: "object",
            required: ["id", "timestamp"],
            properties: { id: { type: "string" }, timestamp: { type: "string" } },
          },
        ],
      },
    },
    securitySchemes: {
      apiKey: {
        type: "http",
        scheme: "bearer",
        description: "The registry API key — resolved by the client through the @hasna/contracts chain (HASNA_HOOKS_API_KEY, the Keychain item hasna.credentials.hooks.api-key, or ~/.hasna/hooks/config/credentials); the server compares the inbound bearer/x-api-key value.",
      },
    },
  },
} as const;
