import { describe, it, expect } from "bun:test";
import { buildOpenApiDocument } from "./openapi.js";
import { getPgMigrations } from "../db/pg-migrate.js";

describe("openapi document", () => {
  const doc = buildOpenApiDocument("9.9.9") as any;

  it("declares version and title", () => {
    expect(doc.info.version).toBe("9.9.9");
    expect(doc.info.title).toBe("Testers API");
  });

  it("exposes health/ready/version + versioned /v1 ops", () => {
    const paths = Object.keys(doc.paths);
    for (const p of ["/health", "/ready", "/version", "/v1/projects", "/v1/scenarios", "/v1/runs", "/v1/personas"]) {
      expect(paths).toContain(p);
    }
    // full scenario CRUD present
    expect(doc.paths["/v1/scenarios"].get.operationId).toBe("listScenarios");
    expect(doc.paths["/v1/scenarios"].post.operationId).toBe("createScenario");
    expect(doc.paths["/v1/scenarios/{id}"].get.operationId).toBe("getScenario");
    expect(doc.paths["/v1/scenarios/{id}"].put.operationId).toBe("updateScenario");
    expect(doc.paths["/v1/scenarios/{id}"].patch.operationId).toBe("updateScenarioPassedCache");
    expect(doc.paths["/v1/scenarios/{id}"].delete.operationId).toBe("deleteScenario");
    // bulk migration surface (count + idempotent import)
    expect(doc.paths["/v1/scenarios/count"].get.operationId).toBe("countScenarios");
    expect(doc.paths["/v1/scenarios/import"].post.operationId).toBe("importScenarios");
    expect(doc.paths["/v1/scenarios"].get.parameters.some((p: any) => p.name === "offset")).toBe(true);
    // personas pagination params declared (regression e920ef6a)
    expect(doc.paths["/v1/personas"].get.parameters.some((p: any) => p.name === "limit")).toBe(true);
    expect(doc.paths["/v1/personas"].get.parameters.some((p: any) => p.name === "offset")).toBe(true);
    // results write surface declared (regression OPE21-00033): the client's
    // ApiStore.createResult/updateResult POST /v1/results and PUT /v1/results/:id;
    // the server never routed them, so hosted-store runs 404'd on recording.
    expect(doc.paths["/v1/results"].post.operationId).toBe("createResult");
    expect(doc.paths["/v1/results/{id}"].put.operationId).toBe("updateResult");
    expect(doc.paths["/v1/results/{id}"].get.operationId).toBe("getResult");
    expect(doc.components.schemas.CreateResult.required).toContain("runId");
    expect(doc.components.schemas.CreateResult.required).toContain("scenarioId");
  });

  it("marks probes public and /v1 secured by apiKey", () => {
    expect(doc.paths["/health"].get.security).toEqual([]);
    expect(doc.security).toEqual([{ apiKey: [] }]);
    expect(doc.components.securitySchemes.apiKey.name).toBe("x-api-key");
  });

  it("object response schemas have concrete properties (SDK gen emits valid interfaces)", () => {
    for (const name of ["Project", "Scenario", "Run", "Result", "Persona"]) {
      const schema = doc.components.schemas[name];
      expect(schema.type).toBe("object");
      expect(Object.keys(schema.properties ?? {}).length).toBeGreaterThan(0);
    }
  });
});

describe("pg migrations list", () => {
  it("has a stable, deduplicated, checksummed set", () => {
    const migrations = getPgMigrations();
    const ids = migrations.map((m) => m.id);
    expect(ids).toContain("0001_testers_core_schema");
    expect(ids.some((id) => id.includes("api_keys"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of migrations) {
      expect(m.checksum.startsWith("sha256:")).toBe(true);
      expect(m.sql.length).toBeGreaterThan(0);
    }
  });
});
