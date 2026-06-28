import { randomUUID } from "node:crypto";
import {
  MAX_INTERVAL_SECONDS,
  MAX_RETRY_COUNT,
  MAX_TIMEOUT_MS,
  MIN_INTERVAL_SECONDS,
  MIN_RETRY_COUNT,
  MIN_TIMEOUT_MS,
} from "./limits.js";
import { assertHostedTargetAllowed } from "./target-policy.js";
import type { MonitorProvenance, StoredImportBatch, UpsertMonitorProvenanceInput } from "./store.js";
import type { CreateMonitorInput, ImportedMonitorInput, ImportedUpdateMonitorInput, ListResultsOptions, Monitor, MonitorKind } from "./types.js";

export type ImportSource = "manual" | "projects" | "servers" | "domains" | "deployment";
export type ImportAction = "create" | "update" | "unchanged" | "blocked" | "conflict";

export interface ImportRequest {
  source: ImportSource;
  records: unknown[];
  defaults?: Partial<CreateMonitorInput>;
}

export interface ImportCandidate {
  source: ImportSource;
  sourceId: string;
  sourceLabel: string | null;
  name: string;
  kind: MonitorKind;
  url?: string;
  host?: string;
  port?: number;
  method?: string;
  expectedStatus?: number | null;
  intervalSeconds?: number;
  timeoutMs?: number;
  retryCount?: number;
  enabled?: boolean;
  snapshot: unknown;
}

export interface ImportPreviewItem {
  candidate: ImportCandidate;
  action: ImportAction;
  monitor: Monitor | null;
  provenance: MonitorProvenance | null;
  warnings: string[];
  reason: string | null;
}

export interface ImportPreview {
  source: ImportSource;
  generatedAt: string;
  dryRun: true;
  items: ImportPreviewItem[];
  totals: Record<ImportAction, number>;
}

export interface ImportApplyItem extends ImportPreviewItem {
  monitor: Monitor | null;
  before: Monitor | null;
  after: Monitor | null;
}

export interface ImportApplyResult {
  batchId: string;
  source: ImportSource;
  appliedAt: string;
  items: ImportApplyItem[];
  totals: Record<ImportAction, number>;
}

export interface ImportRollbackItem {
  monitorId: string | null;
  action: "deleted" | "restored" | "disabled" | "skipped";
  reason: string | null;
}

export interface ImportRollbackResult {
  batchId: string;
  source: string;
  rolledBackAt: string;
  items: ImportRollbackItem[];
}

export interface UptimeImportStore {
  readonly mode: "local" | "hosted";
  createMonitor(input: ImportedMonitorInput, options?: { allowBrowserPage?: boolean }): Monitor;
  updateMonitor(idOrName: string, input: ImportedUpdateMonitorInput, options?: { allowBrowserPage?: boolean }): Monitor;
  deleteMonitor(idOrName: string): boolean;
  getMonitor(idOrName: string, options?: { workspaceId?: string }): Monitor | null;
  listResults(options?: ListResultsOptions): unknown[];
  getProvenance(source: string, sourceId: string): MonitorProvenance | null;
  upsertMonitorProvenance(input: UpsertMonitorProvenanceInput): MonitorProvenance;
  saveImportBatch(input: { id: string; source: string; records: unknown[] }): StoredImportBatch;
  getImportBatch(batchId: string): StoredImportBatch | null;
  markImportBatchRolledBack(batchId: string): StoredImportBatch;
  runInTransaction?<T>(fn: () => T): T;
}

export function previewImport(store: UptimeImportStore, request: ImportRequest, options: { workspaceId?: string } = {}): ImportPreview {
  const source = normalizeSource(request.source);
  const items = dedupePreviewItems(request.records.map((record) => previewRecord(store, source, record, request.defaults ?? {}, options)));
  return {
    source,
    generatedAt: new Date().toISOString(),
    dryRun: true,
    items,
    totals: countActions(items),
  };
}

