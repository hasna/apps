import { describe, expect, it } from "bun:test";
import {
  ARTIFACT_MANIFEST_SCHEMA,
  buildEvidenceManifest,
  buildEvidenceManifestKey,
  buildEvidenceObjectKey,
  isCanonicalEvidenceKey,
  isLegacyEvidenceKey,
  isSha256Hex,
} from "./artifact-keys.js";
import type { FileAsset } from "../types/index.js";

const SHA = "a".repeat(64);

function asset(overrides: Partial<FileAsset> = {}): FileAsset {
  return {
    id: "asset_1234",
    org_id: "org_hasna",
    company_id: "co_us",
    app: "app-accounting",
    kind: "receipt",
    classification: "financial_evidence",
    version: 1,
    canonical_ref: "open-files://evidence/asset_1234/versions/1",
    provenance_type: "direct_upload",
    provenance_id: "prov_1",
    external_references: [],
    original_name: "receipt.pdf",
    content_type: "application/pdf",
    size: 42,
    checksum: SHA,
    checksum_algorithm: "sha256",
    storage_provider: "s3",
    object_key: `evidence/${"org_hasna"}/${SHA}.pdf`,
    status: "verified",
    scan_status: "skipped",
    legal_hold: false,
    immutable: true,
    metadata: {},
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    verified_at: "2026-09-04T00:00:00.000Z",
    ...overrides,
  };
}

describe("artifact-keys — canonical evidence layout (hasna/apps#1650)", () => {
  it("builds <prefix>/evidence/<org>/<sha256>[.<ext>] keys", () => {
    expect(buildEvidenceObjectKey({ org_id: "org_hasna", checksum: SHA, original_name: "receipt.pdf" }))
      .toBe(`evidence/org_hasna/${SHA}.pdf`);
    expect(buildEvidenceObjectKey({ org_id: "org_hasna", checksum: SHA, original_name: "receipt", prefix: "objects" }))
      .toBe(`objects/evidence/org_hasna/${SHA}`);
  });

  it("normalizes org segments and digests deterministically", () => {
    const key = buildEvidenceObjectKey({ org_id: "org hasna!", checksum: SHA.toUpperCase(), original_name: "x" });
    expect(key.startsWith(`evidence/org-hasna/${SHA}`)).toBe(true);
    expect(key).toBe(buildEvidenceObjectKey({ org_id: "org-hasna", checksum: SHA, original_name: "other.pdf" }).replace(".pdf", ""));
  });

  it("refuses non-sha256 digests", () => {
    expect(() => buildEvidenceObjectKey({ org_id: "o", checksum: "nope", original_name: "x" })).toThrow(/sha-256/);
  });

  it("mints immutable per-asset manifest keys", () => {
    expect(buildEvidenceManifestKey({ org_id: "org_hasna", asset_id: "asset_1" }))
      .toBe(`evidence/org_hasna/manifests/asset_1.json`);
    expect(buildEvidenceManifestKey({ org_id: "org_hasna", asset_id: "asset_1", prefix: "objects" }))
      .toBe(`objects/evidence/org_hasna/manifests/asset_1.json`);
  });

  it("classifies legacy orgs/ and tenants/ keys and canonical keys", () => {
    expect(isLegacyEvidenceKey("orgs/org_1/companies/_global/app/2026/09/receipt/asset_1/name.pdf")).toBe(true);
    expect(isLegacyEvidenceKey("tenants/tenant_1/objects/asset_1/name.pdf")).toBe(true);
    expect(isLegacyEvidenceKey(`evidence/org_1/${SHA}.pdf`)).toBe(false);
    expect(isLegacyEvidenceKey(`quarantine/evidence/org_1/${SHA}.pdf`)).toBe(false);
    expect(isLegacyEvidenceKey(`objects/evidence/org_1/${SHA}.pdf`)).toBe(false);
    expect(isCanonicalEvidenceKey(`objects/evidence/org_1/${SHA}.pdf`)).toBe(true);
    expect(isCanonicalEvidenceKey("orgs/org_1/files/report.txt")).toBe(false);
  });

  it("validates sha256 digests", () => {
    expect(isSha256Hex(SHA)).toBe(true);
    expect(isSha256Hex(SHA.toUpperCase())).toBe(false);
    expect(isSha256Hex("x")).toBe(false);
  });

  it("builds a manifest with the content address and provenance", () => {
    const input = asset();
    const manifest = buildEvidenceManifest(input, input.object_key);
    expect(manifest.schema).toBe(ARTIFACT_MANIFEST_SCHEMA);
    expect(manifest.app).toBe("files");
    expect(manifest.kind).toBe("evidence");
    expect(manifest.owner).toBe("org_hasna");
    expect(manifest.id).toBe("asset_1234");
    expect(manifest.sha256).toBe(SHA);
    expect(manifest.storageKey).toBe(input.object_key);
    expect(manifest.version).toBe(1);
    expect(manifest.provenance_id).toBe("prov_1");
  });
});