import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { getDb } from "../db.js";

export const MUTATION_APPROVAL_FLAG_ENV = "HASNA_STATIONS_ALLOW_MUTATIONS";
export const LEGACY_MUTATION_APPROVAL_FLAG_ENV = "HASNA_STATIONS_MUTATION_APPROVAL";
export const MUTATION_APPROVAL_TOKEN_ENV = "HASNA_STATIONS_MUTATION_TOKEN";
export const MUTATION_APPROVAL_CALLER_ENV = "HASNA_STATIONS_MUTATION_CALLER_ID";
export const MUTATION_APPROVAL_RUN_ENV = "HASNA_STATIONS_MUTATION_RUN_ID";
export const MUTATION_APPROVAL_REPLAY_PATH_ENV = "HASNA_STATIONS_MUTATION_REPLAY_PATH";

type Env = Record<string, string | undefined>;

export interface MutationApprovalScope {
  surface: string;
  operation: string;
  machineId?: string;
  resourceId?: string;
  callerId?: string;
  runId?: string;
  transport?: string;
  args?: unknown;
  argsSha256?: string;
}

export interface MutationApprovalOptions extends MutationApprovalScope {
  approvalToken?: string;
  env?: Env;
  now?: number | Date;
}

export interface SdkMutationApprovalOptions {
  approvalToken?: string;
  trustedLocalMutation?: TrustedSdkMutationApproval;
  callerId?: string;
  runId?: string;
}

export type TrustedSdkMutationApproval = Readonly<{
  __trustedSdkMutationApproval?: never;
}>;

export interface MutationApprovalClaims extends MutationApprovalScope {
  version: 1;
  issuedAt: number;
  expiresAt: number;
  nonce?: string;
  args_sha256?: string;
}

export interface CreateMutationApprovalTokenOptions {
  env?: Env;
  secret?: string;
  now?: number | Date;
  ttlMs?: number;
  nonce?: string;
}

export interface MutationApprovalDecision {
  approved: boolean;
  reason?: string;
  claims?: MutationApprovalClaims;
}

const TOKEN_PREFIX = "stations-mut-v1";
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1_000;
const MAX_TOKEN_TTL_MS = 5 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const trustedSdkMutationApprovals = new WeakSet<object>();

export function createTrustedSdkMutationApproval(): TrustedSdkMutationApproval {
  const approval = {};
  trustedSdkMutationApprovals.add(approval);
  return approval as TrustedSdkMutationApproval;
}

