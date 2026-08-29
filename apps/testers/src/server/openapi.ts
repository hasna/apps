/**
 * OpenAPI 3.1 document for the testers /v1 HTTP surface. This is the single
 * source of truth for both the served `/openapi.json` and the generated typed
 * SDK client (see scripts/generate-sdk.ts -> src/sdk/client.ts).
 */
export function buildOpenApiDocument(version: string): Record<string, unknown> {
  const idParam = {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string" },
  };
  const jsonBody = (schemaRef: string) => ({
    required: true,
    content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaRef}` } } },
  });
  const okJson = (schemaRef: string) => ({
    "200": { description: "OK", content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaRef}` } } } },
  });
  const listOf = (schemaRef: string) => ({
    "200": {
      description: "OK",
      content: { "application/json": { schema: { type: "array", items: { $ref: `#/components/schemas/${schemaRef}` } } } },
    },
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "Testers API",
      version,
      description: "AI-powered QA testing service — scenarios, runs, results, projects, and personas.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
      schemas: {
        Health: {
          type: "object",
          properties: { status: { type: "string" }, version: { type: "string" } },
          required: ["status", "version"],
        },
        Ready: {
          type: "object",
          properties: {
            status: { type: "string" },
            version: { type: "string" },
            pendingMigrations: { type: "array", items: { type: "string" } },
          },
          required: ["status", "version"],
        },
        Project: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            baseUrl: { type: "string" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
        },
        CreateProject: {
          type: "object",
          properties: {
            name: { type: "string" },
            path: { type: "string" },
            description: { type: "string" },
            baseUrl: { type: "string" },
            port: { type: "integer" },
            scenarioPrefix: { type: "string" },
          },
          required: ["name"],
        },
        Scenario: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            shortId: { type: "string" },
            projectId: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            steps: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            priority: { type: "string" },
            version: { type: "integer" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
        },
        CreateScenario: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            steps: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            projectId: { type: "string" },
            requiresAuth: { type: "boolean" },
          },
          required: ["name"],
        },
        UpdateScenarioPassedCache: {
          type: "object",
          properties: { lastPassedUrl: { type: "string" } },
          required: ["lastPassedUrl"],
        },
        Run: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            projectId: { type: "string" },
            status: { type: "string" },
            url: { type: "string" },
            model: { type: "string" },
            total: { type: "integer" },
            passed: { type: "integer" },
            failed: { type: "integer" },
            startedAt: { type: "string" },
            finishedAt: { type: "string" },
          },
        },
        CreateRun: {
          type: "object",
          properties: { url: { type: "string" }, model: { type: "string" }, projectId: { type: "string" } },
          required: ["url"],
        },
        CreateResult: {
          type: "object",
          properties: {
            runId: { type: "string" },
            scenarioId: { type: "string" },
            model: { type: "string" },
            stepsTotal: { type: "integer" },
            personaId: { type: "string" },
            personaName: { type: "string" },
          },
          required: ["runId", "scenarioId"],
        },
        Result: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            runId: { type: "string" },
            scenarioId: { type: "string" },
            status: { type: "string" },
            reasoning: { type: "string" },
            error: { type: "string" },
            durationMs: { type: "integer" },
            createdAt: { type: "string" },
          },
        },
        Persona: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            shortId: { type: "string" },
            projectId: { type: "string" },
            name: { type: "string" },
            role: { type: "string" },
            description: { type: "string" },
            enabled: { type: "boolean" },
            version: { type: "integer" },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
        },
        CreatePersona: {
          type: "object",
          properties: {
            name: { type: "string" },
            role: { type: "string" },
            description: { type: "string" },
            instructions: { type: "string" },
            traits: { type: "array", items: { type: "string" } },
            goals: { type: "array", items: { type: "string" } },
            projectId: { type: "string" },
          },
          required: ["name", "role"],
        },
        DeleteResult: { type: "object", properties: { deleted: { type: "boolean" } }, required: ["deleted"] },
        ScenarioCount: { type: "object", properties: { count: { type: "integer" } }, required: ["count"] },
        ImportScenario: {
          type: "object",
          additionalProperties: true,
          properties: {
            id: { type: "string" },
            shortId: { type: "string" },
            projectName: { type: "string" },
            name: { type: "string" },
            description: { type: "string" },
            steps: { type: "array", items: { type: "string" } },
            tags: { type: "array", items: { type: "string" } },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            createdAt: { type: "string" },
            updatedAt: { type: "string" },
          },
          required: ["id", "name"],
        },
        ImportProject: {
          type: "object",
          properties: {
            name: { type: "string" },
            path: { type: "string" },
            scenarioPrefix: { type: "string" },
            scenarioCounter: { type: "integer" },
          },
          required: ["name"],
        },
        ImportScenarios: {
          type: "object",
          properties: {
            projects: { type: "array", items: { $ref: "#/components/schemas/ImportProject" } },
            scenarios: { type: "array", items: { $ref: "#/components/schemas/ImportScenario" } },
          },
        },
        ImportResult: {
          type: "object",
          properties: {
            projects: {
              type: "object",
              properties: { created: { type: "integer" }, matched: { type: "integer" } },
            },
            scenarios: {
              type: "object",
              properties: { inserted: { type: "integer" }, updated: { type: "integer" }, total: { type: "integer" } },
            },
          },
          required: ["scenarios"],
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      "/health": {
        get: { operationId: "getHealth", summary: "Liveness probe", security: [], responses: okJson("Health") },
      },
      "/ready": {
        get: { operationId: "getReady", summary: "Readiness probe", security: [], responses: okJson("Ready") },
      },
      "/version": {
        get: { operationId: "getVersion", summary: "Service version", security: [], responses: okJson("Health") },
      },
      "/v1/projects": {
        get: { operationId: "listProjects", summary: "List projects", responses: listOf("Project") },
        post: { operationId: "createProject", summary: "Create project", requestBody: jsonBody("CreateProject"), responses: okJson("Project") },
      },
      "/v1/projects/{id}": {
        get: { operationId: "getProject", summary: "Get project", parameters: [idParam], responses: okJson("Project") },
        put: { operationId: "updateProject", summary: "Update project", parameters: [idParam], requestBody: jsonBody("CreateProject"), responses: okJson("Project") },
      },
      "/v1/scenarios": {
        get: {
          operationId: "listScenarios",
          summary: "List scenarios",
          parameters: [
            { name: "projectId", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
            { name: "offset", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: listOf("Scenario"),
        },
        post: { operationId: "createScenario", summary: "Create scenario", requestBody: jsonBody("CreateScenario"), responses: okJson("Scenario") },
      },
      "/v1/scenarios/count": {
        get: { operationId: "countScenarios", summary: "Count all scenarios", responses: okJson("ScenarioCount") },
      },
      "/v1/scenarios/import": {
        post: {
          operationId: "importScenarios",
          summary: "Idempotent bulk import of scenarios (upsert by id) and their projects (by name)",
          requestBody: jsonBody("ImportScenarios"),
          responses: okJson("ImportResult"),
        },
      },
      "/v1/scenarios/{id}": {
        get: { operationId: "getScenario", summary: "Get scenario", parameters: [idParam], responses: okJson("Scenario") },
        put: { operationId: "updateScenario", summary: "Update scenario", parameters: [idParam], requestBody: jsonBody("CreateScenario"), responses: okJson("Scenario") },
        patch: {
          operationId: "updateScenarioPassedCache",
          summary: "Record the last-passed cache entry for a scenario",
          parameters: [idParam],
          requestBody: jsonBody("UpdateScenarioPassedCache"),
          responses: okJson("Scenario"),
        },
        delete: { operationId: "deleteScenario", summary: "Delete scenario", parameters: [idParam], responses: okJson("DeleteResult") },
      },
      "/v1/runs": {
        get: {
          operationId: "listRuns",
          summary: "List runs",
          parameters: [{ name: "projectId", in: "query", required: false, schema: { type: "string" } }],
          responses: listOf("Run"),
        },
        post: { operationId: "createRun", summary: "Create run record", requestBody: jsonBody("CreateRun"), responses: okJson("Run") },
      },
      "/v1/runs/{id}": {
        get: { operationId: "getRun", summary: "Get run", parameters: [idParam], responses: okJson("Run") },
      },
      "/v1/runs/{id}/results": {
        get: { operationId: "listRunResults", summary: "List results for a run", parameters: [idParam], responses: listOf("Result") },
      },
      "/v1/results": {
        post: { operationId: "createResult", summary: "Create result record", requestBody: jsonBody("CreateResult"), responses: okJson("Result") },
      },
      "/v1/results/{id}": {
        get: { operationId: "getResult", summary: "Get result", parameters: [idParam], responses: okJson("Result") },
        put: { operationId: "updateResult", summary: "Update result", parameters: [idParam], requestBody: jsonBody("CreateResult"), responses: okJson("Result") },
      },
      "/v1/personas": {
        get: {
          operationId: "listPersonas",
          summary: "List personas",
          parameters: [
            { name: "projectId", in: "query", required: false, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer" } },
            { name: "offset", in: "query", required: false, schema: { type: "integer" } },
          ],
          responses: listOf("Persona"),
        },
        post: { operationId: "createPersona", summary: "Create persona", requestBody: jsonBody("CreatePersona"), responses: okJson("Persona") },
      },
      "/v1/personas/{id}": {
        get: { operationId: "getPersona", summary: "Get persona", parameters: [idParam], responses: okJson("Persona") },
        put: { operationId: "updatePersona", summary: "Update persona", parameters: [idParam], requestBody: jsonBody("CreatePersona"), responses: okJson("Persona") },
        delete: { operationId: "deletePersona", summary: "Delete persona", parameters: [idParam], responses: okJson("DeleteResult") },
      },
    },
  };
}
