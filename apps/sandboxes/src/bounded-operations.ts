import {
  assertDigest,
  assertOpaqueId,
  assertRfc3339,
  canonicalDigest,
  parsePositiveInt64,
  sha256,
  type Digest,
} from "./canonical.js";
import { SandboxError } from "./errors.js";
import type {
  AuthorizedBoundedCallContextV1,
  BoundedOperationResultV1,
  CheckpointCaptureGrantV1,
  CheckpointExportHandoffV1,
  CheckpointExportRequestV1,
  ExecCancelReceiptV1,
  ExecCancelRequestV1,
  ExecFramePageV1,
  ExecFrameReadRequestV1,
  ExecFrameV1,
  ExecResultV1,
  ExecResultRequestV1,
  ExecStartReceiptV1,
  ExecStartRequestV1,
  FileListPageV1,
  FileListRequestV1,
  FileReadReceiptV1,
  FileReadRequestV1,
  FileWriteReceiptV1,
  FileWriteRequestV1,
  SandboxHandleRefV1,
} from "./types.js";

function record(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SandboxError("validation_failed", `${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function closed(value: unknown, name: string, keys: readonly string[]): Record<string, unknown> {
  const parsed = record(value, name);
  if (
    Object.keys(parsed).length !== keys.length ||
    Object.keys(parsed).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(parsed, key))
  ) {
    throw new SandboxError("validation_failed", `${name} is not a closed V1 document`);
  }
  return parsed;
}

function literal<T extends string | number | boolean | null>(
  value: unknown,
  expected: T,
  name: string,
): T {
  if (value !== expected) throw new SandboxError("validation_failed", `${name} has an invalid value`);
  return expected;
}

function oneOf<const T extends readonly string[]>(value: unknown, values: T, name: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new SandboxError("validation_failed", `${name} has an invalid value`);
  }
  return value as T[number];
}

function integer(value: unknown, name: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new SandboxError("validation_failed", `${name} is outside the V1 bound`);
  }
  return value as number;
}

function text(value: unknown, name: string, maxBytes: number, allowEmpty = false): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    Buffer.byteLength(value, "utf8") > maxBytes ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new SandboxError("validation_failed", `${name} is not a bounded inert string`);
  }
  return value;
}

function path(value: unknown, name: string, allowRoot = false): string {
  const parsed = text(value, name, 4096, allowRoot);
  if (parsed === "" && allowRoot) return parsed;
  if (
    parsed !== parsed.normalize("NFC") ||
    parsed.startsWith("/") ||
    parsed.endsWith("/") ||
    parsed.includes("\\") ||
    parsed.includes(":") ||
    parsed.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new SandboxError("path_outside_workspace", `${name} must remain inside /workspace`);
  }
  return parsed;
}

function digest(value: unknown, name: string): Digest {
  assertDigest(value, name);
  return value;
}

function time(value: unknown, name: string): string {
  assertRfc3339(value, name);
  return value;
}

function nonNegativeBigInt(value: unknown, name: string): bigint {
  if (typeof value !== "bigint" || value < 0n) {
    throw new SandboxError("validation_failed", `${name} must be a non-negative bigint`);
  }
  return value;
}

function canonicalSignature(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{86}$/u.test(value) ||
      Buffer.from(value, "base64url").toString("base64url") !== value) {
    throw new SandboxError("validation_failed", `${name} must be canonical Ed25519 base64url`);
  }
  return value;
}

function verifySelfDigest(
  value: Record<string, unknown>,
  digestKey: string,
  name: string,
): Digest {
  const claimed = digest(value[digestKey], `${name}.${digestKey}`);
  const facts = Object.fromEntries(Object.entries(value).filter(([key]) => key !== digestKey));
  if (claimed !== canonicalDigest(facts)) {
    throw new SandboxError("integrity_failed", `${name} digest does not bind its closed fields`);
  }
  return claimed;
}

function validateCheckpointCaptureGrant(value: unknown): CheckpointCaptureGrantV1 {
  const v = closed(value, "checkpoint_capture_grant", [
    "schema_version", "grant_id", "checkpoint_id", "resource_id",
    "resource_lifecycle_generation", "operation_id", "handle_sha256",
    "expected_workspace_revision", "allowed_paths_sha256", "maximum_bundle_bytes",
    "sink_descriptor_sha256", "not_before", "expires_at", "one_use_nonce_sha256",
    "issuer_principal", "signing_key_id", "grant_sha256", "signature",
  ]);
  const facts = {
    schema_version: literal(
      v.schema_version,
      "sandboxes.checkpoint-capture-grant/v1",
      "checkpoint_capture_grant.schema_version",
    ),
    grant_id: opaqueId(v.grant_id, "checkpoint_capture_grant.grant_id", "grant"),
    checkpoint_id: opaqueId(v.checkpoint_id, "checkpoint_capture_grant.checkpoint_id", "checkpoint"),
    resource_id: opaqueId(v.resource_id, "checkpoint_capture_grant.resource_id", "sbx"),
    resource_lifecycle_generation: parsePositiveInt64(
      v.resource_lifecycle_generation,
      "checkpoint_capture_grant.resource_lifecycle_generation",
    ),
    operation_id: opaqueId(v.operation_id, "checkpoint_capture_grant.operation_id", "op"),
    handle_sha256: digest(v.handle_sha256, "checkpoint_capture_grant.handle_sha256"),
    expected_workspace_revision: nonNegativeBigInt(
      v.expected_workspace_revision,
      "checkpoint_capture_grant.expected_workspace_revision",
    ),
    allowed_paths_sha256: digest(v.allowed_paths_sha256, "checkpoint_capture_grant.allowed_paths_sha256"),
    maximum_bundle_bytes: integer(
      v.maximum_bundle_bytes,
      "checkpoint_capture_grant.maximum_bundle_bytes",
      1,
      1024 * 1024 * 1024,
    ),
    sink_descriptor_sha256: digest(
      v.sink_descriptor_sha256,
      "checkpoint_capture_grant.sink_descriptor_sha256",
    ),
    not_before: time(v.not_before, "checkpoint_capture_grant.not_before"),
    expires_at: time(v.expires_at, "checkpoint_capture_grant.expires_at"),
    one_use_nonce_sha256: digest(
      v.one_use_nonce_sha256,
      "checkpoint_capture_grant.one_use_nonce_sha256",
    ),
    issuer_principal: opaqueId(v.issuer_principal, "checkpoint_capture_grant.issuer_principal", "principal"),
    signing_key_id: opaqueId(v.signing_key_id, "checkpoint_capture_grant.signing_key_id", "key"),
  };
  const grantSha256 = digest(v.grant_sha256, "checkpoint_capture_grant.grant_sha256");
  if (grantSha256 !== canonicalDigest(facts)) {
    throw new SandboxError("integrity_failed", "Checkpoint capture grant digest differs");
  }
  return {
    ...facts,
    grant_sha256: grantSha256,
    signature: canonicalSignature(v.signature, "checkpoint_capture_grant.signature"),
  };
}

function opaqueId(value: unknown, name: string, prefix: string): string {
  assertOpaqueId(value, name, prefix);
  return value;
}

function canonicalBase64url(value: unknown, name: string, maxBytes: number): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new SandboxError("validation_failed", `${name} must be canonical unpadded base64url`);
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value || decoded.byteLength > maxBytes) {
    throw new SandboxError("resource_limit_exceeded", `${name} exceeds its declared bound`);
  }
  return decoded;
}

export function validateSandboxHandleRef(value: unknown): SandboxHandleRefV1 {
  const v = closed(value, "handle", [
    "schema_version",
    "resource_id",
    "resource_lease_id",
    "resource_lifecycle_generation",
    "provider_handle_sha256",
    "provider_identity_sha256",
    "immutable_fingerprint_sha256",
  ]);
  return {
    schema_version: literal(v.schema_version, "sandboxes.handle-ref/v1", "handle.schema_version"),
    resource_id: opaqueId(v.resource_id, "handle.resource_id", "sbx"),
    resource_lease_id: opaqueId(v.resource_lease_id, "handle.resource_lease_id", "resource_lease"),
    resource_lifecycle_generation: parsePositiveInt64(
      v.resource_lifecycle_generation,
      "handle.resource_lifecycle_generation",
    ),
    provider_handle_sha256: digest(v.provider_handle_sha256, "handle.provider_handle_sha256"),
    provider_identity_sha256: digest(v.provider_identity_sha256, "handle.provider_identity_sha256"),
    immutable_fingerprint_sha256: digest(
      v.immutable_fingerprint_sha256,
      "handle.immutable_fingerprint_sha256",
    ),
  };
}

export function validateExecStartRequest(value: unknown): ExecStartRequestV1 {
  const v = closed(value, "exec_start", [
    "schema_version", "handle", "exec_id", "executable", "argv", "cwd",
    "environment_profile_id", "timeout_ms", "max_output_bytes", "tty",
  ]);
  if (!Array.isArray(v.argv) || v.argv.length > 128) {
    throw new SandboxError("validation_failed", "exec_start.argv must be a bounded argv array");
  }
  const argv = v.argv.map((item, index) => text(item, `exec_start.argv.${index}`, 4096, true));
  if (argv.reduce((total, item) => total + Buffer.byteLength(item), 0) > 65_536) {
    throw new SandboxError("resource_limit_exceeded", "exec_start.argv exceeds the aggregate byte bound");
  }
  return {
    schema_version: literal(v.schema_version, "sandboxes.exec-start-request/v1", "exec_start.schema_version"),
    handle: validateSandboxHandleRef(v.handle),
    exec_id: opaqueId(v.exec_id, "exec_start.exec_id", "exec"),
    executable: text(v.executable, "exec_start.executable", 4096),
    argv,
    cwd: literal(v.cwd, "/workspace", "exec_start.cwd"),
    environment_profile_id: oneOf(
      v.environment_profile_id,
      ["minimal-v1", "build-v1", "test-v1"] as const,
      "exec_start.environment_profile_id",
    ),
    timeout_ms: integer(v.timeout_ms, "exec_start.timeout_ms", 1, 604_800_000),
    max_output_bytes: integer(v.max_output_bytes, "exec_start.max_output_bytes", 1, 64 * 1024 * 1024),
    tty: literal(v.tty, false, "exec_start.tty"),
  };
}

export function validateExecFrameReadRequest(value: unknown): ExecFrameReadRequestV1 {
  const v = closed(value, "exec_frames", [
    "schema_version", "handle", "exec_id", "cursor", "prior_stream_root_sha256",
    "resume_token", "resume_token_sha256", "next_expected_sequence",
    "max_frames", "max_bytes", "wait_ms",
  ]);
  return {
    schema_version: literal(v.schema_version, "sandboxes.exec-frame-read-request/v1", "exec_frames.schema_version"),
    handle: validateSandboxHandleRef(v.handle),
    exec_id: opaqueId(v.exec_id, "exec_frames.exec_id", "exec"),
    cursor: text(v.cursor, "exec_frames.cursor", 512),
    prior_stream_root_sha256: digest(v.prior_stream_root_sha256, "exec_frames.prior_stream_root_sha256"),
    resume_token: text(v.resume_token, "exec_frames.resume_token", 512),
    resume_token_sha256: digest(v.resume_token_sha256, "exec_frames.resume_token_sha256"),
    next_expected_sequence: parsePositiveInt64(
      v.next_expected_sequence, "exec_frames.next_expected_sequence",
    ),
    max_frames: integer(v.max_frames, "exec_frames.max_frames", 1, 100),
    max_bytes: integer(v.max_bytes, "exec_frames.max_bytes", 1, 1024 * 1024),
    wait_ms: integer(v.wait_ms, "exec_frames.wait_ms", 0, 30_000),
  };
}

export function validateExecResultRequest(value: unknown): ExecResultRequestV1 {
  const v = closed(value, "exec_result", [
    "schema_version", "handle", "exec_id", "prior_stream_root_sha256",
    "resume_token", "resume_token_sha256", "next_expected_sequence",
  ]);
  return {
    schema_version: literal(v.schema_version, "sandboxes.exec-result-request/v1", "exec_result.schema_version"),
    handle: validateSandboxHandleRef(v.handle),
    exec_id: opaqueId(v.exec_id, "exec_result.exec_id", "exec"),
    prior_stream_root_sha256: digest(v.prior_stream_root_sha256, "exec_result.prior_stream_root_sha256"),
    resume_token: text(v.resume_token, "exec_result.resume_token", 512),
    resume_token_sha256: digest(v.resume_token_sha256, "exec_result.resume_token_sha256"),
    next_expected_sequence: parsePositiveInt64(
      v.next_expected_sequence, "exec_result.next_expected_sequence",
    ),
  };
}

export function validateExecCancelRequest(value: unknown): ExecCancelRequestV1 {
  const v = closed(value, "exec_cancel", ["schema_version", "handle", "exec_id", "reason", "grace_ms"]);
  return {
    schema_version: literal(v.schema_version, "sandboxes.exec-cancel-request/v1", "exec_cancel.schema_version"),
    handle: validateSandboxHandleRef(v.handle),
    exec_id: opaqueId(v.exec_id, "exec_cancel.exec_id", "exec"),
    reason: oneOf(
      v.reason,
      ["explicit", "wall_deadline", "idle_deadline", "output_limit", "lease_loss"] as const,
      "exec_cancel.reason",
    ),
    grace_ms: integer(v.grace_ms, "exec_cancel.grace_ms", 0, 10_000),
  };
}

export function validateFileReadRequest(value: unknown): FileReadRequestV1 {
  const v = closed(value, "file_read", [
    "schema_version", "handle", "path", "offset_bytes", "length_bytes", "expected_file_sha256",
  ]);
  return {
    schema_version: literal(v.schema_version, "sandboxes.file-read-request/v1", "file_read.schema_version"),
    handle: validateSandboxHandleRef(v.handle),
    path: path(v.path, "file_read.path"),
    offset_bytes: integer(v.offset_bytes, "file_read.offset_bytes", 0, Number.MAX_SAFE_INTEGER),
    length_bytes: integer(v.length_bytes, "file_read.length_bytes", 1, 1024 * 1024),
    expected_file_sha256: digest(v.expected_file_sha256, "file_read.expected_file_sha256"),
  };
}

export function validateFileWriteRequest(value: unknown): FileWriteRequestV1 {
  const v = closed(value, "file_write", [
    "schema_version", "handle", "path", "expected_prior_sha256", "content_base64url",
    "content_sha256", "max_bytes",
  ]);
  const maxBytes = integer(v.max_bytes, "file_write.max_bytes", 1, 64 * 1024 * 1024);
  const bytes = canonicalBase64url(v.content_base64url, "file_write.content_base64url", maxBytes);
  const contentSha256 = digest(v.content_sha256, "file_write.content_sha256");
  if (sha256(bytes) !== contentSha256) {
    throw new SandboxError("integrity_failed", "file_write bytes do not match content_sha256");
  }
  return {
    schema_version: literal(v.schema_version, "sandboxes.file-write-request/v1", "file_write.schema_version"),
    handle: validateSandboxHandleRef(v.handle),
    path: path(v.path, "file_write.path"),
    expected_prior_sha256: v.expected_prior_sha256 === null
      ? null
      : digest(v.expected_prior_sha256, "file_write.expected_prior_sha256"),
    content_base64url: v.content_base64url as string,
    content_sha256: contentSha256,
    max_bytes: maxBytes,
  };
}

export function validateFileListRequest(value: unknown): FileListRequestV1 {
  const v = closed(value, "file_list", [
    "schema_version", "handle", "root", "recursive", "cursor", "limit",
  ]);
  return {
    schema_version: literal(v.schema_version, "sandboxes.file-list-request/v1", "file_list.schema_version"),
    handle: validateSandboxHandleRef(v.handle),
    root: path(v.root, "file_list.root", true),
    recursive: typeof v.recursive === "boolean"
      ? v.recursive
      : (() => { throw new SandboxError("validation_failed", "file_list.recursive must be boolean"); })(),
    cursor: v.cursor === null ? null : text(v.cursor, "file_list.cursor", 512),
    limit: integer(v.limit, "file_list.limit", 1, 1000),
  };
}

export function validateCheckpointExportRequest(value: unknown): CheckpointExportRequestV1 {
  const v = closed(value, "checkpoint_export", [
    "schema_version", "handle", "checkpoint_id", "expected_workspace_revision",
    "allowed_paths", "maximum_bundle_bytes", "sink_descriptor_sha256",
    "capture_mode", "capture_grant",
  ]);
  if (!Array.isArray(v.allowed_paths) || v.allowed_paths.length > 1000) {
    throw new SandboxError("validation_failed", "checkpoint_export.allowed_paths must be bounded");
  }
  const allowedPaths = v.allowed_paths.map((item, index) => path(item, `checkpoint_export.allowed_paths.${index}`));
  if (new Set(allowedPaths).size !== allowedPaths.length || [...allowedPaths].sort().some((item, i) => item !== allowedPaths[i])) {
    throw new SandboxError("validation_failed", "checkpoint_export.allowed_paths must be unique and sorted");
  }
  const handle = validateSandboxHandleRef(v.handle);
  const checkpointId = opaqueId(v.checkpoint_id, "checkpoint_export.checkpoint_id", "checkpoint");
  const expectedWorkspaceRevision = nonNegativeBigInt(
    v.expected_workspace_revision,
    "checkpoint_export.expected_workspace_revision",
  );
  const maximumBundleBytes = integer(
    v.maximum_bundle_bytes,
    "checkpoint_export.maximum_bundle_bytes",
    1,
    1024 * 1024 * 1024,
  );
  const sinkDescriptorSha256 = digest(
    v.sink_descriptor_sha256,
    "checkpoint_export.sink_descriptor_sha256",
  );
  const captureGrant = validateCheckpointCaptureGrant(v.capture_grant);
  if (
    captureGrant.checkpoint_id !== checkpointId ||
    captureGrant.resource_id !== handle.resource_id ||
    captureGrant.resource_lifecycle_generation !== handle.resource_lifecycle_generation ||
    captureGrant.handle_sha256 !== canonicalDigest(handle) ||
    captureGrant.expected_workspace_revision !== expectedWorkspaceRevision ||
    captureGrant.allowed_paths_sha256 !== canonicalDigest(allowedPaths) ||
    captureGrant.maximum_bundle_bytes !== maximumBundleBytes ||
    captureGrant.sink_descriptor_sha256 !== sinkDescriptorSha256
  ) {
    throw new SandboxError("capability_denied", "Checkpoint capture grant does not bind the exact request");
  }
  return {
    schema_version: literal(
      v.schema_version,
      "sandboxes.checkpoint-export-request/v1",
      "checkpoint_export.schema_version",
    ),
    handle,
    checkpoint_id: checkpointId,
    expected_workspace_revision: expectedWorkspaceRevision,
    allowed_paths: allowedPaths,
    maximum_bundle_bytes: maximumBundleBytes,
    sink_descriptor_sha256: sinkDescriptorSha256,
    capture_mode: literal(v.capture_mode, "quiesced", "checkpoint_export.capture_mode"),
    capture_grant: captureGrant,
  };
}

export function boundedOperationRequestDigest(request: unknown): Digest {
  return canonicalDigest(request);
}

function assertBoundResource(
  value: Record<string, unknown>,
  request: { handle: SandboxHandleRefV1 },
  name: string,
): void {
  if (
    opaqueId(value.resource_id, `${name}.resource_id`, "sbx") !== request.handle.resource_id ||
    parsePositiveInt64(
      value.resource_lifecycle_generation,
      `${name}.resource_lifecycle_generation`,
    ) !== request.handle.resource_lifecycle_generation
  ) {
    throw new SandboxError("integrity_failed", `${name} changed the bound resource incarnation`);
  }
}

function validateExecStartReceipt(
  value: unknown,
  request: ExecStartRequestV1,
  ctx: AuthorizedBoundedCallContextV1,
): ExecStartReceiptV1 {
  const v = closed(value, "exec_start_receipt", [
    "schema_version", "resource_id", "resource_lifecycle_generation", "exec_id",
    "request_sha256", "state", "initial_cursor", "initial_cursor_sha256",
    "stream_root_sha256", "initial_resume_token", "initial_resume_token_sha256",
    "next_expected_sequence", "adapter_exec_fingerprint_sha256", "started_at",
    "receipt_sha256",
  ]);
  literal(v.schema_version, "sandboxes.exec-start-receipt/v1", "exec_start_receipt.schema_version");
  assertBoundResource(v, request, "exec_start_receipt");
  if (
    opaqueId(v.exec_id, "exec_start_receipt.exec_id", "exec") !== request.exec_id ||
    digest(v.request_sha256, "exec_start_receipt.request_sha256") !== ctx.request_sha256 ||
    literal(v.state, "running", "exec_start_receipt.state") !== "running"
  ) {
    throw new SandboxError("integrity_failed", "Exec start receipt changed its exact request");
  }
  const cursor = text(v.initial_cursor, "exec_start_receipt.initial_cursor", 512);
  if (digest(v.initial_cursor_sha256, "exec_start_receipt.initial_cursor_sha256") !== sha256(cursor)) {
    throw new SandboxError("integrity_failed", "Exec initial cursor digest differs");
  }
  const resumeToken = text(v.initial_resume_token, "exec_start_receipt.initial_resume_token", 512);
  const resumeTokenSha256 = sha256(resumeToken);
  const streamRootSha256 = digest(v.stream_root_sha256, "exec_start_receipt.stream_root_sha256");
  if (streamRootSha256 !== canonicalDigest({
    exec_id: request.exec_id,
    cursor_sha256: sha256(cursor),
    resume_token_sha256: resumeTokenSha256,
    next_expected_sequence: 1n,
  })) {
    throw new SandboxError("integrity_failed", "Exec initial stream root differs");
  }
  if (
    digest(v.initial_resume_token_sha256, "exec_start_receipt.initial_resume_token_sha256") !==
      resumeTokenSha256 ||
    parsePositiveInt64(v.next_expected_sequence, "exec_start_receipt.next_expected_sequence") !== 1n
  ) {
    throw new SandboxError("integrity_failed", "Exec initial resume token or sequence differs");
  }
  digest(v.adapter_exec_fingerprint_sha256, "exec_start_receipt.adapter_exec_fingerprint_sha256");
  time(v.started_at, "exec_start_receipt.started_at");
  verifySelfDigest(v, "receipt_sha256", "exec_start_receipt");
  return value as ExecStartReceiptV1;
}

function validateExecFrame(value: unknown, execId: string, prior: Digest): ExecFrameV1 {
  const v = closed(value, "exec_frame", [
    "schema_version", "exec_id", "sequence", "prior_frame_sha256", "kind",
    "payload_base64url", "payload_length", "payload_sha256", "observed_at",
    "frame_sha256",
  ]);
  literal(v.schema_version, "sandboxes.exec-frame/v1", "exec_frame.schema_version");
  if (opaqueId(v.exec_id, "exec_frame.exec_id", "exec") !== execId) {
    throw new SandboxError("integrity_failed", "Exec frame changed exec identity");
  }
  parsePositiveInt64(v.sequence, "exec_frame.sequence");
  if (digest(v.prior_frame_sha256, "exec_frame.prior_frame_sha256") !== prior) {
    throw new SandboxError("integrity_failed", "Exec frame chain has a gap or fork");
  }
  oneOf(
    v.kind,
    ["stdout", "stderr", "status", "heartbeat", "terminal", "error"] as const,
    "exec_frame.kind",
  );
  const payload = canonicalBase64url(v.payload_base64url, "exec_frame.payload_base64url", 1024 * 1024);
  if (
    integer(v.payload_length, "exec_frame.payload_length", 0, 1024 * 1024) !== payload.byteLength ||
    digest(v.payload_sha256, "exec_frame.payload_sha256") !== sha256(payload)
  ) {
    throw new SandboxError("integrity_failed", "Exec frame payload bytes, length, or digest differ");
  }
  time(v.observed_at, "exec_frame.observed_at");
  verifySelfDigest(v, "frame_sha256", "exec_frame");
  return value as ExecFrameV1;
}

function validateExecFramePage(
  value: unknown,
  request: ExecFrameReadRequestV1,
): ExecFramePageV1 {
  const v = closed(value, "exec_frame_page", [
    "schema_version", "exec_id", "from_cursor_sha256", "from_resume_token_sha256",
    "prior_stream_root_sha256", "first_sequence", "frames", "page_frames_root_sha256",
    "next_cursor", "next_cursor_sha256", "next_resume_token", "next_resume_token_sha256",
    "next_expected_sequence", "next_stream_root_sha256", "has_more", "terminal",
    "gap_detected", "gap_proof_sha256", "returned_frames", "returned_bytes",
    "receipt_sha256",
  ]);
  literal(v.schema_version, "sandboxes.exec-frame-page/v1", "exec_frame_page.schema_version");
  if (opaqueId(v.exec_id, "exec_frame_page.exec_id", "exec") !== request.exec_id) {
    throw new SandboxError("integrity_failed", "Exec frame page changed exec identity");
  }
  const fromCursorSha256 = sha256(request.cursor);
  if (digest(v.from_cursor_sha256, "exec_frame_page.from_cursor_sha256") !== fromCursorSha256) {
    throw new SandboxError("integrity_failed", "Exec frame page does not bind the requested cursor");
  }
  if (
    request.resume_token_sha256 !== sha256(request.resume_token) ||
    digest(v.from_resume_token_sha256, "exec_frame_page.from_resume_token_sha256") !==
      request.resume_token_sha256
  ) {
    throw new SandboxError("integrity_failed", "Exec frame page does not bind the resume token");
  }
  const priorStreamRoot = digest(v.prior_stream_root_sha256, "exec_frame_page.prior_stream_root_sha256");
  if (priorStreamRoot !== request.prior_stream_root_sha256) {
    throw new SandboxError("integrity_failed", "Exec page changed the persisted prior stream root");
  }
  if (!Array.isArray(v.frames) || v.frames.length > request.max_frames) {
    throw new SandboxError("resource_limit_exceeded", "Exec frame page exceeds max_frames");
  }
  const frames: ExecFrameV1[] = [];
  let prior = priorStreamRoot;
  let priorSequence = request.next_expected_sequence - 1n;
  if (
    parsePositiveInt64(v.first_sequence, "exec_frame_page.first_sequence") !==
      request.next_expected_sequence
  ) {
    throw new SandboxError("integrity_failed", "Exec page reset or skipped its first sequence");
  }
  for (const raw of v.frames) {
    const frame = validateExecFrame(raw, request.exec_id, prior);
    if (frame.sequence !== priorSequence + 1n) {
      throw new SandboxError("integrity_failed", "Exec frame sequence is not contiguous");
    }
    frames.push(frame);
    prior = frame.frame_sha256;
    priorSequence = frame.sequence;
  }
  const pageFramesRoot = canonicalDigest(frames.map((frame) => frame.frame_sha256));
  if (digest(v.page_frames_root_sha256, "exec_frame_page.page_frames_root_sha256") !== pageFramesRoot) {
    throw new SandboxError("integrity_failed", "Exec page frame root differs");
  }
  const nextCursor = text(v.next_cursor, "exec_frame_page.next_cursor", 512);
  const nextCursorSha256 = sha256(nextCursor);
  if (digest(v.next_cursor_sha256, "exec_frame_page.next_cursor_sha256") !== nextCursorSha256) {
    throw new SandboxError("integrity_failed", "Exec next cursor digest differs");
  }
  const nextResumeToken = text(v.next_resume_token, "exec_frame_page.next_resume_token", 512);
  const nextResumeTokenSha256 = sha256(nextResumeToken);
  if (
    digest(v.next_resume_token_sha256, "exec_frame_page.next_resume_token_sha256") !==
      nextResumeTokenSha256
  ) {
    throw new SandboxError("integrity_failed", "Exec next resume token digest differs");
  }
  const nextExpectedSequence = priorSequence + 1n;
  if (parsePositiveInt64(v.next_expected_sequence, "exec_frame_page.next_expected_sequence") !== nextExpectedSequence) {
    throw new SandboxError("integrity_failed", "Exec next expected sequence differs");
  }
  const nextStreamRoot = canonicalDigest({
    exec_id: request.exec_id,
    prior_stream_root_sha256: priorStreamRoot,
    from_resume_token_sha256: request.resume_token_sha256,
    first_sequence: request.next_expected_sequence,
    page_frames_root_sha256: pageFramesRoot,
    next_cursor_sha256: nextCursorSha256,
    next_resume_token_sha256: nextResumeTokenSha256,
    next_expected_sequence: nextExpectedSequence,
  });
  if (digest(v.next_stream_root_sha256, "exec_frame_page.next_stream_root_sha256") !== nextStreamRoot) {
    throw new SandboxError("integrity_failed", "Exec next stream root differs");
  }
  if (v.gap_detected !== false) {
    throw new SandboxError("integrity_failed", "Exec adapter reported a stream gap");
  }
  const gapProof = canonicalDigest({
    gap_detected: false,
    prior_stream_root_sha256: priorStreamRoot,
    next_stream_root_sha256: nextStreamRoot,
  });
  if (digest(v.gap_proof_sha256, "exec_frame_page.gap_proof_sha256") !== gapProof) {
    throw new SandboxError("integrity_failed", "Exec no-gap proof differs");
  }
  if (typeof v.has_more !== "boolean" || typeof v.terminal !== "boolean") {
    throw new SandboxError("validation_failed", "Exec page flags must be booleans");
  }
  const terminalFrameIndexes = frames
    .map((frame, index) => frame.kind === "terminal" ? index : -1)
    .filter((index) => index >= 0);
  if (
    terminalFrameIndexes.length > 1 ||
    (v.terminal && (
      terminalFrameIndexes.length !== 1 ||
      terminalFrameIndexes[0] !== frames.length - 1
    )) ||
    (!v.terminal && terminalFrameIndexes.length !== 0) ||
    (v.terminal && v.has_more)
  ) {
    throw new SandboxError(
      "integrity_failed",
      "Exec page terminal flags and frame ordering are inconsistent",
    );
  }
  const terminalFrame = frames.at(-1);
  if (
    terminalFrame?.kind === "terminal" &&
    (terminalFrame.payload_length !== 0 || terminalFrame.payload_base64url !== "")
  ) {
    throw new SandboxError("integrity_failed", "Exec terminal frame must have an empty payload");
  }
  const returnedFrames = integer(v.returned_frames, "exec_frame_page.returned_frames", 0, request.max_frames);
  const returnedBytes = integer(v.returned_bytes, "exec_frame_page.returned_bytes", 0, request.max_bytes);
  if (
    returnedFrames !== frames.length ||
    returnedBytes !== frames.reduce((sum, frame) => sum + frame.payload_length, 0)
  ) {
    throw new SandboxError("integrity_failed", "Exec page counts do not match frame bytes");
  }
  verifySelfDigest(v, "receipt_sha256", "exec_frame_page");
  return value as ExecFramePageV1;
}

function validateExecResult(value: unknown, request: ExecResultRequestV1): ExecResultV1 {
  const v = closed(value, "exec_result", [
    "schema_version", "resource_id", "resource_lifecycle_generation", "exec_id",
    "state", "exit_code", "stdout_sha256", "stderr_sha256", "output_bytes",
    "final_stream_root_sha256", "final_resume_token_sha256",
    "final_next_expected_sequence", "terminal_at", "receipt_sha256",
  ]);
  literal(v.schema_version, "sandboxes.exec-result/v1", "exec_result.schema_version");
  assertBoundResource(v, request, "exec_result");
  if (opaqueId(v.exec_id, "exec_result.exec_id", "exec") !== request.exec_id) {
    throw new SandboxError("integrity_failed", "Exec result changed exec identity");
  }
  const state = oneOf(
    v.state,
    ["running", "succeeded", "failed", "canceled", "timed_out", "output_limited"] as const,
    "exec_result.state",
  );
  if (v.exit_code !== null && (!Number.isSafeInteger(v.exit_code) || (v.exit_code as number) < -1 || (v.exit_code as number) > 255)) {
    throw new SandboxError("validation_failed", "Exec result exit_code is outside its bound");
  }
  digest(v.stdout_sha256, "exec_result.stdout_sha256");
  digest(v.stderr_sha256, "exec_result.stderr_sha256");
  integer(v.output_bytes, "exec_result.output_bytes", 0, 64 * 1024 * 1024);
  if (
    request.resume_token_sha256 !== sha256(request.resume_token) ||
    digest(v.final_stream_root_sha256, "exec_result.final_stream_root_sha256") !==
      request.prior_stream_root_sha256 ||
    digest(v.final_resume_token_sha256, "exec_result.final_resume_token_sha256") !==
      request.resume_token_sha256 ||
    parsePositiveInt64(v.final_next_expected_sequence, "exec_result.final_next_expected_sequence") !==
      request.next_expected_sequence
  ) {
    throw new SandboxError("integrity_failed", "Exec result changed the durable final stream state");
  }
  if (v.terminal_at !== null) time(v.terminal_at, "exec_result.terminal_at");
  if (
    (state === "running" && (v.exit_code !== null || v.terminal_at !== null)) ||
    (state !== "running" && v.terminal_at === null) ||
    (state === "succeeded" && v.exit_code !== 0) ||
    (state === "failed" && (v.exit_code === null || v.exit_code === 0)) ||
    (["canceled", "timed_out", "output_limited"] as const).includes(
      state as "canceled" | "timed_out" | "output_limited",
    ) && v.exit_code !== null
  ) {
    throw new SandboxError(
      "integrity_failed",
      "Exec result state, exit code, and terminal timestamp are inconsistent",
    );
  }
  verifySelfDigest(v, "receipt_sha256", "exec_result");
  return value as ExecResultV1;
}

function validateExecCancelReceipt(value: unknown, request: ExecCancelRequestV1): ExecCancelReceiptV1 {
  const v = closed(value, "exec_cancel_receipt", [
    "schema_version", "resource_id", "resource_lifecycle_generation", "exec_id",
    "state", "whole_scope_terminated", "process_stop_evidence_sha256",
    "observed_at", "receipt_sha256",
  ]);
  literal(v.schema_version, "sandboxes.exec-cancel-receipt/v1", "exec_cancel_receipt.schema_version");
  assertBoundResource(v, request, "exec_cancel_receipt");
  if (opaqueId(v.exec_id, "exec_cancel_receipt.exec_id", "exec") !== request.exec_id) {
    throw new SandboxError("integrity_failed", "Exec cancel changed exec identity");
  }
  const state = oneOf(v.state, ["canceled", "already_terminal"] as const, "exec_cancel_receipt.state");
  if (typeof v.whole_scope_terminated !== "boolean" || (state === "canceled" && v.whole_scope_terminated !== true)) {
    throw new SandboxError("integrity_failed", "Exec cancel lacks whole-scope termination");
  }
  digest(v.process_stop_evidence_sha256, "exec_cancel_receipt.process_stop_evidence_sha256");
  time(v.observed_at, "exec_cancel_receipt.observed_at");
  verifySelfDigest(v, "receipt_sha256", "exec_cancel_receipt");
  return value as ExecCancelReceiptV1;
}

function validateFileReadReceipt(value: unknown, request: FileReadRequestV1): FileReadReceiptV1 {
  const v = closed(value, "file_read_receipt", [
    "schema_version", "resource_id", "resource_lifecycle_generation", "workspace_revision",
    "path", "offset_bytes", "content_base64url", "returned_bytes", "content_sha256",
    "total_file_sha256", "range_proof_sha256", "file_revision_sha256", "receipt_sha256",
  ]);
  literal(v.schema_version, "sandboxes.file-read-receipt/v1", "file_read_receipt.schema_version");
  assertBoundResource(v, request, "file_read_receipt");
  nonNegativeBigInt(v.workspace_revision, "file_read_receipt.workspace_revision");
  if (v.path !== request.path || v.offset_bytes !== request.offset_bytes) {
    throw new SandboxError("integrity_failed", "File read receipt changed path or offset");
  }
  const content = canonicalBase64url(v.content_base64url, "file_read_receipt.content_base64url", request.length_bytes);
  if (v.returned_bytes !== content.byteLength || content.byteLength > request.length_bytes) {
    throw new SandboxError("integrity_failed", "File read returned byte count differs");
  }
  const contentSha256 = sha256(content);
  if (digest(v.content_sha256, "file_read_receipt.content_sha256") !== contentSha256) {
    throw new SandboxError("integrity_failed", "File read content digest differs from returned bytes");
  }
  if (digest(v.total_file_sha256, "file_read_receipt.total_file_sha256") !== request.expected_file_sha256) {
    throw new SandboxError("integrity_failed", "File read changed expected file digest");
  }
  if (digest(v.range_proof_sha256, "file_read_receipt.range_proof_sha256") !== canonicalDigest({
    total_file_sha256: request.expected_file_sha256,
    offset_bytes: request.offset_bytes,
    content_sha256: contentSha256,
    returned_bytes: content.byteLength,
  })) {
    throw new SandboxError("integrity_failed", "File read range proof differs");
  }
  digest(v.file_revision_sha256, "file_read_receipt.file_revision_sha256");
  verifySelfDigest(v, "receipt_sha256", "file_read_receipt");
  return value as FileReadReceiptV1;
}

function validateFileWriteReceipt(value: unknown, request: FileWriteRequestV1): FileWriteReceiptV1 {
  const v = closed(value, "file_write_receipt", [
    "schema_version", "resource_id", "resource_lifecycle_generation",
    "workspace_revision_before", "workspace_revision_after", "path", "prior_sha256",
    "content_sha256", "byte_length", "file_revision_sha256", "receipt_sha256",
  ]);
  literal(v.schema_version, "sandboxes.file-write-receipt/v1", "file_write_receipt.schema_version");
  assertBoundResource(v, request, "file_write_receipt");
  const before = nonNegativeBigInt(v.workspace_revision_before, "file_write_receipt.workspace_revision_before");
  const after = nonNegativeBigInt(v.workspace_revision_after, "file_write_receipt.workspace_revision_after");
  if (
    after !== before + 1n || v.path !== request.path ||
    v.prior_sha256 !== request.expected_prior_sha256 ||
    digest(v.content_sha256, "file_write_receipt.content_sha256") !== request.content_sha256 ||
    v.byte_length !== Buffer.from(request.content_base64url, "base64url").byteLength
  ) {
    throw new SandboxError("integrity_failed", "File write receipt does not bind the exact mutation bytes");
  }
  digest(v.file_revision_sha256, "file_write_receipt.file_revision_sha256");
  verifySelfDigest(v, "receipt_sha256", "file_write_receipt");
  return value as FileWriteReceiptV1;
}

function validateFileListPage(value: unknown, request: FileListRequestV1): FileListPageV1 {
  const v = closed(value, "file_list_page", [
    "schema_version", "resource_id", "resource_lifecycle_generation", "workspace_revision",
    "snapshot_sha256", "entries", "next_cursor", "receipt_sha256",
  ]);
  literal(v.schema_version, "sandboxes.file-list-page/v1", "file_list_page.schema_version");
  assertBoundResource(v, request, "file_list_page");
  const workspaceRevision = nonNegativeBigInt(v.workspace_revision, "file_list_page.workspace_revision");
  if (!Array.isArray(v.entries) || v.entries.length > request.limit) {
    throw new SandboxError("resource_limit_exceeded", "File list page exceeds caller limit");
  }
  const entries = v.entries.map((raw, index) => {
    const entry = closed(raw, `file_list_page.entries.${index}`, [
      "path", "type", "size_bytes", "content_sha256", "file_revision_sha256",
    ]);
    return {
      path: path(entry.path, `file_list_page.entries.${index}.path`),
      type: literal(entry.type, "file", `file_list_page.entries.${index}.type`),
      size_bytes: integer(entry.size_bytes, `file_list_page.entries.${index}.size_bytes`, 0, Number.MAX_SAFE_INTEGER),
      content_sha256: digest(entry.content_sha256, `file_list_page.entries.${index}.content_sha256`),
      file_revision_sha256: digest(entry.file_revision_sha256, `file_list_page.entries.${index}.file_revision_sha256`),
    };
  });
  if (entries.some((entry, index) => index > 0 && entries[index - 1]!.path >= entry.path)) {
    throw new SandboxError("integrity_failed", "File list entries are not unique and ordered");
  }
  if (digest(v.snapshot_sha256, "file_list_page.snapshot_sha256") !== canonicalDigest({ workspace_revision: workspaceRevision, entries })) {
    throw new SandboxError("integrity_failed", "File list snapshot root differs");
  }
  if (v.next_cursor !== null) text(v.next_cursor, "file_list_page.next_cursor", 512);
  verifySelfDigest(v, "receipt_sha256", "file_list_page");
  return value as FileListPageV1;
}

function validateCheckpointHandoff(
  value: unknown,
  request: CheckpointExportRequestV1,
  ctx: AuthorizedBoundedCallContextV1,
): CheckpointExportHandoffV1 {
  const v = closed(value, "checkpoint_handoff", [
    "schema_version", "handoff_id", "checkpoint_id", "resource_id",
    "resource_lifecycle_generation", "workspace_revision", "manifest", "manifest_sha256",
    "workspace_root_sha256", "checkpoint_root_sha256", "bundle_sha256",
    "bundle_byte_length", "file_count", "fence_sha256",
    "final_authorization_receipt_sha256", "capture_grant_sha256",
    "quiescence_receipt", "quiescence_receipt_sha256", "manifest_blob_sha256",
    "sink_descriptor_sha256", "sink_commit_receipt", "sink_commit_receipt_sha256",
    "durability_state", "exported_at", "handoff_sha256",
  ]);
  literal(v.schema_version, "sandboxes.checkpoint-export-handoff/v1", "checkpoint_handoff.schema_version");
  assertBoundResource(v, request, "checkpoint_handoff");
  opaqueId(v.handoff_id, "checkpoint_handoff.handoff_id", "handoff");
  if (
    v.checkpoint_id !== request.checkpoint_id ||
    nonNegativeBigInt(v.workspace_revision, "checkpoint_handoff.workspace_revision") !== request.expected_workspace_revision ||
    digest(v.fence_sha256, "checkpoint_handoff.fence_sha256") !== canonicalDigest(ctx.fence) ||
    digest(v.final_authorization_receipt_sha256, "checkpoint_handoff.final_authorization_receipt_sha256") !==
      ctx.authorization_consumption_set_sha256 ||
    digest(v.capture_grant_sha256, "checkpoint_handoff.capture_grant_sha256") !== request.capture_grant.grant_sha256 ||
    digest(v.sink_descriptor_sha256, "checkpoint_handoff.sink_descriptor_sha256") !== request.sink_descriptor_sha256 ||
    literal(v.durability_state, "durable", "checkpoint_handoff.durability_state") !== "durable"
  ) {
    throw new SandboxError("integrity_failed", "Checkpoint handoff changed its capture authorization or barrier");
  }
  if (!Array.isArray(v.manifest) || v.manifest.length !== request.allowed_paths.length) {
    throw new SandboxError("integrity_failed", "Checkpoint manifest path denominator differs");
  }
  const manifest = v.manifest.map((raw, index) => {
    const entry = closed(raw, `checkpoint_handoff.manifest.${index}`, [
      "path", "size_bytes", "content_sha256", "file_revision_sha256",
    ]);
    const entryPath = path(entry.path, `checkpoint_handoff.manifest.${index}.path`);
    if (entryPath !== request.allowed_paths[index]) {
      throw new SandboxError("integrity_failed", "Checkpoint manifest changed an allowed path");
    }
    return {
      path: entryPath,
      size_bytes: integer(
        entry.size_bytes, `checkpoint_handoff.manifest.${index}.size_bytes`, 0,
        request.maximum_bundle_bytes,
      ),
      content_sha256: digest(
        entry.content_sha256, `checkpoint_handoff.manifest.${index}.content_sha256`,
      ),
      file_revision_sha256: digest(
        entry.file_revision_sha256, `checkpoint_handoff.manifest.${index}.file_revision_sha256`,
      ),
    };
  });
  const workspaceRootSha256 = canonicalDigest({
    resource_id: request.handle.resource_id,
    resource_lifecycle_generation: request.handle.resource_lifecycle_generation,
    workspace_revision: request.expected_workspace_revision,
    entries: manifest,
  });
  const manifestSha256 = canonicalDigest({
    schema_version: "sandboxes.checkpoint-manifest/v1",
    checkpoint_id: request.checkpoint_id,
    resource_id: request.handle.resource_id,
    resource_lifecycle_generation: request.handle.resource_lifecycle_generation,
    workspace_revision: request.expected_workspace_revision,
    allowed_paths_sha256: canonicalDigest(request.allowed_paths),
    entries: manifest,
  });
  if (
    digest(v.manifest_sha256, "checkpoint_handoff.manifest_sha256") !== manifestSha256 ||
    digest(v.workspace_root_sha256, "checkpoint_handoff.workspace_root_sha256") !==
      workspaceRootSha256
  ) {
    throw new SandboxError("integrity_failed", "Checkpoint manifest or workspace root differs");
  }
  const bundleSha256 = canonicalDigest(manifest);
  const bundleByteLength = manifest.reduce((total, entry) => total + entry.size_bytes, 0);
  if (
    digest(v.bundle_sha256, "checkpoint_handoff.bundle_sha256") !== bundleSha256 ||
    integer(v.bundle_byte_length, "checkpoint_handoff.bundle_byte_length", 0, request.maximum_bundle_bytes) !==
      bundleByteLength ||
    integer(v.file_count, "checkpoint_handoff.file_count", 0, request.allowed_paths.length) !==
      manifest.length
  ) {
    throw new SandboxError("integrity_failed", "Checkpoint bundle or file denominator differs");
  }
  if (digest(v.manifest_blob_sha256, "checkpoint_handoff.manifest_blob_sha256") !== manifestSha256) {
    throw new SandboxError("integrity_failed", "Checkpoint manifest blob digest differs");
  }
  const q = closed(v.quiescence_receipt, "checkpoint_handoff.quiescence_receipt", [
    "schema_version", "checkpoint_id", "resource_id", "resource_lifecycle_generation",
    "workspace_revision", "active_exec_count", "capture_grant_sha256",
    "final_authorization_receipt_sha256", "quiesced_at", "issuer_principal",
    "signing_key_id", "receipt_sha256", "signature",
  ]);
  literal(q.schema_version, "sandboxes.checkpoint-quiescence-receipt/v1", "checkpoint_handoff.quiescence_receipt.schema_version");
  if (
    q.checkpoint_id !== request.checkpoint_id || q.resource_id !== request.handle.resource_id ||
    q.resource_lifecycle_generation !== request.handle.resource_lifecycle_generation ||
    q.workspace_revision !== request.expected_workspace_revision || q.active_exec_count !== 0 ||
    q.capture_grant_sha256 !== request.capture_grant.grant_sha256 ||
    q.final_authorization_receipt_sha256 !== ctx.authorization_consumption_set_sha256
  ) {
    throw new SandboxError("integrity_failed", "Checkpoint quiescence receipt differs");
  }
  time(q.quiesced_at, "checkpoint_handoff.quiescence_receipt.quiesced_at");
  opaqueId(q.issuer_principal, "checkpoint_handoff.quiescence_receipt.issuer_principal", "principal");
  opaqueId(q.signing_key_id, "checkpoint_handoff.quiescence_receipt.signing_key_id", "key");
  canonicalSignature(q.signature, "checkpoint_handoff.quiescence_receipt.signature");
  const quiescenceFacts = Object.fromEntries(
    Object.entries(q).filter(([key]) => key !== "receipt_sha256" && key !== "signature"),
  );
  const quiescenceSha = digest(q.receipt_sha256, "checkpoint_handoff.quiescence_receipt.receipt_sha256");
  if (quiescenceSha !== canonicalDigest(quiescenceFacts)) {
    throw new SandboxError("integrity_failed", "Checkpoint quiescence receipt digest differs");
  }
  if (digest(v.quiescence_receipt_sha256, "checkpoint_handoff.quiescence_receipt_sha256") !== quiescenceSha) {
    throw new SandboxError("integrity_failed", "Checkpoint quiescence receipt reference differs");
  }
  const checkpointRootSha256 = canonicalDigest({
    checkpoint_id: request.checkpoint_id,
    resource_id: request.handle.resource_id,
    resource_lifecycle_generation: request.handle.resource_lifecycle_generation,
    workspace_revision: request.expected_workspace_revision,
    manifest_sha256: manifestSha256,
    workspace_root_sha256: workspaceRootSha256,
    bundle_sha256: bundleSha256,
    bundle_byte_length: bundleByteLength,
    capture_grant_sha256: request.capture_grant.grant_sha256,
    final_authorization_receipt_sha256: ctx.authorization_consumption_set_sha256,
    quiescence_receipt_sha256: quiescenceSha,
  });
  if (digest(v.checkpoint_root_sha256, "checkpoint_handoff.checkpoint_root_sha256") !== checkpointRootSha256) {
    throw new SandboxError("integrity_failed", "Checkpoint root differs from canonical capture facts");
  }
  const sink = closed(v.sink_commit_receipt, "checkpoint_handoff.sink_commit_receipt", [
    "schema_version", "checkpoint_id", "resource_id", "resource_lifecycle_generation",
    "workspace_revision", "sink_descriptor_sha256", "capture_grant_sha256",
    "final_authorization_receipt_sha256", "quiescence_receipt_sha256",
    "manifest_sha256", "manifest_blob_sha256", "workspace_root_sha256",
    "checkpoint_root_sha256", "bundle_sha256", "bundle_byte_length", "storage_version", "committed_at",
    "issuer_principal", "signing_key_id", "receipt_sha256", "signature",
  ]);
  literal(sink.schema_version, "sandboxes.checkpoint-sink-commit-receipt/v1", "checkpoint_handoff.sink_commit_receipt.schema_version");
  if (
    sink.checkpoint_id !== request.checkpoint_id || sink.resource_id !== request.handle.resource_id ||
    sink.resource_lifecycle_generation !== request.handle.resource_lifecycle_generation ||
    sink.workspace_revision !== request.expected_workspace_revision ||
    sink.sink_descriptor_sha256 !== request.sink_descriptor_sha256 ||
    sink.capture_grant_sha256 !== request.capture_grant.grant_sha256 ||
    sink.final_authorization_receipt_sha256 !== ctx.authorization_consumption_set_sha256 ||
    sink.quiescence_receipt_sha256 !== quiescenceSha ||
    sink.manifest_sha256 !== manifestSha256 || sink.manifest_blob_sha256 !== manifestSha256 ||
    sink.workspace_root_sha256 !== workspaceRootSha256 ||
    sink.checkpoint_root_sha256 !== checkpointRootSha256 ||
    sink.bundle_sha256 !== bundleSha256 || sink.bundle_byte_length !== bundleByteLength
  ) {
    throw new SandboxError("integrity_failed", "Checkpoint sink commit receipt differs");
  }
  text(sink.storage_version, "checkpoint_handoff.sink_commit_receipt.storage_version", 512);
  time(sink.committed_at, "checkpoint_handoff.sink_commit_receipt.committed_at");
  opaqueId(sink.issuer_principal, "checkpoint_handoff.sink_commit_receipt.issuer_principal", "principal");
  opaqueId(sink.signing_key_id, "checkpoint_handoff.sink_commit_receipt.signing_key_id", "key");
  canonicalSignature(sink.signature, "checkpoint_handoff.sink_commit_receipt.signature");
  const sinkFacts = Object.fromEntries(
    Object.entries(sink).filter(([key]) => key !== "receipt_sha256" && key !== "signature"),
  );
  const sinkReceiptSha = digest(sink.receipt_sha256, "checkpoint_handoff.sink_commit_receipt.receipt_sha256");
  if (sinkReceiptSha !== canonicalDigest(sinkFacts) ||
      digest(v.sink_commit_receipt_sha256, "checkpoint_handoff.sink_commit_receipt_sha256") !== sinkReceiptSha) {
    throw new SandboxError("integrity_failed", "Checkpoint sink commit receipt digest differs");
  }
  time(v.exported_at, "checkpoint_handoff.exported_at");
  verifySelfDigest(v, "handoff_sha256", "checkpoint_handoff");
  return value as CheckpointExportHandoffV1;
}

export function validateBoundedOperationResult(
  operation: import("./types.js").SandboxDataPlaneOperationV1,
  value: unknown,
  request:
    | ExecStartRequestV1
    | ExecFrameReadRequestV1
    | ExecResultRequestV1
    | ExecCancelRequestV1
    | FileReadRequestV1
    | FileWriteRequestV1
    | FileListRequestV1
    | CheckpointExportRequestV1,
  ctx: AuthorizedBoundedCallContextV1,
): BoundedOperationResultV1 {
  switch (operation) {
    case "exec.start": return validateExecStartReceipt(value, request as ExecStartRequestV1, ctx);
    case "exec.frames.read": return validateExecFramePage(value, request as ExecFrameReadRequestV1);
    case "exec.result.read": return validateExecResult(value, request as ExecResultRequestV1);
    case "exec.cancel": return validateExecCancelReceipt(value, request as ExecCancelRequestV1);
    case "file.read": return validateFileReadReceipt(value, request as FileReadRequestV1);
    case "file.write": return validateFileWriteReceipt(value, request as FileWriteRequestV1);
    case "file.list": return validateFileListPage(value, request as FileListRequestV1);
    case "checkpoint.export_bundle": return validateCheckpointHandoff(
      value,
      request as CheckpointExportRequestV1,
      ctx,
    );
  }
}
