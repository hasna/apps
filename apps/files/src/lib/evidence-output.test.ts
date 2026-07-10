import { describe, expect, test } from "bun:test";
import { HasnaHttpError } from "@hasna/contracts/client";
import {
  redactSensitiveTransportText,
  sanitizeEvidenceTransportError,
  toEvidenceUploadReceipt,
  uploadEvidenceFile,
  type EvidenceDb,
  type EvidenceStorageOptions,
  type UploadEvidenceFileInput,
  type EvidenceUploadResult,
} from "./evidence.js";

describe("evidence upload output safety", () => {
  test("returns an opaque receipt and redacts synthetic transport query material", () => {
    const now = new Date().toISOString();
    const assetId = "asset_0123456789abcdef";
    const intentId = "upl_0123456789ab";
    const transportUrl = new URL("https://synthetic.invalid/upload");
    transportUrl.searchParams.set("Synthetic-Credential", "CANARY_CREDENTIAL_VALUE");
    transportUrl.searchParams.set("Synthetic-Session", "CANARY_SESSION_VALUE");
    transportUrl.searchParams.set("Synthetic-Signature", "CANARY_SIGNATURE_VALUE");

    const transportResult: EvidenceUploadResult = {
      asset: {
        id: assetId,
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
        id: intentId,
        asset_id: assetId,
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

    const unsafeId = "https://synthetic.invalid/transport/CANARY_RECEIPT_ID";
    expect(() => toEvidenceUploadReceipt({
      asset: { ...transportResult.asset, id: unsafeId },
      intent: { ...transportResult.intent, asset_id: unsafeId },
    })).toThrow("Invalid evidence upload receipt");

    const safeError = redactSensitiveTransportText(`Upload failed: ${transportUrl.toString()}`);
    expect(safeError.includes("synthetic.invalid")).toBe(false);
    expect(safeError.includes("/upload")).toBe(false);
    expect(safeError.includes("Synthetic-Credential")).toBe(false);
    expect(safeError.includes("Synthetic-Session")).toBe(false);
    expect(safeError.includes("Synthetic-Signature")).toBe(false);
    expect(safeError.includes("CANARY_")).toBe(false);
    expect(safeError.includes("REDACTED")).toBe(true);
  });

  test("redacts structured, opaque-path, file, encoded, and header transport capabilities", () => {
    const opaqueUrl = "https://synthetic.invalid/transport/CANARY_OPAQUE_PATH";
    const fileUrl = "file:///tmp/CANARY_FILE_PATH";
    const encodedUrl = "https%3A%2F%2Fsynthetic.invalid%2Ftransport%2FCANARY_ENCODED_URL";
    const error = new HasnaHttpError("PUT", opaqueUrl, 503, {
      nested: {
        upload_url: opaqueUrl,
        file_url: fileUrl,
        required_headers: {
          Authorization: "Bearer CANARY_AUTHORIZATION_VALUE",
          "x-amz-security-token": "CANARY_AMZ_SESSION_VALUE",
        },
      },
      encoded: encodedUrl,
    });
    error.message = [
      `Upload failed at ${opaqueUrl}`,
      `local transport ${fileUrl}`,
      `encoded transport ${encodedUrl}`,
      "Authorization: Bearer CANARY_COLON_AUTH",
      "\"x-amz-signature\": \"CANARY_JSON_SIGNATURE\"",
      "X-Amz-Credential%3DCANARY_ENCODED_CREDENTIAL",
    ].join("; ");

    const sanitized = sanitizeEvidenceTransportError(error);
    const serialized = `${sanitized.message}\n${JSON.stringify(sanitized)}`;

    expect(sanitized).toBe(error);
    expect(sanitized).toBeInstanceOf(HasnaHttpError);
    expect((sanitized as HasnaHttpError).status).toBe(503);
    expect(serialized.includes("CANARY_")).toBe(false);
    expect(serialized.includes("synthetic.invalid")).toBe(false);
    expect(serialized.includes("file:///tmp")).toBe(false);
    expect(serialized.includes("https%3A%2F%2F")).toBe(false);
    expect(serialized.includes("REDACTED")).toBe(true);

    const looseText = redactSensitiveTransportText([
      opaqueUrl,
      fileUrl,
      encodedUrl,
      "Authorization: Bearer CANARY_LOOSE_AUTH",
      "x-amz-security-token=CANARY_LOOSE_SESSION",
    ].join(" "));
    expect(looseText.includes("CANARY_")).toBe(false);

    const circular = new Error("https://synthetic.invalid/CANARY_CIRCULAR");
    (circular as Error & { cause?: unknown }).cause = circular;
    const safeCircular = sanitizeEvidenceTransportError(circular);
    expect(`${safeCircular.message}${JSON.stringify(safeCircular)}`.includes("CANARY_CIRCULAR")).toBe(false);

    const withNativeCause = new Error("outer failure", {
      cause: new Error("https://synthetic.invalid/transport/CANARY_NATIVE_CAUSE"),
    });
    const safeNativeCause = sanitizeEvidenceTransportError(withNativeCause) as Error & { cause?: { message?: string } };
    expect(String(safeNativeCause.cause?.message).includes("CANARY_NATIVE_CAUSE")).toBe(false);

    const aggregate = new AggregateError(
      [new Error("Authorization: Bearer CANARY_AGGREGATE_ERROR")],
      "aggregate failure",
      { cause: new Error("file:///tmp/CANARY_AGGREGATE_CAUSE") },
    );
    const safeAggregate = sanitizeEvidenceTransportError(aggregate) as AggregateError & { cause?: { message?: string } };
    expect(String(safeAggregate.errors[0]?.message).includes("CANARY_AGGREGATE_ERROR")).toBe(false);
    expect(String(safeAggregate.cause?.message).includes("CANARY_AGGREGATE_CAUSE")).toBe(false);

    const immutable = new HasnaHttpError("PUT", opaqueUrl, 503, { safe: true });
    Object.defineProperty(immutable, "authorization", {
      configurable: false,
      enumerable: true,
      value: "Bearer CANARY_IMMUTABLE_AUTHORIZATION",
      writable: false,
    });
    Object.defineProperty(immutable, "message", {
      configurable: false,
      enumerable: false,
      value: "https://synthetic.invalid/CANARY_IMMUTABLE_MESSAGE",
      writable: false,
    });
    const safeImmutable = sanitizeEvidenceTransportError(immutable);
    const serializedImmutable = `${safeImmutable.message}\n${JSON.stringify(safeImmutable)}`;
    expect(safeImmutable).not.toBe(immutable);
    expect(safeImmutable).toBeInstanceOf(HasnaHttpError);
    expect((safeImmutable as HasnaHttpError).status).toBe(503);
    expect(serializedImmutable.includes("CANARY_IMMUTABLE")).toBe(false);
    expect(serializedImmutable.includes("synthetic.invalid")).toBe(false);

    const immutableAccessor = new Error("safe accessor failure");
    Object.defineProperty(immutableAccessor, "authorization", {
      configurable: false,
      enumerable: true,
      get: () => "Bearer CANARY_IMMUTABLE_ACCESSOR",
    });
    const safeAccessor = sanitizeEvidenceTransportError(immutableAccessor);
    expect(safeAccessor).not.toBe(immutableAccessor);
    expect(JSON.stringify(safeAccessor).includes("CANARY_IMMUTABLE_ACCESSOR")).toBe(false);

    const customSerializer = new Error("safe outer message") as Error & { toJSON?: () => unknown };
    customSerializer.toJSON = () => ({ authorization: "Bearer CANARY_CUSTOM_SERIALIZER" });
    const safeCustomSerializer = sanitizeEvidenceTransportError(customSerializer);
    expect(JSON.stringify(safeCustomSerializer).includes("CANARY_CUSTOM_SERIALIZER")).toBe(false);
  });

  test("preserves the public one-shot upload result contract", () => {
    const compatible: (
      input: UploadEvidenceFileInput,
      storage?: EvidenceStorageOptions,
      db?: EvidenceDb,
    ) => Promise<EvidenceUploadResult> = uploadEvidenceFile;
    expect(compatible).toBe(uploadEvidenceFile);
  });
});
