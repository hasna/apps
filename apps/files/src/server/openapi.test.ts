import { describe, expect, test } from "bun:test";
import { openApiDocument } from "./openapi.js";

describe("evidence OpenAPI contract", () => {
  test("documents explicit sensitive intent transport and safe receipt schemas", () => {
    const document = openApiDocument as unknown as {
      components: { schemas: Record<string, any> };
      paths: Record<string, any>;
    };
    const schemas = document.components.schemas;

    expect(schemas.CreateEvidenceUpload).toBeDefined();
    expect(schemas.FileAsset).toBeDefined();
    expect(schemas.FileUploadIntent).toBeDefined();
    expect(schemas.EvidenceUploadResult).toBeDefined();
    expect(schemas.EvidenceUploadReceipt).toBeDefined();

    const uploadUrl = schemas.FileUploadIntent.properties.upload_url;
    expect(uploadUrl.readOnly).toBe(true);
    expect(uploadUrl.format).toBe("password");
    expect(uploadUrl["x-sensitive"]).toBe(true);
    expect(schemas.FileAsset.properties.id.pattern).toContain("asset_");
    expect(schemas.FileUploadIntent.properties.id.pattern).toContain("upl_");
    expect(schemas.FileUploadIntent.properties.expires_at.pattern).toContain("\\d{4}");

    const receiptText = JSON.stringify(schemas.EvidenceUploadReceipt);
    expect(receiptText.includes("upload_url")).toBe(false);
    expect(receiptText.includes("required_headers")).toBe(false);
    expect(receiptText.includes("object_key")).toBe(false);
    expect(receiptText.includes("quarantine_key")).toBe(false);

    expect(document.paths["/evidence/upload-intents"].post.operationId).toBe("createEvidenceUploadIntent");
    expect(document.paths["/evidence/upload-intents/{intentId}/complete"].post.operationId).toBe("completeEvidenceUpload");
  });
});
