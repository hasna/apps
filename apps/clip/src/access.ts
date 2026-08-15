import { Buffer } from "node:buffer";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { JsonObject } from "./types.js";
import { sha256 } from "./util.js";

export const ACCESS_PROTECTION_METADATA_KEY = "clipAccessProtection";

// Metadata keys whose values are stripped from public responses so credential
// verifiers (and anything that looks like a secret) never leak to unauthorized
// share viewers.
export const SENSITIVE_METADATA_KEYS = new Set([
  ACCESS_PROTECTION_METADATA_KEY.toLowerCase(),
  "accessprotection",
  "accesstoken",
  "access_token",
  "credential",
  "credentials",
  "password",
  "secret",
  "token",
]);

export type AccessProtectionKind = "token" | "password";

export interface AccessProtectionMetadata {
  version: 1;
  kind: AccessProtectionKind;
  algorithm: "sha256" | "scrypt";
  salt: string;
  digest: string;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function readAccessProtection(metadata: JsonObject): AccessProtectionMetadata | null {
  const value = metadata[ACCESS_PROTECTION_METADATA_KEY];
  if (!isJsonRecord(value)) return null;
  if (value["version"] !== 1) return null;
  if (value["kind"] !== "token" && value["kind"] !== "password") return null;
  if (value["algorithm"] !== "sha256" && value["algorithm"] !== "scrypt") return null;
  if (typeof value["salt"] !== "string" || typeof value["digest"] !== "string") return null;
  return value as unknown as AccessProtectionMetadata;
}

function sha256AccessCredential(salt: string, credential: string): string {
  return sha256(`${salt}\0${credential}`);
}

function scryptAccessCredential(salt: string, credential: string): string {
  return scryptSync(credential, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex");
}

function hashAccessCredential(protection: Pick<AccessProtectionMetadata, "algorithm" | "salt">, credential: string): string {
  return protection.algorithm === "scrypt"
    ? scryptAccessCredential(protection.salt, credential)
    : sha256AccessCredential(protection.salt, credential);
}

export function createAccessProtection(kind: AccessProtectionKind, credential: string): AccessProtectionMetadata {
  const salt = randomBytes(18).toString("base64url");
  const algorithm = kind === "password" ? "scrypt" : "sha256";
  const protection = {
    algorithm,
    salt,
  } satisfies Pick<AccessProtectionMetadata, "algorithm" | "salt">;
  return {
    version: 1,
    kind,
    algorithm,
    salt,
    digest: hashAccessCredential(protection, credential),
  };
}

function timingSafeHexEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "hex");
  const rightBytes = Buffer.from(right, "hex");
  if (leftBytes.byteLength !== rightBytes.byteLength) {
    const length = Math.max(leftBytes.byteLength, rightBytes.byteLength, 1);
    const paddedLeft = Buffer.alloc(length);
    const paddedRight = Buffer.alloc(length);
    leftBytes.copy(paddedLeft);
    rightBytes.copy(paddedRight);
    timingSafeEqual(paddedLeft, paddedRight);
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

export function verifyAccessCredential(protection: AccessProtectionMetadata, credential: string): boolean {
  return timingSafeHexEqual(hashAccessCredential(protection, credential), protection.digest);
}

export function metadataWithAccessProtection(metadata: JsonObject, protection?: AccessProtectionMetadata): JsonObject {
  return protection ? { ...metadata, [ACCESS_PROTECTION_METADATA_KEY]: protection } : metadata;
}
