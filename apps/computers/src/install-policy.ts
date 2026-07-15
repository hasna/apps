import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  ComputersError,
  type InstallPlan,
  type InstallPolicyRevision,
  type InstallPolicyRule,
  type InstallTicketClaims,
  type PackageSpec,
} from "./contracts";
import type { AuditRecord, StoragePort } from "./storage";
import { makeId, sha256, stableJson } from "./storage";
import { assertExactKeys, validateDigest, validateId, validateNonce, validatePackageSpec, validateRequestObject, validateTimestamp } from "./validation";

function globMatches(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

function ruleMatches(rule: InstallPolicyRule, spec: PackageSpec): boolean {
  if (rule.managers !== undefined && !rule.managers.includes(spec.manager)) return false;
  if (rule.packagePatterns !== undefined && !rule.packagePatterns.some((pattern) => globMatches(pattern, spec.name))) return false;
  if (rule.registries !== undefined && !rule.registries.includes(spec.registry)) return false;
  if (rule.lifecycleScripts !== undefined && rule.lifecycleScripts !== spec.allowLifecycleScripts) return false;
  return true;
}

export class InstallPolicyEngine {
  evaluate(revision: InstallPolicyRevision, rawSpec: unknown): InstallPlan {
    const spec = validatePackageSpec(rawSpec);
    const matches = revision.rules.filter((rule) => ruleMatches(rule, spec));
    const decision = matches.some((rule) => rule.effect === "deny")
      ? "deny"
      : matches.some((rule) => rule.effect === "approval_required")
        ? "approval_required"
        : matches.some((rule) => rule.effect === "allow") ? "allow" : "deny";
    return {
      decision,
      policyRevisionId: revision.id,
      policyGeneration: revision.generation,
      policyDigest: revision.digest,
      specDigest: sha256(spec),
      reasons: matches.length === 0 ? ["default_deny"] : matches.map((rule) => `${rule.effect}:matching_rule`),
    };
  }
}

export interface InstallTicketSigningKeyProvider {
  getKey(): Uint8Array;
}

export class StaticInstallTicketSigningKeyProvider implements InstallTicketSigningKeyProvider {
  readonly #key: Uint8Array;
  constructor(key: Uint8Array) { this.#key = new Uint8Array(key); }
  getKey(): Uint8Array { return new Uint8Array(this.#key); }
}

export class InstallTicketService {
  readonly #key: Uint8Array;
  readonly #storage: StoragePort;

  constructor(storage: StoragePort, signingKey: Uint8Array) {
    if (signingKey.byteLength < 32) throw new ComputersError("invalid_request", "Install ticket signing key must be at least 32 bytes", 500);
    this.#storage = storage;
    this.#key = signingKey;
  }

  issue(tenantId: string, computerId: string, revision: InstallPolicyRevision, rawSpec: unknown, audit: AuditRecord, ttlSeconds = 300): string {
    const spec = validatePackageSpec(rawSpec);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 900) throw new ComputersError("invalid_request", "Invalid ticket TTL", 400);
    const issuedAt = new Date().toISOString();
    const claims: InstallTicketClaims = {
      ticketId: makeId("itk"), tenantId, computerId, policyRevisionId: revision.id, policyGeneration: revision.generation,
      policyDigest: revision.digest, specDigest: sha256(spec), spec, nonce: randomBytes(24).toString("base64url"), issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + ttlSeconds * 1000).toISOString(),
    };
    const payload = Buffer.from(stableJson(claims)).toString("base64url");
    const signature = this.#sign(payload);
    this.#storage.saveInstallTicket(claims, signature, audit);
    return `${payload}.${signature}`;
  }

  verify(ticket: string, tenantId: string, computerId: string): { claims: InstallTicketClaims; signature: string } {
    if (ticket.length > 64 * 1024) throw new ComputersError("invalid_request", "Install ticket rejected", 400);
    const parts = ticket.split(".");
    if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) throw new ComputersError("authorization_denied", "Install ticket rejected", 403);
    const [payload, signature] = parts;
    const expected = this.#sign(payload);
    const left = Buffer.from(signature, "base64url");
    const right = Buffer.from(expected, "base64url");
    if (left.byteLength !== right.byteLength || !timingSafeEqual(left, right)) throw new ComputersError("authorization_denied", "Install ticket rejected", 403);
    let parsed: unknown;
    try { parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown; }
    catch { throw new ComputersError("authorization_denied", "Install ticket rejected", 403); }
    let claims: InstallTicketClaims;
    try {
      const value = validateRequestObject(parsed);
      assertExactKeys(value, ["ticketId", "tenantId", "computerId", "policyRevisionId", "policyGeneration", "policyDigest", "specDigest", "spec", "nonce", "issuedAt", "expiresAt"]);
      const issuedAt = validateTimestamp(value.issuedAt, "issuedAt"); const expiresAt = validateTimestamp(value.expiresAt, "expiresAt");
      if (!Number.isSafeInteger(value.policyGeneration) || Number(value.policyGeneration) < 1
        || Date.parse(expiresAt) <= Date.parse(issuedAt) || Date.parse(expiresAt) - Date.parse(issuedAt) > 900_000) throw new Error("invalid claims");
      claims = {
        ticketId: validateId(value.ticketId, "ticketId"), tenantId: validateId(value.tenantId, "tenantId"), computerId: validateId(value.computerId, "computerId"),
        policyRevisionId: validateId(value.policyRevisionId, "policyRevisionId"), policyGeneration: Number(value.policyGeneration),
        policyDigest: validateDigest(value.policyDigest, "policyDigest"), specDigest: validateDigest(value.specDigest, "specDigest"),
        spec: validatePackageSpec(value.spec), nonce: validateNonce(value.nonce), issuedAt, expiresAt,
      };
    } catch { throw new ComputersError("authorization_denied", "Install ticket rejected", 403); }
    if (claims.tenantId !== tenantId || claims.computerId !== computerId || sha256(claims.spec) !== claims.specDigest) {
      throw new ComputersError("authorization_denied", "Install ticket rejected", 403);
    }
    return { claims, signature };
  }

  #sign(payload: string): string {
    return createHmac("sha256", this.#key).update(payload).digest("base64url");
  }
}