function dedupePreviewItems(items: ImportPreviewItem[]): ImportPreviewItem[] {
  const seenSources = new Set<string>();
  const seenNames = new Set<string>();
  return items.map((item) => {
    if (item.action === "blocked") return item;
    const sourceKey = `${item.candidate.source}:${item.candidate.sourceId}`;
    const nameKey = item.candidate.name.toLowerCase();
    if (seenSources.has(sourceKey) || seenNames.has(nameKey)) {
      return {
        ...item,
        action: "conflict",
        monitor: item.monitor,
        warnings: [...item.warnings, "duplicate import candidate in request"],
        reason: "duplicate import candidate in request",
      };
    }
    seenSources.add(sourceKey);
    seenNames.add(nameKey);
    return item;
  });
}

export function applyImport(store: UptimeImportStore, request: ImportRequest): ImportApplyResult {
  if (store.mode === "hosted") {
    throw new Error("hosted import apply requires cloud import_batches and audit");
  }
  const execute = () => {
    const preview = previewImport(store, request);
    const appliedAt = new Date().toISOString();
    const items: ImportApplyItem[] = preview.items.map((item) => applyPreviewItem(store, item));
    const batchId = `imp_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
    store.saveImportBatch({
      id: batchId,
      source: preview.source,
      records: items.map((item) => ({
        action: item.action,
        sourceId: item.candidate.sourceId,
        monitorId: item.after?.id ?? item.monitor?.id ?? item.before?.id ?? null,
        before: item.before,
        after: item.after,
        candidate: item.candidate,
      })),
    });
    return { batchId, source: preview.source, appliedAt, items, totals: countActions(items) };
  };
  return store.runInTransaction ? store.runInTransaction(execute) : execute();
}

export function rollbackImport(store: UptimeImportStore, batchId: string): ImportRollbackResult {
  if (store.mode === "hosted") {
    throw new Error("hosted import rollback requires cloud import_batches and audit");
  }
  const batch = store.getImportBatch(batchId);
  if (!batch) throw new Error(`Import batch not found: ${batchId}`);
  if (batch.status === "rolled_back") throw new Error(`Import batch already rolled back: ${batchId}`);
  const items = [...batch.records].reverse().map((record) => rollbackRecord(store, record));
  const rolledBack = store.markImportBatchRolledBack(batchId);
  return {
    batchId,
    source: rolledBack.source,
    rolledBackAt: rolledBack.rolledBackAt ?? new Date().toISOString(),
    items,
  };
}

function previewRecord(
  store: UptimeImportStore,
  source: ImportSource,
  record: unknown,
  defaults: Partial<CreateMonitorInput>,
  options: { workspaceId?: string },
): ImportPreviewItem {
  const warnings: string[] = [];
  let candidate: ImportCandidate;
  try {
    if (store.mode === "hosted") assertHostedTargetAllowed(rawTargetForHostedPolicy(source, record, defaults));
    candidate = normalizeCandidate(source, record, defaults);
    validateCandidate(candidate);
    if (store.mode === "hosted") assertHostedTargetAllowed(candidate);
  } catch (error) {
    return {
      candidate: fallbackCandidate(source, record),
      action: "blocked",
      monitor: null,
      provenance: null,
      warnings,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  const monitorOptions = options.workspaceId ? { workspaceId: options.workspaceId } : undefined;
  const rawProvenance = store.getProvenance(candidate.source, candidate.sourceId);
  const provenanceMonitor = rawProvenance ? store.getMonitor(rawProvenance.monitorId, monitorOptions) : null;
  const provenance = provenanceMonitor ? rawProvenance : null;
  const monitor = provenanceMonitor ?? store.getMonitor(candidate.name, monitorOptions);
  if (rawProvenance && !provenanceMonitor && !options.workspaceId) {
    return { candidate, action: "create", monitor: null, provenance, warnings: ["source provenance points to a missing monitor"], reason: null };
  }
  if (provenance && monitor) {
    const nameOwner = store.getMonitor(candidate.name, monitorOptions);
    if (nameOwner && nameOwner.id !== monitor.id) {
      return {
        candidate,
        action: "conflict",
        monitor,
        provenance,
        warnings,
        reason: "monitor name already exists on another monitor",
      };
    }
    return {
      candidate,
      action: sameTarget(monitor, candidate) ? "unchanged" : "update",
      monitor,
      provenance,
      warnings,
      reason: null,
    };
  }
  if (monitor) {
    return {
      candidate,
      action: "conflict",
      monitor,
      provenance: null,
      warnings,
      reason: "monitor name already exists without matching source provenance",
    };
  }
  return { candidate, action: "create", monitor: null, provenance: null, warnings, reason: null };
}

function applyPreviewItem(store: UptimeImportStore, item: ImportPreviewItem): ImportApplyItem {
  if (item.action === "blocked" || item.action === "conflict") {
    return { ...item, before: item.monitor, after: item.monitor };
  }
  const input = candidateToMonitorInput(item.candidate);
  const before = item.monitor;
  const after = item.action === "create"
    ? store.createMonitor(input, { allowBrowserPage: true })
    : item.action === "update"
      ? store.updateMonitor(item.monitor!.id, input, { allowBrowserPage: true })
      : item.monitor;
  if (after) {
    store.upsertMonitorProvenance({
      monitorId: after.id,
      source: item.candidate.source,
      sourceId: item.candidate.sourceId,
      sourceLabel: item.candidate.sourceLabel,
      snapshot: item.candidate.snapshot,
    });
  }
  return { ...item, before, after };
}

function rollbackRecord(store: UptimeImportStore, record: unknown): ImportRollbackItem {
  const value = asRecord(record);
  const action = stringValue(value.action);
  const monitorId = stringValue(value.monitorId);
  const before = isMonitor(value.before) ? value.before : null;
  const after = isMonitor(value.after) ? value.after : null;
  const targetId = after?.id ?? before?.id ?? monitorId;
  if (!targetId) return { monitorId: null, action: "skipped", reason: "batch record has no monitor id" };
  if (action === "create") {
    const hasHistory = store.listResults({ monitorId: targetId, limit: 1 }).length > 0;
    if (hasHistory) {
      store.updateMonitor(targetId, { enabled: false }, { allowBrowserPage: true });
      return { monitorId: targetId, action: "disabled", reason: "created monitor has check history, so rollback preserved history and disabled it" };
    }
    return { monitorId: targetId, action: store.deleteMonitor(targetId) ? "deleted" : "skipped", reason: null };
  }
  if (action === "update" && before) {
    store.updateMonitor(targetId, monitorToUpdateInput(before), { allowBrowserPage: true });
    return { monitorId: targetId, action: "restored", reason: null };
  }
  return { monitorId: targetId, action: "skipped", reason: `no rollback needed for ${action || "unknown"} action` };
}

function normalizeCandidate(source: ImportSource, record: unknown, defaults: Partial<CreateMonitorInput>): ImportCandidate {
  const value = asRecord(record);
  const monitor = asRecord(value.monitor);
  const sourceId = sanitizeIdentity(stringValue(value.sourceId) ?? stringValue(value.id) ?? stringValue(value.slug) ?? stringValue(value.name));
  let url = stringValue(monitor.url) ?? stringValue(value.url) ?? stringValue(value.healthUrl) ?? stringValue(value.homepageUrl) ?? stringValue(value.environmentUrl);
  if (source === "domains" && !url && stringValue(value.domain)) {
    url = `https://${stringValue(value.domain)}`;
  }
  const rawHost = stringValue(monitor.host) ?? stringValue(value.host) ?? stringValue(value.hostname);
  const rawKind = stringValue(monitor.kind) ?? stringValue(value.kind) ?? (url ? "http" : "tcp");
  const kind = normalizeKind(rawKind);
  const normalizedUrl = normalizeCandidateUrl(url ?? defaults.url);
  const normalizedHost = kind === "tcp" ? rawHost ?? defaults.host : undefined;
  const port = numberValue(monitor.port) ?? numberValue(value.port) ?? defaults.port;
  const normalizedTargetKey = sanitizeGeneratedTargetKey(kind, normalizedUrl, normalizedHost, port);
  const normalizedSourceId = sourceId ?? `${source}:${normalizedTargetKey}`;
  const name = stringValue(monitor.name)
    ?? stringValue(value.monitorName)
    ?? stringValue(value.name)
    ?? stringValue(value.slug)
    ?? (source === "domains" ? stringValue(value.domain) : undefined)
    ?? (kind === "tcp" ? stringValue(value.hostname) : undefined)
    ?? `${source}-${normalizedTargetKey}`;
  const expectedStatus = firstDefined(
    nullableNumberValue(monitor.expectedStatus),
    nullableNumberValue(value.expectedStatus),
    defaults.expectedStatus,
  );
  const candidate: ImportCandidate = {
    source,
    sourceId: normalizedSourceId,
    sourceLabel: sanitizeIdentity(stringValue(value.label) ?? stringValue(value.name) ?? stringValue(value.slug)) ?? null,
    name: sanitizeIdentity(name) ?? name,
    kind,
    url: normalizedUrl,
    host: normalizedHost,
    port,
    method: normalizeCandidateMethod(stringValue(monitor.method) ?? stringValue(value.method) ?? defaults.method),
    expectedStatus,
    intervalSeconds: numberValue(monitor.intervalSeconds) ?? numberValue(value.intervalSeconds) ?? defaults.intervalSeconds,
    timeoutMs: numberValue(monitor.timeoutMs) ?? numberValue(value.timeoutMs) ?? defaults.timeoutMs,
    retryCount: numberValue(monitor.retryCount) ?? numberValue(value.retryCount) ?? defaults.retryCount,
    enabled: booleanValue(monitor.enabled) ?? booleanValue(value.enabled) ?? defaults.enabled,
    snapshot: sanitizeSnapshot(record),
  };
  return candidate;
}

