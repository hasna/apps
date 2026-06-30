import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getDataDir } from "../db/schema.js";
import { logEvent } from "../db/timeline.js";
import { BrowserError, type ConnectedExtensionStatus, type ExtBridgeMessage, type ExtJob, type ExtensionBridgeStatus, type ExtensionPairing, type ExtResult } from "../types/index.js";
import { allowedDomains, assertBrowserNavigationAllowed } from "./policy.js";

const DEFAULT_PAIRING_TTL_MS = 5 * 60_000;
const MAX_PAIRING_TTL_MS = 15 * 60_000;
const DEFAULT_JOB_TIMEOUT_MS = 30_000;
const EXTENSION_JOB_TYPES = new Set<ExtJob["type"]>([
  "ping",
  "navigate",
  "click",
  "type",
  "fill",
  "select",
  "press",
  "wait",
  "scroll",
  "extract",
  "screenshot",
]);

interface PairingRecord {
  code: string;
  expiresAt: number;
  consumedAt?: number;
}

interface ExtensionTokenRecord {
  token_id: string;
  token_hash: string;
  name?: string;
  created_at: string;
  revoked_at?: string;
  last_seen_at?: string;
  user_agent?: string;
}

interface ExtensionSocket {
  send(data: string): unknown;
  close?(code?: number, reason?: string): unknown;
}

export interface ExtensionSocketData {
  token_id: string;
  token_hash: string;
  name?: string;
  user_agent?: string;
  paired_token?: string;
  paired_new?: boolean;
}

export interface ConnectedExtension {
  token_id: string;
  token_hash: string;
  name?: string;
  socket: ExtensionSocket;
  connected_at: string;
  last_seen_at: string;
  user_agent?: string;
  current_url?: string;
}

