import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildV1OpenApiDocument } from "./openapi.js";

describe("Instructions complete OpenAPI and generated SDK contract", () => {
  test("documents every implemented profile, snapshot, machine, and feedback route", () => {
    const spec = buildV1OpenApiDocument("test") as any;

    const config = spec.paths["/v1/configs/{id}"];
    expect(config.patch.operationId).toBe("updateConfig");
    expect(config.put.operationId).toBe("putConfig");

    const profile = spec.paths["/v1/profiles/{id}"];
    expect(profile.patch.operationId).toBe("updateProfile");
    expect(profile.put.operationId).toBe("putProfile");
    for (const operation of [profile.patch, profile.put]) {
      expect(operation.requestBody.required).toBe(true);
      expect(operation.requestBody.content["application/json"].schema.$ref).toBe(
        "#/components/schemas/UpdateProfileInput",
      );
      expect(operation.responses["200"].content["application/json"].schema.properties.profile.$ref).toBe(
        "#/components/schemas/Profile",
      );
    }

    expect(spec.paths["/v1/configs/{id}/snapshots/{version}"].get.operationId).toBe(
      "getSnapshotByVersion",
    );
    expect(spec.paths["/v1/configs/{id}/snapshots/prune"].post.operationId).toBe(
      "pruneSnapshots",
    );
    expect(spec.paths["/v1/snapshots/{id}"].get.operationId).toBe("getSnapshot");
    expect(spec.paths["/v1/machines/applied"].post.operationId).toBe("markMachineApplied");
    expect(spec.paths["/v1/feedback"].post.operationId).toBe("createFeedback");
  });

  test("describes the complete update and mutation payloads truthfully", () => {
    const spec = buildV1OpenApiDocument("test") as any;
    const schemas = spec.components.schemas;
    const updateConfig = schemas.UpdateConfigInput.properties;

    expect(Object.keys(updateConfig).sort()).toEqual([
      "agent",
      "category",
      "content",
      "description",
      "format",
      "is_template",
      "kind",
      "name",
      "outputs",
      "synced_at",
      "tags",
      "target_path",
    ]);
    expect(updateConfig.description).toMatchObject({ type: "string", nullable: true });
    expect(updateConfig.target_path).toMatchObject({ type: "string", nullable: true });
    expect(updateConfig.synced_at).toMatchObject({ type: "string", nullable: true });
    expect(updateConfig.outputs).toEqual({ type: "array", items: { type: "object" } });

    expect(schemas.UpdateProfileInput.properties.description).toMatchObject({
      type: "string",
      nullable: true,
    });
    expect(schemas.FeedbackInput.required).toEqual(["message"]);
    expect(schemas.MachineAppliedInput.required).toEqual(["hostname"]);
    expect(schemas.PruneSnapshotsInput.properties.keep).toMatchObject({
      type: "integer",
      minimum: 0,
      default: 10,
    });
  });

  test("tracked generated client exposes the complete implemented route contract", () => {
    const generated = readFileSync(join(import.meta.dir, "../sdk/v1.generated.ts"), "utf8");

    expect(generated).toContain("export interface UpdateProfileInput");
    expect(generated).toContain("export interface FeedbackInput");
    expect(generated).toContain("export interface MachineAppliedInput");
    expect(generated).toContain("export interface PruneSnapshotsInput");
    expect(generated).toContain("async updateConfig(id: string, body: UpdateConfigInput");
    expect(generated).toContain("async putConfig(id: string, body: UpdateConfigInput");
    expect(generated).toContain("async updateProfile(id: string, body: UpdateProfileInput");
    expect(generated).toContain("async putProfile(id: string, body: UpdateProfileInput");
    expect(generated).toContain("async getSnapshotByVersion(id: string, version: number");
    expect(generated).toContain("async pruneSnapshots(id: string, body?: PruneSnapshotsInput");
    expect(generated).toContain("async getSnapshot(id: string");
    expect(generated).toContain("async markMachineApplied(body: MachineAppliedInput");
    expect(generated).toContain("async createFeedback(body: FeedbackInput");
    expect(generated).toContain('"target_path"?: string | null');
    expect(generated).toContain('"description"?: string | null');
    expect(generated).toContain('"synced_at"?: string | null');
  });
});
