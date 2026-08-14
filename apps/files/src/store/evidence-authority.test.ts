import { describe, expect, test } from "bun:test";
import { createHasnaStorageClient } from "@hasna/contracts/client/storage";
import type { HasnaHttpTransport } from "@hasna/contracts/client/transport";
import type { EvidenceUploadResult } from "../lib/evidence.js";
import type { FileAsset } from "../types/index.js";
import { ApiStore } from "./api-store.js";

const asset: FileAsset = {
  id: "asset_synthetic_api",
  org_id: "org_synthetic",
  company_id: "co_synthetic",
  app: "iapp-monthly-filing",
  kind: "supporting_document",
  classification: "restricted",
  version: 5,
  canonical_ref: "open-files://evidence/asset_synthetic_api/versions/5",
  provenance_type: "monthly_filing",
  provenance_id: "filing_synthetic_api",
  provenance_ref: "monthly-filing://filing/synthetic-api",
  external_references: ["invoices://invoice/synthetic-api"],
  idempotency_key: "monthly-filing:synthetic-api:v5",
  original_name: "synthetic-api.txt",
  content_type: "text/plain",
  size: 13,
  checksum: "a".repeat(64),
  checksum_algorithm: "sha256",
  storage_provider: "s3",
  bucket: "synthetic-bucket",
  region: "us-east-1",
  object_key: "synthetic/object",
  quarantine_key: "quarantine/synthetic/object",
  status: "pending_upload",
  scan_status: "pending",
  retention_policy: "seven_year_records",
  legal_hold: false,
  immutable: true,
  metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("API evidence authority contract", () => {
  test("forwards immutable metadata on write and every authority filter on read", async () => {
    const calls: Array<{ method: string; path: string; value?: unknown }> = [];
    const result: EvidenceUploadResult = {
      asset,
      replayed: false,
      intent: {
        id: "upl_synthetic_api",
        asset_id: asset.id,
        method: "PUT",
        expires_at: "2026-01-01T00:10:00.000Z",
        status: "pending",
        expected_checksum: asset.checksum,
        expected_checksum_algorithm: "sha256",
        expected_size: asset.size,
        required_headers: {},
        metadata: {},
        created_at: "2026-01-01T00:00:00.000Z",
      },
    };
    const transport: HasnaHttpTransport = {
      baseUrl: "https://files.example.invalid/v1",
      async get(path: string, options?: { query?: Record<string, unknown> }) {
        calls.push({ method: "GET", path, value: options?.query });
        return [asset];
      },
      async post(path: string, body?: unknown) {
        calls.push({ method: "POST", path, value: body });
        return result;
      },
      async put() { return {}; },
      async patch() { return {}; },
      async del() { return {}; },
    } as unknown as HasnaHttpTransport;
    const store = new ApiStore(createHasnaStorageClient("files", transport));

    const created = await store.createEvidenceUploadIntent({
      org_id: asset.org_id,
      company_id: asset.company_id,
      app: asset.app,
      kind: asset.kind,
      original_name: asset.original_name,
      content_type: asset.content_type,
      size: asset.size,
      checksum: asset.checksum,
      classification: asset.classification,
      version: asset.version,
      provenance_type: asset.provenance_type,
      provenance_id: asset.provenance_id,
      provenance_ref: asset.provenance_ref,
      external_references: asset.external_references,
      idempotency_key: asset.idempotency_key,
      retention_policy: asset.retention_policy,
    });
    expect(created).toEqual(result);
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/evidence/upload-intents",
      value: {
        version: 5,
        provenance_type: "monthly_filing",
        provenance_id: "filing_synthetic_api",
        provenance_ref: "monthly-filing://filing/synthetic-api",
        external_references: ["invoices://invoice/synthetic-api"],
        idempotency_key: "monthly-filing:synthetic-api:v5",
      },
    });

    const listed = await store.listEvidenceAssets({
      provenance_type: asset.provenance_type,
      provenance_id: asset.provenance_id,
      provenance_ref: asset.provenance_ref,
      version: asset.version,
      classification: asset.classification,
      retention_policy: asset.retention_policy,
      external_reference: asset.external_references[0],
      idempotency_key: asset.idempotency_key,
    });
    expect(listed).toEqual([asset]);
    expect(calls[1]).toMatchObject({
      method: "GET",
      path: "/evidence/assets",
      value: {
        provenance_type: "monthly_filing",
        provenance_id: "filing_synthetic_api",
        provenance_ref: "monthly-filing://filing/synthetic-api",
        version: 5,
        classification: "restricted",
        retention_policy: "seven_year_records",
        external_reference: "invoices://invoice/synthetic-api",
        idempotency_key: "monthly-filing:synthetic-api:v5",
      },
    });
  });
});
