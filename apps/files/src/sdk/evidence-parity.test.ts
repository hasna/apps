import { describe, expect, test } from "bun:test";
import { openApiDocument } from "../server/openapi.js";
import { FilesClient } from "./client.js";

const REQUIRED_OPERATIONS = [
  { path: "/evidence/upload-intents", method: "post", operationId: "createEvidenceUploadIntent" },
  { path: "/evidence/upload-intents/{id}/complete", method: "post", operationId: "completeEvidenceUpload" },
  { path: "/evidence/assets", method: "get", operationId: "listEvidenceAssets" },
  { path: "/evidence/assets/{id}", method: "get", operationId: "getEvidenceAsset" },
  { path: "/evidence/assets/{id}/links", method: "get", operationId: "listEvidenceLinks" },
  { path: "/evidence/assets/{id}/links", method: "post", operationId: "linkEvidenceAsset" },
  { path: "/evidence/assets/{id}/sign-download", method: "post", operationId: "signEvidenceDownload" },
  { path: "/evidence/assets/{id}/verify", method: "post", operationId: "verifyEvidenceAsset" },
  { path: "/evidence/assets/{id}/access-events", method: "get", operationId: "listEvidenceAccessEvents" },
] as const;

describe("evidence OpenAPI and generated SDK parity", () => {
  test("publishes every hosted evidence authority operation in OpenAPI", () => {
    const paths = openApiDocument.paths as Record<string, Record<string, { operationId?: string }>>;
    for (const expected of REQUIRED_OPERATIONS) {
      expect(paths[expected.path]?.[expected.method]?.operationId).toBe(expected.operationId);
    }

    const schemas = openApiDocument.components.schemas as Record<string, unknown>;
    for (const name of [
      "FileAsset",
      "FileUploadIntent",
      "EvidenceUploadResult",
      "CreateEvidenceUpload",
      "FileLink",
      "FileAccessEvent",
      "EvidenceDownloadGrant",
      "EvidenceVerifyResult",
    ]) {
      expect(schemas[name]).toBeDefined();
    }
  });

  test("generated client issues the exact methods, paths, bodies, and list filters", async () => {
    const calls: Array<{ method: string; url: URL; body?: unknown }> = [];
    const client = new FilesClient({
      baseUrl: "https://files.example.invalid/v1",
      apiKey: "test",
      fetch: async (input, init) => {
        calls.push({
          method: String(init?.method),
          url: new URL(String(input)),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        return Response.json({});
      },
    }) as FilesClient & Record<string, (...args: never[]) => Promise<unknown>>;

    for (const { operationId } of REQUIRED_OPERATIONS) {
      expect(typeof client[operationId]).toBe("function");
    }

    await client.createEvidenceUploadIntent({
      app: "app-monthly-filing",
      kind: "supporting_document",
      original_name: "synthetic.txt",
      size: 9,
      checksum: "a".repeat(64),
      provenance_type: "monthly_filing",
      provenance_id: "filing-synthetic-sdk",
      version: 2,
      external_references: ["accounting://entry/synthetic"],
      idempotency_key: "monthly-filing:synthetic-sdk:v2",
    });
    await client.completeEvidenceUpload("intent_synthetic");
    await client.listEvidenceAssets({
      app: "app-monthly-filing",
      provenance_type: "monthly_filing",
      version: 2,
      external_reference: "accounting://entry/synthetic",
    });
    await client.getEvidenceAsset("asset_synthetic");
    await client.linkEvidenceAsset("asset_synthetic", {
      app: "app-monthly-filing",
      source_type: "filing",
      source_id: "filing-synthetic-sdk",
      kind: "supporting_document",
    });
    await client.listEvidenceLinks("asset_synthetic");
    await client.signEvidenceDownload("asset_synthetic", { purpose: "synthetic-test" });
    await client.verifyEvidenceAsset("asset_synthetic");
    await client.listEvidenceAccessEvents("asset_synthetic", { limit: 20 });

    expect(calls.map(({ method, url }) => `${method} ${url.pathname}${url.search}`)).toEqual([
      "POST /v1/evidence/upload-intents",
      "POST /v1/evidence/upload-intents/intent_synthetic/complete",
      "GET /v1/evidence/assets?app=app-monthly-filing&provenance_type=monthly_filing&version=2&external_reference=accounting%3A%2F%2Fentry%2Fsynthetic",
      "GET /v1/evidence/assets/asset_synthetic",
      "POST /v1/evidence/assets/asset_synthetic/links",
      "GET /v1/evidence/assets/asset_synthetic/links",
      "POST /v1/evidence/assets/asset_synthetic/sign-download",
      "POST /v1/evidence/assets/asset_synthetic/verify",
      "GET /v1/evidence/assets/asset_synthetic/access-events?limit=20",
    ]);
    expect(calls[0]?.body).toMatchObject({
      provenance_type: "monthly_filing",
      provenance_id: "filing-synthetic-sdk",
      version: 2,
      external_references: ["accounting://entry/synthetic"],
      idempotency_key: "monthly-filing:synthetic-sdk:v2",
    });
  });
});