function rawTargetForHostedPolicy(source: ImportSource, record: unknown, defaults: Partial<CreateMonitorInput>): Pick<ImportCandidate, "kind" | "url" | "host" | "port"> {
  const value = asRecord(record);
  const monitor = asRecord(value.monitor);
  let url = stringValue(monitor.url) ?? stringValue(value.url) ?? stringValue(value.healthUrl) ?? stringValue(value.homepageUrl) ?? stringValue(value.environmentUrl);
  if (source === "domains" && !url && stringValue(value.domain)) {
    url = `https://${stringValue(value.domain)}`;
  }
  const host = stringValue(monitor.host) ?? stringValue(value.host) ?? stringValue(value.hostname) ?? defaults.host;
  const rawKind = stringValue(monitor.kind) ?? stringValue(value.kind) ?? (url ? "http" : "tcp");
  const kind = normalizeKind(rawKind);
  return {
    kind,
    url: url ?? defaults.url,
    host: kind === "tcp" ? host : undefined,
    port: numberValue(monitor.port) ?? numberValue(value.port) ?? defaults.port,
  };
}

function validateCandidate(candidate: ImportCandidate): void {
  if (!candidate.name.trim()) throw new Error("import candidate requires name");
  rejectControlCharacters(candidate.name.trim(), "Monitor name");
  if (candidate.method !== undefined && !/^[A-Z]+$/.test(candidate.method)) {
    throw new Error("HTTP method must contain only letters");
  }
  if (candidate.expectedStatus !== undefined && candidate.expectedStatus !== null) {
    if (!Number.isInteger(candidate.expectedStatus) || candidate.expectedStatus < 100 || candidate.expectedStatus > 599) {
      throw new Error("expectedStatus must be an HTTP status from 100 to 599");
    }
  }
  if (candidate.intervalSeconds !== undefined) {
    boundedInteger(candidate.intervalSeconds, "intervalSeconds", MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS);
  }
  if (candidate.timeoutMs !== undefined) {
    boundedInteger(candidate.timeoutMs, "timeoutMs", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
  }
  if (candidate.retryCount !== undefined) {
    boundedInteger(candidate.retryCount, "retryCount", MIN_RETRY_COUNT, MAX_RETRY_COUNT);
  }
  if (candidate.kind === "http" || candidate.kind === "browser_page") {
    if (!candidate.url) throw new Error(`${candidate.kind} import candidate requires url`);
    const parsed = new URL(candidate.url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`${candidate.kind} import candidate URL must use http or https`);
    }
    if (parsed.username || parsed.password) throw new Error(`${candidate.kind} import candidate URL must not contain userinfo`);
    return;
  }
  if (candidate.kind === "tcp") {
    if (!candidate.host) throw new Error("tcp import candidate requires host");
    rejectControlCharacters(candidate.host, "TCP host");
    if (!Number.isInteger(candidate.port) || candidate.port! <= 0 || candidate.port! > 65535) {
      throw new Error("tcp import candidate requires a port from 1 to 65535");
    }
    return;
  }
  throw new Error(`unsupported import candidate kind: ${candidate.kind}`);
}

