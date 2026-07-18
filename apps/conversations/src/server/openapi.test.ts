import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { openapiSpec } from "./openapi";

describe("incident projection public contract", () => {
  test("publishes the dedicated route, projector scope, and strict wire schemas", () => {
    const spec = openapiSpec as any;
    const append = spec.paths["/v1/incident-projections"].post;
    expect(append.operationId).toBe("appendIncidentProjection");
    expect(append["x-required-scope"]).toBe("conversations:incident-project");
    expect(append.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/IncidentProjectionEventV1",
    );
    expect(Object.keys(append.responses).sort()).toEqual(["200", "201", "400", "409", "503"]);
    expect(spec.paths["/v1/incident-projections/{event_id}"].get.operationId).toBe("getIncidentProjection");
    expect(spec.paths["/v1/messages/blockers"].get.operationId).toBe("listUnreadBlockers");
    expect(spec.components.schemas.IncidentProjectionEventV1.additionalProperties).toBe(false);
    expect(spec.components.schemas.IncidentSnapshotV1.additionalProperties).toBe(false);
    expect(spec.components.schemas.IncidentProjectionEventV1.properties.authority_id.pattern).toBe(
      "^[A-Za-z0-9._:-]{1,128}$",
    );
  });

  test("keeps the generated SDK checked in with the public projector operations", () => {
    const sdk = readFileSync(new URL("../sdk/index.ts", import.meta.url), "utf8");
    expect(sdk).toContain("async appendIncidentProjection(body: IncidentProjectionEventV1");
    expect(sdk).toContain("async getIncidentProjection(eventId: string");
    expect(sdk).toContain("async listUnreadBlockers");
    expect(sdk).toContain('"blocked_scopes": Array<string>');
    expect(sdk).toContain('"schema_version": 1; "source": "todos"');
    expect(sdk).toContain("reply_to");
    expect(sdk).toContain("metadata");
  });
});
