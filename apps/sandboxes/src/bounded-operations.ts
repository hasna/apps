import {
  assertDigest,
  assertOpaqueId,
  canonicalDigest,
  parsePositiveInt64,
  sha256,
  type Digest,
} from "./canonical.js";
import { SandboxError } from "./errors.js";
import type {
  CheckpointExportRequestV1,
  ExecCancelRequestV1,
  ExecFrameReadRequestV1,
  ExecResultRequestV1,
  ExecStartRequestV1,
  FileListRequestV1,
  FileReadRequestV1,
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
    "schema_version", "handle", "exec_id", "cursor", "max_frames", "max_bytes", "wait_ms",
  ]);
  return {
    schema_version: literal(v.schema_version, "sandboxes.exec-frame-read-request/v1", "exec_frames.schema_version"),
    handle: validateSandboxHandleRef(v.handle),
    exec_id: opaqueId(v.exec_id, "exec_frames.exec_id", "exec"),
    cursor: text(v.cursor, "exec_frames.cursor", 512),
    max_frames: integer(v.max_frames, "exec_frames.max_frames", 1, 100),
    max_bytes: integer(v.max_bytes, "exec_frames.max_bytes", 1, 1024 * 1024),
    wait_ms: integer(v.wait_ms, "exec_frames.wait_ms", 0, 30_000),
  };
}

export function validateExecResultRequest(value: unknown): ExecResultRequestV1 {
  const v = closed(value, "exec_result", ["schema_version", "handle", "exec_id"]);
  return {
    schema_version: literal(v.schema_version, "sandboxes.exec-result-request/v1", "exec_result.schema_version"),
    handle: validateSandboxHandleRef(v.handle),
    exec_id: opaqueId(v.exec_id, "exec_result.exec_id", "exec"),
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
  ]);
  if (!Array.isArray(v.allowed_paths) || v.allowed_paths.length > 1000) {
    throw new SandboxError("validation_failed", "checkpoint_export.allowed_paths must be bounded");
  }
  const allowedPaths = v.allowed_paths.map((item, index) => path(item, `checkpoint_export.allowed_paths.${index}`));
  if (new Set(allowedPaths).size !== allowedPaths.length || [...allowedPaths].sort().some((item, i) => item !== allowedPaths[i])) {
    throw new SandboxError("validation_failed", "checkpoint_export.allowed_paths must be unique and sorted");
  }
  return {
    schema_version: literal(
      v.schema_version,
      "sandboxes.checkpoint-export-request/v1",
      "checkpoint_export.schema_version",
    ),
    handle: validateSandboxHandleRef(v.handle),
    checkpoint_id: opaqueId(v.checkpoint_id, "checkpoint_export.checkpoint_id", "checkpoint"),
    expected_workspace_revision: parsePositiveInt64(
      v.expected_workspace_revision,
      "checkpoint_export.expected_workspace_revision",
    ),
    allowed_paths: allowedPaths,
    maximum_bundle_bytes: integer(
      v.maximum_bundle_bytes,
      "checkpoint_export.maximum_bundle_bytes",
      1,
      1024 * 1024 * 1024,
    ),
    sink_descriptor_sha256: digest(v.sink_descriptor_sha256, "checkpoint_export.sink_descriptor_sha256"),
  };
}

export function boundedOperationRequestDigest(request: unknown): Digest {
  return canonicalDigest(request);
}