function candidateToMonitorInput(candidate: ImportCandidate): ImportedMonitorInput {
  return {
    name: candidate.name,
    kind: candidate.kind,
    url: candidate.url,
    host: candidate.host,
    port: candidate.port,
    method: candidate.method,
    expectedStatus: candidate.expectedStatus,
    intervalSeconds: candidate.intervalSeconds,
    timeoutMs: candidate.timeoutMs,
    retryCount: candidate.retryCount,
    enabled: candidate.enabled,
  };
}

function monitorToUpdateInput(monitor: Monitor): ImportedUpdateMonitorInput {
  return {
    name: monitor.name,
    kind: monitor.kind,
    url: monitor.url ?? undefined,
    host: monitor.host ?? undefined,
    port: monitor.port ?? undefined,
    method: monitor.method,
    expectedStatus: monitor.expectedStatus,
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    retryCount: monitor.retryCount,
    enabled: monitor.enabled,
  };
}

function sameTarget(monitor: Monitor, candidate: ImportCandidate): boolean {
  return monitor.kind === candidate.kind
    && monitor.name === candidate.name
    && monitor.url === (candidate.url ?? null)
    && monitor.host === (candidate.host ?? null)
    && monitor.port === (candidate.port ?? null)
    && monitor.method === (candidate.method ?? monitor.method)
    && (candidate.expectedStatus === undefined || monitor.expectedStatus === candidate.expectedStatus)
    && monitor.intervalSeconds === (candidate.intervalSeconds ?? monitor.intervalSeconds)
    && monitor.timeoutMs === (candidate.timeoutMs ?? monitor.timeoutMs)
    && monitor.retryCount === (candidate.retryCount ?? monitor.retryCount)
    && monitor.enabled === (candidate.enabled ?? monitor.enabled);
}

