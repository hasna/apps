import { describe, expect, test } from "bun:test";
import {
  redactSensitiveTransportText,
  toEvidenceUploadReceipt,
  type EvidenceUploadResult,
} from "./evidence.js";

describe("evidence upload output safety", () => {
  test("returns an opaque receipt and redacts synthetic transport query material", () => {
    const now = new Date().toISOString();
    const transportUrl = new URL("https://synthetic.invalid/upload");
    transportUrl.searchParams.set("Synthetic-Credential", "CANARY_CREDENTIAL_VALUE");
    transportUrl.searchParams.set("Synthetic-Session", "CANARY_SESSION_VALUE");
    transportUrl.searchParams.set("Synthetic-Signature", "CANARY_SIGNATURE_VALUE");

    const transportResult: EvidenceUploadResult = {
      asset: {
        id: "asset_synthetic",
        org_id: "org_synthetic",
        app: "iapp-synthetic",
        kind: "receipt",
        classification: "evidence",
        original_name: "receipt.txt",
        content_type: "text/plain",
        size: 1,
        checksum: "0".repeat(64),
        checksum_algorithm: "sha256",
        storage_provider: "s3",
        bucket: "synthetic-bucket",
        object_key: "evidence/synthetic-object",
        status: "pending_upload",
        scan_status: "pending",
        legal_hold: false,
        immutable: false,
        metadata: {},
        created_at: now,
        updated_at: now,
      },
      intent: {
        id: "intent_synthetic",
        asset_id: "asset_synthetic",
        method: "PUT",
        upload_url: transportUrl.toString(),
        expires_at: now,
        status: "pending",
        expected_checksum: "0".repeat(64),
        expected_checksum_algorithm: "sha256",
        expected_size: 1,
        required_headers: { "Synthetic-Session": "CANARY_HEADER_VALUE" },
        metadata: {},
        created_at: now,
      },
    };

    const receiptJson = JSON.stringify(toEvidenceUploadReceipt(transportResult));
    expect(receiptJson.includes("upload_url")).toBe(false);
    expect(receiptJson.includes("required_headers")).toBe(false);
    expect(receiptJson.includes("synthetic-bucket")).toBe(false);
    expect(receiptJson.includes("object_key")).toBe(false);
    expect(receiptJson.includes("CANARY_")).toBe(false);

    const safeError = redactSensitiveTransportText(`Upload failed: ${transportUrl.toString()}`);
    expect(safeError.includes("synthetic.invalid")).toBe(false);
    expect(safeError.includes("/upload")).toBe(false);
    expect(safeError.includes("Synthetic-Credential")).toBe(false);
    expect(safeError.includes("Synthetic-Session")).toBe(false);
    expect(safeError.includes("Synthetic-Signature")).toBe(false);
    expect(safeError.includes("CANARY_")).toBe(false);
    expect(safeError.includes("REDACTED")).toBe(true);
  });
});
