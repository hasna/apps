import { createHash, randomBytes } from "node:crypto";
import { SandboxError } from "./errors.js";

export type Digest = `sha256:${string}`;

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const OPAQUE_ID_RE = /^[a-z][a-z0-9_]{1,31}_[0-9a-f]{32}$/;
const RFC3339_FRACTIONAL_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3,9}Z$/;
const POSITIVE_INT64_RE = /^[1-9][0-9]{0,18}$/;
const INT64_MAX = 9_223_372_036_854_775_807n;

export function assertDigest(value: unknown, field = "digest"): asserts value is Digest {
  if (typeof value !== "string" || !DIGEST_RE.test(value)) {
    throw new SandboxError("validation_failed", `${field} must be a lowercase sha256 digest`, { field });
  }
}

export function sha256(value: string | Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function assertOpaqueId(
  value: unknown,
  field = "id",
  expectedPrefix?: string,
): asserts value is string {
  if (typeof value !== "string" || !OPAQUE_ID_RE.test(value)) {
    throw new SandboxError("validation_failed", `${field} must be a full opaque ID`, { field });
  }
  if (expectedPrefix !== undefined && !value.startsWith(`${expectedPrefix}_`)) {
    throw new SandboxError("validation_failed", `${field} has the wrong opaque ID kind`, { field });
  }
}

export function createOpaqueId(prefix: string): string {
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(prefix)) {
    throw new SandboxError("validation_failed", "Invalid opaque ID prefix");
  }
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

export function assertRfc3339(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !RFC3339_FRACTIONAL_RE.test(value) || Number.isNaN(Date.parse(value))) {
    throw new SandboxError("validation_failed", `${field} must be fractional UTC RFC 3339`, { field });
  }
}

export function parsePositiveInt64(value: unknown, field: string): bigint {
  if (typeof value === "bigint") {
    if (value >= 1n && value <= INT64_MAX) return value;
  } else if (typeof value === "string" && POSITIVE_INT64_RE.test(value)) {
    const parsed = BigInt(value);
    if (parsed <= INT64_MAX) return parsed;
  }
  throw new SandboxError("validation_failed", `${field} must be a positive signed 64-bit integer`, { field });
}

function normalizeCanonical(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new SandboxError("validation_failed", "Canonical numbers must be safe integers");
    }
    return value;
  }
  if (typeof value === "bigint") return value.toString(10);
  if (Array.isArray(value)) return value.map(normalizeCanonical);
  if (typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(input).sort()) {
      const child = input[key];
      if (child === undefined || typeof child === "function" || typeof child === "symbol") {
        throw new SandboxError("validation_failed", "Canonical objects cannot contain unsupported values", { field: key });
      }
      output[key] = normalizeCanonical(child);
    }
    return output;
  }
  throw new SandboxError("validation_failed", "Value is not canonically serializable");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeCanonical(value));
}

export function canonicalDigest(value: unknown): Digest {
  return sha256(canonicalJson(value));
}

export function storageJson(value: unknown): string {
  return JSON.stringify(value, (_key, child: unknown) =>
    typeof child === "bigint" ? { $sandboxes_bigint: child.toString(10) } : child,
  );
}

export function parseStorageJson<T>(value: string): T {
  return JSON.parse(value, (_key, child: unknown) => {
    if (
      child !== null &&
      typeof child === "object" &&
      Object.keys(child).length === 1 &&
      typeof (child as { $sandboxes_bigint?: unknown }).$sandboxes_bigint === "string"
    ) {
      return BigInt((child as { $sandboxes_bigint: string }).$sandboxes_bigint);
    }
    return child;
  }) as T;
}

export function nowRfc3339(date = new Date()): string {
  return date.toISOString();
}