function countActions(items: Array<{ action: ImportAction }>): Record<ImportAction, number> {
  return {
    create: items.filter((item) => item.action === "create").length,
    update: items.filter((item) => item.action === "update").length,
    unchanged: items.filter((item) => item.action === "unchanged").length,
    blocked: items.filter((item) => item.action === "blocked").length,
    conflict: items.filter((item) => item.action === "conflict").length,
  };
}

function normalizeSource(source: ImportSource): ImportSource {
  if (["manual", "projects", "servers", "domains", "deployment"].includes(source)) return source;
  throw new Error(`unsupported import source: ${source}`);
}

function normalizeKind(value: string | undefined): MonitorKind {
  if (value === "http" || value === "tcp" || value === "browser_page") return value;
  return value === "browser" || value === "page" ? "browser_page" : "http";
}

function targetKey(kind: MonitorKind, url?: string, host?: string, port?: number): string {
  return kind === "tcp" ? `${host ?? "host"}:${port ?? "port"}` : url ?? "url";
}

function sanitizeGeneratedTargetKey(kind: MonitorKind, url?: string, host?: string, port?: number): string {
  const key = targetKey(kind, url, host, port);
  return kind === "tcp" ? key : sanitizeIdentity(key) ?? key;
}

function normalizeCandidateUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSecretKey(key)) parsed.searchParams.set(key, "[redacted]");
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function normalizeCandidateMethod(value: string | undefined): string | undefined {
  return value?.trim().toUpperCase();
}