interface PendingDispatch {
  token_id: string;
  job: ExtJob;
  resolve: (result: ExtResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pairings = new Map<string, PairingRecord>();
const connectedExtensions = new Map<string, ConnectedExtension>();
const pendingDispatches = new Map<string, PendingDispatch>();

function nowIso(): string {
  return new Date().toISOString();
}

function tokenStorePath(): string {
  return join(getDataDir(), "extension-tokens.json");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function readTokenRecords(): ExtensionTokenRecord[] {
  const file = tokenStorePath();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ExtensionTokenRecord => {
      return typeof item === "object" && item !== null
        && typeof (item as ExtensionTokenRecord).token_id === "string"
        && typeof (item as ExtensionTokenRecord).token_hash === "string";
    });
  } catch {
    return [];
  }
}

function writeTokenRecords(records: ExtensionTokenRecord[]): void {
  const file = tokenStorePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
}

function updateTokenRecord(tokenId: string, patch: Partial<ExtensionTokenRecord>): void {
  const records = readTokenRecords();
  const index = records.findIndex((record) => record.token_id === tokenId);
  if (index === -1) return;
  records[index] = { ...records[index], ...patch };
  writeTokenRecords(records);
}

function createTokenRecord(name?: string, userAgent?: string): { token: string; record: ExtensionTokenRecord } {
  const token = `ob_ext_${randomBytes(32).toString("base64url")}`;
  const record: ExtensionTokenRecord = {
    token_id: randomUUID(),
    token_hash: hashToken(token),
    name,
    created_at: nowIso(),
    last_seen_at: nowIso(),
    user_agent: userAgent,
  };
  const records = readTokenRecords();
  records.push(record);
  writeTokenRecords(records);
  return { token, record };
}

function getTokenRecordByToken(token: string): ExtensionTokenRecord | null {
  const tokenHash = hashToken(token);
  return readTokenRecords().find((record) => record.token_hash === tokenHash && !record.revoked_at) ?? null;
}

function prunePairings(): void {
  const now = Date.now();
  for (const [code, record] of pairings) {
    if (record.consumedAt || record.expiresAt <= now) pairings.delete(code);
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "::ffff:127.0.0.1";
}

function isLoopbackRequest(req: Request, peerAddress?: string | null): boolean {
  if (peerAddress) return isLoopbackHostname(peerAddress);
  const url = new URL(req.url);
  return isLoopbackHostname(url.hostname);
}

function logExtensionJob(job: ExtJob, phase: string, details: Record<string, unknown> = {}): void {
  if (!job.session_id) return;
  try {
    logEvent(job.session_id, `extension_${phase}`, {
      engine: "extension",
      job_id: job.id,
      job_type: job.type,
      ...details,
    });
  } catch {}
}

function rejectPendingForToken(tokenId: string, reason: string): void {
  for (const [jobId, pending] of pendingDispatches) {
    if (pending.token_id !== tokenId) continue;
    clearTimeout(pending.timer);
    pendingDispatches.delete(jobId);
    pending.reject(new BrowserError(reason, "EXTENSION_DISCONNECTED"));
  }
}

function normalizePairingTtlMs(ttlMs = DEFAULT_PAIRING_TTL_MS): number {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new BrowserError("Extension pairing TTL must be a positive finite number", "EXTENSION_PAIRING_TTL_INVALID");
  }
  return Math.min(Math.round(ttlMs), MAX_PAIRING_TTL_MS);
}

export function createExtensionPairing(ttlMs = DEFAULT_PAIRING_TTL_MS): ExtensionPairing {
  prunePairings();
  const normalizedTtlMs = normalizePairingTtlMs(ttlMs);
  let code = "";
  do {
    code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  } while (pairings.has(code));

  const expiresAt = Date.now() + normalizedTtlMs;
  pairings.set(code, { code, expiresAt });
  return { code, expires_at: new Date(expiresAt).toISOString() };
}

export function consumeExtensionPairingCode(code: string, name?: string, userAgent?: string): { token: string; token_id: string } {
  prunePairings();
  const normalized = code.trim();
  const pairing = pairings.get(normalized);
  if (!pairing || pairing.expiresAt <= Date.now() || pairing.consumedAt) {
    throw new BrowserError("Invalid or expired extension pairing code", "EXTENSION_PAIRING_INVALID");
  }
  pairing.consumedAt = Date.now();
  pairings.delete(normalized);
  const { token, record } = createTokenRecord(name, userAgent);
  return { token, token_id: record.token_id };
}

export function validateExtensionToken(token: string): ExtensionSocketData {
  const record = getTokenRecordByToken(token);
  if (!record) {
    throw new BrowserError("Invalid or revoked extension token", "EXTENSION_TOKEN_INVALID");
  }
  return {
    token_id: record.token_id,
    token_hash: record.token_hash,
    name: record.name,
    user_agent: record.user_agent,
  };
}

export function prepareExtensionSocketUpgrade(req: Request, peerAddress?: string | null): { ok: true; data: ExtensionSocketData } | { ok: false; response: Response } {
  if (!isLoopbackRequest(req, peerAddress)) {
    return {
      ok: false,
      response: new Response("Extension WebSocket is loopback-only", { status: 403 }),
    };
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const code = url.searchParams.get("code");
  const name = url.searchParams.get("name") ?? undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;

  try {
    if (token) {
      const data = validateExtensionToken(token);
      return { ok: true, data: { ...data, user_agent: userAgent ?? data.user_agent } };
    }
    if (code) {
      const paired = consumeExtensionPairingCode(code, name, userAgent);
      const data = validateExtensionToken(paired.token);
      return {
        ok: true,
        data: {
          ...data,
          paired_token: paired.token,
          paired_new: true,
          user_agent: userAgent ?? data.user_agent,
        },
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, response: new Response(message, { status: 401 }) };
  }

  return {
    ok: false,
    response: new Response("Extension WebSocket requires token or pairing code", { status: 401 }),
  };
}

export function attachExtensionSocket(socket: ExtensionSocket, data: ExtensionSocketData): void {
  const connectedAt = nowIso();
  const existing = connectedExtensions.get(data.token_id);
  if (existing && existing.socket !== socket) {
    try { existing.socket.close?.(1000, "Replaced by a newer extension connection"); } catch {}
  }

  connectedExtensions.set(data.token_id, {
    token_id: data.token_id,
    token_hash: data.token_hash,
    name: data.name,
    socket,
    connected_at: connectedAt,
    last_seen_at: connectedAt,
    user_agent: data.user_agent,
  });
  updateTokenRecord(data.token_id, {
    last_seen_at: connectedAt,
    user_agent: data.user_agent,
  });

  const hello: ExtBridgeMessage = data.paired_new && data.paired_token
    ? { type: "paired", token: data.paired_token, token_id: data.token_id }
    : { type: "connected", token_id: data.token_id };
  socket.send(JSON.stringify(hello));
}

export function detachExtensionSocket(tokenId: string): void {
  connectedExtensions.delete(tokenId);
  rejectPendingForToken(tokenId, "Extension disconnected before job completed");
}

export function handleExtensionSocketMessage(tokenId: string, raw: string | Buffer): void {
  const connection = connectedExtensions.get(tokenId);
  if (connection) {
    connection.last_seen_at = nowIso();
    updateTokenRecord(tokenId, { last_seen_at: connection.last_seen_at });
  }

  let message: ExtBridgeMessage;
  try {
    message = JSON.parse(raw.toString()) as ExtBridgeMessage;
  } catch {
    return;
  }

  if (message.type === "pong" || message.type === "ping") return;
  if (message.type !== "result") return;

  const result = message.result;
  const pending = pendingDispatches.get(result.id);
  if (!pending) return;

  clearTimeout(pending.timer);
  pendingDispatches.delete(result.id);
  logExtensionJob(pending.job, "result", {
    ok: result.ok,
    url: result.url,
    title: result.title,
    error: result.ok ? undefined : result.error,
  });
  if (connection && result.url) connection.current_url = result.url;
  pending.resolve(result);
}

export function getConnectedExtension(tokenId?: string): ConnectedExtension | null {
  if (tokenId) return connectedExtensions.get(tokenId) ?? null;
  return connectedExtensions.values().next().value ?? null;
}

export function hasConnectedExtension(): boolean {
  return connectedExtensions.size > 0;
}

export function getPairedExtensionOrThrow(tokenId?: string): ConnectedExtension {
  const connection = getConnectedExtension(tokenId);
  if (!connection) {
    throw new BrowserError(
      "No paired Chrome extension is connected. Run `browser extension pair`, load extension/dist as an unpacked extension, and enter the code in the popup.",
      "EXTENSION_NOT_CONNECTED",
    );
  }
  return connection;
}

export async function dispatchExtensionJob(job: ExtJob, opts: { tokenId?: string; timeoutMs?: number; approvalToken?: string } = {}): Promise<ExtResult> {
  const connection = getPairedExtensionOrThrow(opts.tokenId);
  validateExtensionDispatchJob(job, { approvalToken: opts.approvalToken, currentUrl: connection.current_url });
  const timeoutMs = opts.timeoutMs ?? job.timeout_ms ?? DEFAULT_JOB_TIMEOUT_MS;
  const jobWithId = job.id ? job : { ...job, id: randomUUID() } as ExtJob;

  logExtensionJob(jobWithId, "job", {
    type: jobWithId.type,
    selector: "payload" in jobWithId ? (jobWithId.payload as { selector?: string }).selector : undefined,
    url: "payload" in jobWithId ? (jobWithId.payload as { url?: string }).url : undefined,
  });

  return new Promise<ExtResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingDispatches.delete(jobWithId.id);
      reject(new BrowserError(`Extension job timed out after ${timeoutMs}ms: ${jobWithId.type}`, "EXTENSION_JOB_TIMEOUT"));
    }, timeoutMs);
    if (timer.unref) timer.unref();

    pendingDispatches.set(jobWithId.id, {
      token_id: connection.token_id,
      job: jobWithId,
      resolve,
      reject,
      timer,
    });

    try {
      const message: ExtBridgeMessage = { type: "job", job: jobWithId };
      connection.socket.send(JSON.stringify(message));
    } catch (error) {
      clearTimeout(timer);
      pendingDispatches.delete(jobWithId.id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function validateExtensionDispatchJob(job: ExtJob, opts: { approvalToken?: string; currentUrl?: string } = {}): void {
  if (!job || typeof job !== "object") {
    throw new BrowserError("Extension job must be an object", "EXTENSION_JOB_INVALID");
  }
  if (typeof job.id !== "string" || !job.id) {
    throw new BrowserError("Extension job id is required", "EXTENSION_JOB_INVALID");
  }
  if (!EXTENSION_JOB_TYPES.has(job.type)) {
    throw new BrowserError(`Unsupported extension job type: ${(job as { type?: unknown }).type}`, "EXTENSION_JOB_INVALID");
  }
  if (job.type === "navigate") {
    assertBrowserNavigationAllowed((job.payload as { url?: string } | undefined)?.url ?? "");
  }
  if (job.type !== "navigate" && job.type !== "ping" && allowedDomains().length > 0) {
    if (!opts.currentUrl) {
      throw new BrowserError(
        "Extension current tab URL is unknown. Navigate to an allowed domain before running extension actions with BROWSER_ALLOWED_DOMAINS configured.",
        "BROWSER_DOMAIN_NOT_ALLOWED",
      );
    }
    assertBrowserNavigationAllowed(opts.currentUrl);
  }
}

export function getExtensionBridgeStatus(): ExtensionBridgeStatus {
  prunePairings();
  const records = readTokenRecords();
  const extensions: ConnectedExtensionStatus[] = records
    .filter((record) => !record.revoked_at)
    .map((record) => {
      const connected = connectedExtensions.get(record.token_id);
      return {
        token_id: record.token_id,
        name: record.name,
        connected: Boolean(connected),
        paired_at: record.created_at,
        connected_at: connected?.connected_at,
        last_seen_at: connected?.last_seen_at ?? record.last_seen_at,
        user_agent: connected?.user_agent ?? record.user_agent,
      };
    });

  return {
    paired: extensions.length > 0,
    connected: extensions.some((extension) => extension.connected),
    extensions,
    pending_pairings: Array.from(pairings.values()).map((pairing) => ({
      code: pairing.code,
      expires_at: new Date(pairing.expiresAt).toISOString(),
    })),
  };
}

export function revokeExtensionToken(tokenId?: string): { revoked: string[] } {
  const records = readTokenRecords();
  const revokedAt = nowIso();
  const revoked: string[] = [];
  for (const record of records) {
    if (record.revoked_at) continue;
    if (tokenId && record.token_id !== tokenId) continue;
    record.revoked_at = revokedAt;
    revoked.push(record.token_id);
    const connected = connectedExtensions.get(record.token_id);
    if (connected) {
      try { connected.socket.close?.(1000, "Extension token revoked"); } catch {}
      detachExtensionSocket(record.token_id);
    }
  }
  writeTokenRecords(records);
  return { revoked };
}

export function resetExtensionBridgeForTests(opts: { deleteTokens?: boolean } = {}): void {
  pairings.clear();
  connectedExtensions.clear();
  for (const pending of pendingDispatches.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Extension bridge reset"));
  }
  pendingDispatches.clear();
  if (opts.deleteTokens) writeTokenRecords([]);
}
