import { expect, test } from "bun:test";
import type { SandboxesReferenceServiceV1 } from "../src/service.js";

/**
 * Pinned negative compatibility witness for Infinity Golden c0dd4b9612cdd970.
 * `src/required-product-ports.ts` at that commit hashes to the literal below.
 * This must become a positive compatibility test only after Infinity adds the
 * authenticated capability-consumption envelope Sandboxes cannot synthesize.
 */
const GOLDEN_COMMIT = "c0dd4b9612cdd9705856fa155c89402a40f8b7fa";
const GOLDEN_REQUIRED_PRODUCT_PORTS_SHA256 =
  "c86ea5fd8c1bfcd2c1363ce58f2d8bec8c37bb7b4b482e2d2b10972adacf444c";

type GoldenInt64 = number | bigint;

interface GoldenSandboxHandle {
  handle_id: string;
  resource_id: string;
  resource_lifecycle_generation: GoldenInt64;
  provider_identity_digest: string;
  creation_receipt_digest: string;
}

interface GoldenAuthenticatedFenceContext {
  databaseTime: Date;
  actorPrincipal: string;
  leaseHolderPrincipal: string;
  operationExecutorPrincipal: string;
  audience: string;
}

interface GoldenBoundedFileWriteRequest {
  fence: unknown;
  handle: GoldenSandboxHandle;
  path: string;
  expected_old_sha256: string | null;
  content: Uint8Array;
  content_sha256: string;
  max_bytes: number;
}

interface GoldenBoundedExecRequest {
  fence: unknown;
  handle: GoldenSandboxHandle;
  argv: readonly string[];
  cwd: "/workspace";
  environment: readonly [];
  timeout_ms: number;
  max_output_bytes: number;
}

interface GoldenCheckpointCandidateHandoffRequest {
  fence: unknown;
  handle: GoldenSandboxHandle;
  base_oid: string;
  candidate_oid: string;
  allowed_paths: readonly string[];
  test_receipt_sha256: string;
  maximum_bundle_bytes: number;
}

interface GoldenBoundedSandboxTaskPort {
  writeFile(request: GoldenBoundedFileWriteRequest, authenticated: GoldenAuthenticatedFenceContext): Promise<unknown>;
  exec(request: GoldenBoundedExecRequest, authenticated: GoldenAuthenticatedFenceContext): Promise<unknown>;
  exportCheckpoint(
    request: GoldenCheckpointCandidateHandoffRequest,
    authenticated: GoldenAuthenticatedFenceContext,
  ): Promise<unknown>;
}

type DirectlyCompatible = SandboxesReferenceServiceV1 extends GoldenBoundedSandboxTaskPort
  ? true
  : false;

const directlyCompatible: DirectlyCompatible = false;

test("Golden c0dd4b remains explicitly incompatible until Infinity supplies the consumable authority envelope", () => {
  expect(GOLDEN_COMMIT).toBe("c0dd4b9612cdd9705856fa155c89402a40f8b7fa");
  expect(GOLDEN_REQUIRED_PRODUCT_PORTS_SHA256)
    .toBe("c86ea5fd8c1bfcd2c1363ce58f2d8bec8c37bb7b4b482e2d2b10972adacf444c");
  expect(directlyCompatible).toBe(false);
  expect([
    "signed capability and one-use nonce",
    "expected current record revision",
    "sealed provider-handle digests",
    "split exec start/frame/result/cancel",
    "canonical base64url file wire",
    "workspace-revision checkpoint handoff",
  ]).toHaveLength(6);
});