function isTrustedSdkMutationApproval(approval: TrustedSdkMutationApproval | undefined): boolean {
  return typeof approval === "object" && approval !== null && trustedSdkMutationApprovals.has(approval);
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function nowMs(now: number | Date | undefined): number {
  if (typeof now === "number") return now;
  if (now instanceof Date) return now.getTime();
  return Date.now();
}

function signingSecret(env: Env, explicitSecret?: string): string | undefined {
  return explicitSecret?.trim() || env[MUTATION_APPROVAL_TOKEN_ENV]?.trim();
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function sha256Hex(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

function replayDbPath(env: Env): string | undefined {
  const configured = env[MUTATION_APPROVAL_REPLAY_PATH_ENV]?.trim();
  return configured ? resolve(configured) : undefined;
}

function replayNonceKey(claims: MutationApprovalClaims): string {
  return sha256Hex(JSON.stringify({ nonce: claims.nonce }));
}

function recordReplayNonce(env: Env, claims: MutationApprovalClaims, tokenPayload: string, now: number): MutationApprovalDecision | undefined {
  const dbPath = replayDbPath(env);
  if (!dbPath) return undefined;
  if (!claims.nonce) {
    return { approved: false, reason: "approval_token nonce claim is required for replay protection." };
  }

  try {
    const db = getDb(dbPath);
    db.query("DELETE FROM mutation_approval_nonces WHERE expires_at <= ?").run(now);
    const result = db.query(`
      INSERT OR IGNORE INTO mutation_approval_nonces (
        nonce_sha256,
        token_sha256,
        surface,
        operation,
        caller_id,
        run_id,
        transport,
        expires_at,
        used_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      replayNonceKey(claims),
      sha256Hex(tokenPayload),
      claims.surface,
      claims.operation,
      claims.callerId ?? "",
      claims.runId ?? "",
      claims.transport ?? "",
      claims.expiresAt,
      now,
    ) as { changes: number };

    if (result.changes !== 1) {
      return { approved: false, reason: "approval_token nonce has already been used." };
    }
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { approved: false, reason: `approval_token replay store is unavailable: ${message}` };
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeScope(scope: MutationApprovalScope): MutationApprovalScope {
  return {
    surface: scope.surface,
    operation: scope.operation,
    machineId: scope.machineId || undefined,
    resourceId: scope.resourceId || undefined,
    callerId: scope.callerId || undefined,
    runId: scope.runId || undefined,
    transport: scope.transport || undefined,
    argsSha256: scope.argsSha256 || (scope.args === undefined ? undefined : mutationArgsSha256(scope.args)),
  };
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function canonicalizeMutationArg(value: unknown, inArray = false): CanonicalJsonValue | undefined {
  if (value === undefined) return inArray ? null : undefined;
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalizeMutationArg(entry, true) ?? null);
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const result: { [key: string]: CanonicalJsonValue } = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (key === "approval_token" || key === "approvalToken") continue;
      const canonicalValue = canonicalizeMutationArg((value as Record<string, unknown>)[key]);
      if (canonicalValue !== undefined) result[key] = canonicalValue;
    }
    return result;
  }
  return inArray ? null : undefined;
}

export function canonicalMutationArgs(value: unknown): string {
  return JSON.stringify(canonicalizeMutationArg(value) ?? {});
}

export function mutationArgsSha256(value: unknown): string {
  return sha256Hex(canonicalMutationArgs(value));
}

function stripPlanRuntimeFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPlanRuntimeFields);
  if (value instanceof Date) return value;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === "planDigest" || key === "plan_digest" || key === "mode" || key === "executed") continue;
      result[key] = stripPlanRuntimeFields(entry);
    }
    return result;
  }
  return value;
}

export function mutationPlanDigest(plan: unknown): string {
  return mutationArgsSha256(stripPlanRuntimeFields(plan));
}

export function attachMutationPlanDigest<T extends object>(plan: T): T & { planDigest: string } {
  return {
    ...plan,
    planDigest: mutationPlanDigest(plan),
  };
}

export function assertMutationPlanDigest(plan: unknown, expectedPlanDigest?: string): void {
  if (expectedPlanDigest && mutationPlanDigest(plan) !== expectedPlanDigest) {
    throw new Error("Approved plan digest does not match the current execution plan.");
  }
}

export function createMutationApprovalToken(
  scope: MutationApprovalScope,
  options: CreateMutationApprovalTokenOptions = {},
): string {
  const env = options.env ?? process.env;
  const secret = signingSecret(env, options.secret);
  if (!secret) throw new Error(`${MUTATION_APPROVAL_TOKEN_ENV} is required to sign mutation approval tokens.`);

  const issuedAt = nowMs(options.now);
  const claims: MutationApprovalClaims = {
    version: 1,
    ...normalizeScope(scope),
    callerId: scope.callerId,
    runId: scope.runId,
    transport: scope.transport,
    issuedAt,
    expiresAt: issuedAt + Math.max(1, options.ttlMs ?? DEFAULT_TOKEN_TTL_MS),
    nonce: options.nonce ?? randomUUID(),
  };
  claims.args_sha256 = claims.argsSha256;
  delete claims.args;
  delete claims.argsSha256;
  const payload = base64Url(JSON.stringify(claims));
  return `${TOKEN_PREFIX}.${payload}.${hmac(payload, secret)}`;
}

function parseToken(token: string | undefined): { payload: string; signature: string; claims: MutationApprovalClaims } | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8")) as MutationApprovalClaims;
    return { payload: parts[1] ?? "", signature: parts[2] ?? "", claims };
  } catch {
    return null;
  }
}

function claimMatches(expected: string | undefined, actual: string | undefined): boolean {
  if (expected === undefined) return actual === undefined;
  return actual === expected;
}

export function verifyMutationApprovalToken(options: MutationApprovalOptions): MutationApprovalDecision {
  const env = options.env ?? process.env;
  const secret = signingSecret(env);
  if (!secret) return { approved: false, reason: `${MUTATION_APPROVAL_TOKEN_ENV} is not configured.` };

  const parsed = parseToken(options.approvalToken);
  if (!parsed) return { approved: false, reason: "approval_token is not a scoped mutation token." };
  if (!safeEqual(hmac(parsed.payload, secret), parsed.signature)) {
    return { approved: false, reason: "approval_token signature is invalid." };
  }

  const claims = parsed.claims;
  if (claims.version !== 1) return { approved: false, reason: "approval_token version is unsupported." };
  if (!claims.callerId || !claims.runId) {
    return { approved: false, reason: "approval_token must include caller and run claims." };
  }
  if (!claims.transport) {
    return { approved: false, reason: "approval_token must include a transport claim." };
  }
  if (!Number.isFinite(claims.expiresAt) || claims.expiresAt <= nowMs(options.now)) {
    return { approved: false, reason: "approval_token is expired." };
  }
  const now = nowMs(options.now);
  if (!Number.isFinite(claims.issuedAt) || claims.issuedAt > now + MAX_CLOCK_SKEW_MS) {
    return { approved: false, reason: "approval_token issue time is invalid." };
  }
  if (claims.expiresAt - claims.issuedAt > MAX_TOKEN_TTL_MS) {
    return { approved: false, reason: "approval_token TTL is too long." };
  }

  for (const key of ["surface", "operation", "machineId", "resourceId", "transport"] as const) {
    if (!claimMatches(options[key], claims[key])) {
      return { approved: false, reason: `approval_token ${key} claim does not match this mutation.` };
    }
  }
  for (const key of ["callerId", "runId"] as const) {
    if (options[key] !== undefined && options[key] !== claims[key]) {
      return { approved: false, reason: `approval_token ${key} claim does not match this mutation.` };
    }
  }
  const expectedArgsSha256 = options.argsSha256 || (options.args === undefined ? undefined : mutationArgsSha256(options.args));
  if (expectedArgsSha256 !== undefined && claims.args_sha256 !== expectedArgsSha256) {
    return { approved: false, reason: "approval_token args_sha256 claim does not match this mutation." };
  }

  const replayDecision = recordReplayNonce(env, claims, parsed.payload, now);
  if (replayDecision) return replayDecision;

  return { approved: true, claims };
}

export function isMutationApproved(options: Partial<MutationApprovalOptions> = {}): boolean {
  const env = options.env ?? process.env;
  const surface = options.surface ?? "cli";

  if (surface === "mcp") {
    if (!options.operation) return false;
    return verifyMutationApprovalToken({
      surface,
      operation: options.operation,
      machineId: options.machineId,
      resourceId: options.resourceId,
      callerId: options.callerId,
      runId: options.runId,
      transport: options.transport ?? "mcp",
      args: options.args,
      argsSha256: options.argsSha256,
      approvalToken: options.approvalToken,
      env,
      now: options.now,
    }).approved;
  }

  if (options.approvalToken) {
    const decision = options.operation
      ? verifyMutationApprovalToken({
        surface,
        operation: options.operation,
        machineId: options.machineId,
        resourceId: options.resourceId,
        callerId: options.callerId,
        runId: options.runId,
        transport: options.transport ?? surface,
        args: options.args,
        argsSha256: options.argsSha256,
        approvalToken: options.approvalToken,
        env,
        now: options.now,
      })
      : { approved: false };
    if (decision.approved) return true;
    if (env[MUTATION_APPROVAL_TOKEN_ENV]?.trim()) return false;
  }

  return isTruthy(env[MUTATION_APPROVAL_FLAG_ENV]) || isTruthy(env[LEGACY_MUTATION_APPROVAL_FLAG_ENV]);
}

export function assertMutationApproved(options: MutationApprovalOptions): void {
  if (isMutationApproved(options)) {
    return;
  }

  const env = options.env ?? process.env;
  const tokenConfigured = Boolean(env[MUTATION_APPROVAL_TOKEN_ENV]?.trim());
  const approvalHint = options.surface === "mcp"
    ? `pass a scoped approval_token signed with ${MUTATION_APPROVAL_TOKEN_ENV}`
    : tokenConfigured
      ? `pass a scoped approval_token signed with ${MUTATION_APPROVAL_TOKEN_ENV} or set ${MUTATION_APPROVAL_FLAG_ENV}=1 for a trusted local session`
      : `set ${MUTATION_APPROVAL_FLAG_ENV}=1 for a trusted local session or configure ${MUTATION_APPROVAL_TOKEN_ENV}`;

  throw new Error(
    `Fleet mutation blocked: ${options.surface}.${options.operation} requires operator approval; ${approvalHint}.`
  );
}

export function assertSdkMutationApproved(
  scope: Omit<MutationApprovalScope, "surface" | "transport" | "callerId" | "runId">,
  options: SdkMutationApprovalOptions = {},
): void {
  if (isTrustedSdkMutationApproval(options.trustedLocalMutation)) return;

  const decision = verifyMutationApprovalToken({
    surface: "sdk",
    operation: scope.operation,
    machineId: scope.machineId,
    resourceId: scope.resourceId,
    callerId: options.callerId,
    runId: options.runId,
    transport: "sdk",
    args: scope.args,
    argsSha256: scope.argsSha256,
    approvalToken: options.approvalToken,
    env: process.env,
  });

  if (decision.approved) return;

  throw new Error(
    `Fleet mutation blocked: sdk.${scope.operation} requires a scoped SDK approval token.`
  );
}
