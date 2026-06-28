import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import type { ProbeResultSubmission } from "./types.js";

export interface ProbeKeyPair {
  publicKeyPem: string;
  privateKeyPem: string;
  publicKeyFingerprint: string;
}

export type ProbeSigningInput = Omit<ProbeResultSubmission, "signature">;

export function generateProbeKeyPair(): ProbeKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  return {
    publicKeyPem,
    privateKeyPem,
    publicKeyFingerprint: probePublicKeyFingerprint(publicKeyPem),
  };
}

export function probePublicKeyFingerprint(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem.trim()).digest("hex");
}

export function signProbeResult(input: ProbeSigningInput, privateKeyPem: string): string {
  return sign(null, Buffer.from(probeResultSigningPayload(input)), privateKeyPem).toString("base64url");
}

export function verifyProbeResultSignature(input: ProbeResultSubmission, publicKeyPem: string): boolean {
  try {
    return verify(
      null,
      Buffer.from(probeResultSigningPayload(input)),
      publicKeyPem,
      Buffer.from(input.signature, "base64url"),
    );
  } catch {
    return false;
  }
}

export function probeResultSigningPayload(input: ProbeSigningInput): string {
  return stableJson({
    version: "open-uptime.probe-result.v1",
    probeId: input.probeId,
    jobId: input.jobId,
    scheduleSlot: input.scheduleSlot,
    fencingToken: input.fencingToken,
    monitorId: input.monitorId,
    nonce: input.nonce,
    checkedAt: input.checkedAt,
    status: input.status,
    latencyMs: input.latencyMs,
    statusCode: input.statusCode ?? null,
    error: input.error ?? null,
    attemptCount: input.attemptCount ?? 1,
    monitorRevision: input.monitorRevision,
    evidenceSha256: createHash("sha256").update(stableJson(input.evidence ?? null)).digest("hex"),
  });
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableJson(entryValue)}`).join(",")}}`;
}