function fallbackCandidate(source: ImportSource, record: unknown): ImportCandidate {
  const value = asRecord(record);
  const monitor = asRecord(value.monitor);
  const name = stringValue(monitor.name) ?? stringValue(value.name) ?? stringValue(value.domain) ?? "invalid import candidate";
  const rawUrl = stringValue(monitor.url) ?? stringValue(value.url) ?? stringValue(value.domain);
  const kind = normalizeKind(stringValue(monitor.kind) ?? stringValue(value.kind) ?? "http");
  return {
    source,
    sourceId: sanitizeIdentity(stringValue(value.sourceId) ?? stringValue(value.id)) ?? `${source}:invalid`,
    sourceLabel: sanitizeIdentity(stringValue(value.label)) ?? null,
    name: sanitizeIdentity(name) ?? name,
    kind,
    url: redactUrlForDisplay(rawUrl),
    host: kind === "tcp" ? sanitizeHost(stringValue(monitor.host) ?? stringValue(value.host) ?? stringValue(value.hostname)) : undefined,
    port: numberValue(monitor.port) ?? numberValue(value.port),
    snapshot: sanitizeSnapshot(record),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableNumberValue(value: unknown): number | null | undefined {
  if (value === null) return null;
  return numberValue(value);
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

function isMonitor(value: unknown): value is Monitor {
  const row = asRecord(value);
  return Boolean(stringValue(row.id) && stringValue(row.name) && stringValue(row.kind));
}

function sanitizeSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSnapshot);
  if (!value || typeof value !== "object") return sanitizeScalar(value);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSecretKey(key)) output[key] = "[redacted]";
    else output[key] = sanitizeSnapshot(entry);
  }
  return output;
}

function sanitizeScalar(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value
    .replace(/\/(?:home|Users)\/[^\s"'<>]+/g, "[local-path]")
    .replace(/\b(?:localhost|(?:[a-z0-9-]+\.)+(?:local|internal))\b/gi, "[private-host]")
    .replace(/(https?:\/\/)[^/?#\s"'<>]+:[^@/?#\s"'<>]+@/gi, "$1[redacted]@")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/((?:token|secret|password|passwd|api[_-]?key|access[_-]?token|auth|credential|session)[=:]\s*)[^\s&]+/gi, "$1[redacted]");
}

function isSecretKey(value: string): boolean {
  return /(token|secret|password|passwd|api[_-]?key|access[_-]?token|auth|credential|session)/i.test(value);
}

function rejectControlCharacters(value: string, label: string): void {
  if (/[\x00-\x1f\x7f-\x9f]/.test(value)) {
    throw new Error(`${label} must not contain control characters`);
  }
}

function boundedInteger(value: number, label: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function redactUrlForDisplay(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    parsed.username = parsed.username ? "[redacted]" : "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSecretKey(key)) parsed.searchParams.set(key, "[redacted]");
    }
    if (parsed.hash && isSecretKey(parsed.hash)) parsed.hash = "#[redacted]";
    return parsed.toString();
  } catch {
    return sanitizeScalar(value) as string;
  }
}

function sanitizeIdentity(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    parsed.username = parsed.username ? "[redacted]" : "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSecretKey(key)) parsed.searchParams.set(key, "[redacted]");
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return sanitizeScalar(value) as string;
  }
}

function sanitizeHost(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return sanitizeScalar(value) as string;
}
