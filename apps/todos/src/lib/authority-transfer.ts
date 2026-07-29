import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Database } from "bun:sqlite";
import { TodosV1Client } from "../sdk/v1.generated.js";
import { getDatabase, getDatabasePath } from "../db/database.js";
import { getPackageVersion } from "./package-version.js";
import {
  createLocalBridgeBundle,
  importLocalBridgeBundle,
  validateLocalBridgeBundle,
  type LocalBridgeImportResult,
  type TodosLocalBridgeBundle,
  type TodosLocalBridgeData,
} from "./local-bridge.js";

export const TODOS_AUTHORITY_TRANSFER_KIND = "hasna.todos.authority-transfer";
export const TODOS_AUTHORITY_TRANSFER_SCHEMA_VERSION = 1;
export const TODOS_AUTHORITY_PROFILE_KIND = "hasna.todos.authority-profile";
export const TODOS_AUTHORITY_PROFILE_SCHEMA_VERSION = 1;
export const TODOS_TRANSFER_RECEIPT_KIND = "hasna.todos.transfer-receipt";
export const TODOS_TRANSFER_REPAIR_KIND = "hasna.todos.transfer-repair";

export type TodosAuthorityMode = "local" | "cloud";

export interface TodosLocalAuthorityProfile {
  mode: "local";
}

export interface TodosCloudAuthorityProfile {
  mode: "cloud";
  base_url: string;
  api_key_env: string;
}

export type TodosAuthorityProfile = TodosLocalAuthorityProfile | TodosCloudAuthorityProfile;

export interface TodosAuthorityProfileFile {
  kind: typeof TODOS_AUTHORITY_PROFILE_KIND;
  schema_version: typeof TODOS_AUTHORITY_PROFILE_SCHEMA_VERSION;
  active: TodosAuthorityProfile;
}

export interface TodosTransferSource {
  mode: TodosAuthorityMode;
  authority: string;
}

export interface TodosAuthorityTransferBundle {
  kind: typeof TODOS_AUTHORITY_TRANSFER_KIND;
  schema_version: typeof TODOS_AUTHORITY_TRANSFER_SCHEMA_VERSION;
  bundle_id: string;
  exported_at: string;
  source: TodosTransferSource;
  provenance: {
    package_name: "@hasna/todos";
    repository: "hasna/todos";
    package_version: string;
    bridge_schema_version: number;
  };
  data: TodosLocalBridgeData;
  artifact_contents: NonNullable<TodosLocalBridgeBundle["artifact_contents"]>;
  counts: Record<keyof TodosLocalBridgeData | "artifact_contents", number>;
  checksums: Record<keyof TodosLocalBridgeData | "artifact_contents", string>;
  checksum: string;
}

export type TodosTransferIssueCode =
  | "bundle"
  | "compatibility"
  | "count"
  | "checksum"
  | "duplicate"
  | "ownership"
  | "dependency"
  | "comment"
  | "evidence"
  | "attachment"
  | "ref"
  | "projection"
  | "provenance";

export interface TodosTransferIssue {
  code: TodosTransferIssueCode;
  section: string;
  row_id: string | null;
  message: string;
}

export interface TodosTransferValidation {
  ok: boolean;
  issues: TodosTransferIssue[];
}

export interface TodosTransferRepairReport {
  kind: typeof TODOS_TRANSFER_REPAIR_KIND;
  schema_version: 1;
  repair_id: string;
  bundle_id: string;
  destination: TodosTransferSource;
  rejected_rows: TodosTransferIssue[];
}

export interface TodosTransferImportResult {
  ok: boolean;
  idempotent: boolean;
  import_result: LocalBridgeImportResult | Record<string, unknown> | null;
  repair_report: TodosTransferRepairReport | null;
}

export interface TodosTransferReceipt {
  kind: typeof TODOS_TRANSFER_RECEIPT_KIND;
  schema_version: 1;
  receipt_id: string;
  bundle_id: string;
  source: TodosTransferSource;
  destination: TodosTransferSource;
  counts: TodosAuthorityTransferBundle["counts"];
  verified: boolean;
  replayed: boolean;
}

export interface TodosAuthorityEndpoint {
  readonly profile: TodosAuthorityProfile;
  readonly authority: string;
  exportBundle(): Promise<TodosAuthorityTransferBundle>;
  importBundle(bundle: TodosAuthorityTransferBundle): Promise<TodosTransferImportResult>;
}

export interface TodosTransferPaths {
  profile: string;
  receipts: string;
  repairs: string;
}

export interface TransferAndSwitchOptions {
  source: TodosAuthorityEndpoint;
  destination: TodosAuthorityEndpoint;
  paths?: Partial<TodosTransferPaths>;
  beforePersist?: (receipt: TodosTransferReceipt) => void | Promise<void>;
}

export interface TransferAndSwitchResult {
  ok: true;
  bundle: TodosAuthorityTransferBundle;
  receipt: TodosTransferReceipt;
  receipt_path: string;
}

const DATA_KEYS = [
  "projects",
  "task_lists",
  "plans",
  "tasks",
  "task_dependencies",
  "comments",
  "runs",
  "run_events",
  "run_commands",
  "run_artifacts",
  "task_files",
  "task_commits",
  "task_git_refs",
  "task_verifications",
  "saved_views",
  "task_boards",
  "local_calendar_items",
] as const satisfies readonly (keyof TodosLocalBridgeData)[];

type TransferSection = typeof DATA_KEYS[number] | "artifact_contents";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function rowIdentity(section: TransferSection, value: unknown): string {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  if (section === "task_dependencies") return `${row.task_id ?? ""}->${row.depends_on ?? ""}`;
  if (section === "artifact_contents") return String(row.artifact_id ?? "");
  return String(row.id ?? "");
}

function canonicalRows(section: TransferSection, rows: readonly unknown[]): unknown[] {
  return [...rows].sort((left, right) => {
    const identity = rowIdentity(section, left).localeCompare(rowIdentity(section, right));
    return identity || stableJson(left).localeCompare(stableJson(right));
  });
}

function canonicalData(data: TodosLocalBridgeData): TodosLocalBridgeData {
  return Object.fromEntries(DATA_KEYS.map((key) => [key, canonicalRows(key, data[key])])) as unknown as TodosLocalBridgeData;
}

function latestTimestamp(data: TodosLocalBridgeData): string {
  let latest = "1970-01-01T00:00:00.000Z";
  for (const key of DATA_KEYS) {
    for (const value of data[key] as unknown as Array<Record<string, unknown>>) {
      for (const clock of ["updated_at", "created_at", "run_at", "completed_at", "started_at"]) {
        const candidate = value[clock];
        if (typeof candidate === "string" && Number.isFinite(Date.parse(candidate)) && candidate > latest) latest = candidate;
      }
    }
  }
  return latest;
}

function transferCounts(
  data: TodosLocalBridgeData,
  artifactContents: NonNullable<TodosLocalBridgeBundle["artifact_contents"]>,
): TodosAuthorityTransferBundle["counts"] {
  return Object.fromEntries([
    ...DATA_KEYS.map((key) => [key, data[key].length]),
    ["artifact_contents", artifactContents.length],
  ]) as TodosAuthorityTransferBundle["counts"];
}

function transferChecksums(
  data: TodosLocalBridgeData,
  artifactContents: NonNullable<TodosLocalBridgeBundle["artifact_contents"]>,
): TodosAuthorityTransferBundle["checksums"] {
  return Object.fromEntries([
    ...DATA_KEYS.map((key) => [key, sha256(data[key])]),
    ["artifact_contents", sha256(artifactContents)],
  ]) as TodosAuthorityTransferBundle["checksums"];
}

function bundleBody(bundle: Omit<TodosAuthorityTransferBundle, "bundle_id" | "checksum">): unknown {
  return bundle;
}

export function createAuthorityTransferBundle(
  bridge: TodosLocalBridgeBundle,
  source: TodosTransferSource,
): TodosAuthorityTransferBundle {
  const bridgeValidation = validateLocalBridgeBundle(bridge);
  if (!bridgeValidation.ok) throw new Error(`invalid bridge export: ${bridgeValidation.issues.join("; ")}`);
  const data = canonicalData(bridge.data);
  const artifactContents = canonicalRows("artifact_contents", bridge.artifact_contents ?? []) as NonNullable<TodosLocalBridgeBundle["artifact_contents"]>;
  const exportedAt = latestTimestamp(data);
  const body: Omit<TodosAuthorityTransferBundle, "bundle_id" | "checksum"> = {
    kind: TODOS_AUTHORITY_TRANSFER_KIND,
    schema_version: TODOS_AUTHORITY_TRANSFER_SCHEMA_VERSION,
    exported_at: exportedAt,
    source,
    provenance: {
      package_name: "@hasna/todos",
      repository: "hasna/todos",
      package_version: bridge.package.version,
      bridge_schema_version: bridge.schemaVersion,
    },
    data,
    artifact_contents: artifactContents,
    counts: transferCounts(data, artifactContents),
    checksums: transferChecksums(data, artifactContents),
  };
  const bundleId = sha256(bundleBody(body));
  const withoutChecksum = { ...body, bundle_id: bundleId };
  return { ...withoutChecksum, checksum: sha256(withoutChecksum) };
}

function issue(
  issues: TodosTransferIssue[],
  code: TodosTransferIssueCode,
  section: string,
  rowId: string | null,
  message: string,
): void {
  issues.push({ code, section, row_id: rowId, message });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validMode(value: unknown): value is TodosAuthorityMode {
  return value === "local" || value === "cloud";
}

function ids(data: TodosLocalBridgeData, key: Exclude<keyof TodosLocalBridgeData, "task_dependencies">): Set<string> {
  return new Set((data[key] as unknown as Array<Record<string, unknown>>)
    .map((row) => typeof row.id === "string" ? row.id : "")
    .filter(Boolean));
}

function validateUniqueRows(data: TodosLocalBridgeData, issues: TodosTransferIssue[]): void {
  for (const key of DATA_KEYS) {
    const seen = new Set<string>();
    for (const row of data[key] as unknown as Array<Record<string, unknown>>) {
      const id = rowIdentity(key, row);
      if (!id) issue(issues, "bundle", key, null, `${key} row is missing its stable identity`);
      else if (seen.has(id)) issue(issues, "duplicate", key, id, `duplicate ${key} identity`);
      seen.add(id);
    }
  }
}

function validateOwnershipAndReferences(data: TodosLocalBridgeData, issues: TodosTransferIssue[]): void {
  const projectIds = ids(data, "projects");
  const listIds = ids(data, "task_lists");
  const planIds = ids(data, "plans");
  const taskIds = ids(data, "tasks");
  const runIds = ids(data, "runs");

  const requireRef = (code: TodosTransferIssueCode, section: string, row: Record<string, unknown>, field: string, allowed: Set<string>) => {
    const value = row[field];
    if (typeof value === "string" && value && !allowed.has(value)) {
      issue(issues, code, section, rowIdentity(section as TransferSection, row) || null, `${field} references missing ${value}`);
    }
  };

  for (const row of data.task_lists as unknown as Array<Record<string, unknown>>) requireRef("ownership", "task_lists", row, "project_id", projectIds);
  for (const row of data.plans as unknown as Array<Record<string, unknown>>) {
    requireRef("ownership", "plans", row, "project_id", projectIds);
    requireRef("projection", "plans", row, "task_list_id", listIds);
  }
  for (const row of data.tasks as unknown as Array<Record<string, unknown>>) {
    requireRef("ownership", "tasks", row, "project_id", projectIds);
    requireRef("dependency", "tasks", row, "parent_id", taskIds);
    requireRef("projection", "tasks", row, "plan_id", planIds);
    requireRef("projection", "tasks", row, "task_list_id", listIds);
  }
  for (const row of data.task_dependencies as unknown as Array<Record<string, unknown>>) {
    requireRef("dependency", "task_dependencies", row, "task_id", taskIds);
    requireRef("dependency", "task_dependencies", row, "depends_on", taskIds);
    if (row.task_id === row.depends_on) issue(issues, "dependency", "task_dependencies", rowIdentity("task_dependencies", row), "self dependency is not allowed");
  }
  for (const row of data.comments as unknown as Array<Record<string, unknown>>) requireRef("comment", "comments", row, "task_id", taskIds);
  for (const row of data.runs as unknown as Array<Record<string, unknown>>) requireRef("evidence", "runs", row, "task_id", taskIds);
  for (const section of ["run_events", "run_commands", "run_artifacts"] as const) {
    for (const row of data[section] as unknown as Array<Record<string, unknown>>) {
      requireRef(section === "run_artifacts" ? "attachment" : "evidence", section, row, "task_id", taskIds);
      requireRef(section === "run_artifacts" ? "attachment" : "evidence", section, row, "run_id", runIds);
    }
  }
  for (const section of ["task_files", "task_commits", "task_verifications"] as const) {
    for (const row of data[section] as unknown as Array<Record<string, unknown>>) requireRef("evidence", section, row, "task_id", taskIds);
  }
  for (const row of data.task_git_refs as unknown as Array<Record<string, unknown>>) requireRef("ref", "task_git_refs", row, "task_id", taskIds);
  for (const row of data.task_boards as unknown as Array<Record<string, unknown>>) {
    requireRef("projection", "task_boards", row, "project_id", projectIds);
    requireRef("projection", "task_boards", row, "task_list_id", listIds);
    requireRef("projection", "task_boards", row, "plan_id", planIds);
  }
  for (const row of data.local_calendar_items as unknown as Array<Record<string, unknown>>) {
    requireRef("projection", "local_calendar_items", row, "project_id", projectIds);
    requireRef("projection", "local_calendar_items", row, "task_id", taskIds);
    requireRef("projection", "local_calendar_items", row, "plan_id", planIds);
    requireRef("projection", "local_calendar_items", row, "run_id", runIds);
  }
}

function validateDependencyCycles(data: TodosLocalBridgeData, issues: TodosTransferIssue[]): void {
  const adjacency = new Map<string, string[]>();
  for (const edge of data.task_dependencies) {
    if (!adjacency.has(edge.task_id)) adjacency.set(edge.task_id, []);
    adjacency.get(edge.task_id)!.push(edge.depends_on);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const walk = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) if (walk(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const id of adjacency.keys()) {
    if (walk(id)) {
      issue(issues, "dependency", "task_dependencies", id, `dependency cycle includes ${id}`);
      break;
    }
  }
}

function validateArtifacts(bundle: TodosAuthorityTransferBundle, issues: TodosTransferIssue[]): void {
  const artifactIds = ids(bundle.data, "run_artifacts");
  const seen = new Set<string>();
  for (const content of bundle.artifact_contents) {
    const rowId = content.artifact_id || null;
    if (!artifactIds.has(content.artifact_id)) issue(issues, "attachment", "artifact_contents", rowId, "content references a missing run artifact");
    if (seen.has(content.artifact_id)) issue(issues, "duplicate", "artifact_contents", rowId, "duplicate artifact content");
    seen.add(content.artifact_id);
    let bytes: Buffer;
    try {
      bytes = Buffer.from(content.base64, "base64");
    } catch {
      issue(issues, "attachment", "artifact_contents", rowId, "content is not valid base64");
      continue;
    }
    if (bytes.length !== content.size_bytes) issue(issues, "attachment", "artifact_contents", rowId, "content size does not match manifest");
    if (createHash("sha256").update(bytes).digest("hex") !== content.sha256) {
      issue(issues, "attachment", "artifact_contents", rowId, "content checksum does not match manifest");
    }
  }
}

export function validateAuthorityTransferBundle(value: unknown): TodosTransferValidation {
  const issues: TodosTransferIssue[] = [];
  const record = asRecord(value);
  if (!record) return { ok: false, issues: [{ code: "bundle", section: "bundle", row_id: null, message: "bundle must be an object" }] };
  if (record.kind !== TODOS_AUTHORITY_TRANSFER_KIND) issue(issues, "compatibility", "bundle", null, `kind must be ${TODOS_AUTHORITY_TRANSFER_KIND}`);
  if (record.schema_version !== TODOS_AUTHORITY_TRANSFER_SCHEMA_VERSION) issue(issues, "compatibility", "bundle", null, `schema_version must be ${TODOS_AUTHORITY_TRANSFER_SCHEMA_VERSION}`);
  const bundle = value as TodosAuthorityTransferBundle;
  const source = asRecord(record.source);
  if (!source || !validMode(source.mode) || typeof source.authority !== "string" || !source.authority) {
    issue(issues, "provenance", "source", null, "source must name a local or cloud authority");
  }
  const provenance = asRecord(record.provenance);
  if (!provenance || provenance.package_name !== "@hasna/todos" || provenance.repository !== "hasna/todos" ||
      typeof provenance.package_version !== "string" || !/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(provenance.package_version) ||
      provenance.bridge_schema_version !== 1) {
    issue(issues, "provenance", "provenance", null, "unsupported or incomplete package provenance");
  }
  if (typeof record.exported_at !== "string" || !Number.isFinite(Date.parse(record.exported_at))) {
    issue(issues, "provenance", "bundle", null, "exported_at must be a valid timestamp");
  }
  const bridgeValidation = validateLocalBridgeBundle({
    kind: "hasna.todos.local-bridge",
    schemaVersion: 1,
    exportedAt: record.exported_at,
    package: { packageName: "@hasna/todos", repository: "hasna/todos", version: provenance?.package_version },
    source: { project_id: null, project_path: null },
    data: record.data,
    artifact_contents: record.artifact_contents,
    stats: record.counts,
  });
  for (const message of bridgeValidation.issues) issue(issues, "bundle", "data", null, message);
  if (!bridgeValidation.ok) return { ok: false, issues };

  for (const section of [...DATA_KEYS, "artifact_contents"] as const) {
    const rows = section === "artifact_contents" ? bundle.artifact_contents : bundle.data[section];
    if (bundle.counts?.[section] !== rows.length) issue(issues, "count", section, null, `count mismatch: expected ${bundle.counts?.[section]}, found ${rows.length}`);
    if (bundle.checksums?.[section] !== sha256(rows)) issue(issues, "checksum", section, null, "section checksum mismatch");
  }
  const { checksum: _checksum, ...withoutChecksum } = bundle;
  if (bundle.checksum !== sha256(withoutChecksum)) issue(issues, "checksum", "bundle", null, "bundle checksum mismatch");
  const { bundle_id: _bundleId, checksum: _bundleChecksum, ...withoutIdentity } = bundle;
  if (bundle.bundle_id !== sha256(bundleBody(withoutIdentity))) issue(issues, "checksum", "bundle", null, "bundle_id does not match canonical content");
  if (bundle.exported_at !== latestTimestamp(bundle.data)) issue(issues, "provenance", "bundle", null, "exported_at is not the deterministic data clock");

  validateUniqueRows(bundle.data, issues);
  validateOwnershipAndReferences(bundle.data, issues);
  validateDependencyCycles(bundle.data, issues);
  validateArtifacts(bundle, issues);
  return { ok: issues.length === 0, issues };
}

function bridgeFromTransfer(bundle: TodosAuthorityTransferBundle): TodosLocalBridgeBundle {
  return {
    schemaVersion: 1,
    kind: "hasna.todos.local-bridge",
    exportedAt: bundle.exported_at,
    package: {
      packageName: "@hasna/todos",
      repository: "hasna/todos",
      version: bundle.provenance.package_version,
    },
    source: { project_id: null, project_path: bundle.source.mode === "local" ? bundle.source.authority : null },
    data: bundle.data,
    artifact_contents: bundle.artifact_contents,
    stats: Object.fromEntries(DATA_KEYS.map((key) => [key, bundle.counts[key]])) as TodosLocalBridgeBundle["stats"],
  };
}

export function makeTransferRepairReport(
  bundleId: string,
  destination: TodosTransferSource,
  rejectedRows: TodosTransferIssue[],
): TodosTransferRepairReport {
  const body = { bundle_id: bundleId, destination, rejected_rows: rejectedRows };
  return {
    kind: TODOS_TRANSFER_REPAIR_KIND,
    schema_version: 1,
    repair_id: sha256(body),
    ...body,
  };
}

export function createLocalAuthorityEndpoint(
  db: Database = getDatabase(),
  authority = getDatabasePath(),
): TodosAuthorityEndpoint {
  const source = { mode: "local" as const, authority };
  return {
    profile: { mode: "local" },
    authority,
    async exportBundle() {
      const initial = createLocalBridgeBundle({ generatedAt: "1970-01-01T00:00:00.000Z", redaction: "unsafe_plaintext" }, db);
      return createAuthorityTransferBundle(initial, source);
    },
    async importBundle(bundle) {
      const validation = validateAuthorityTransferBundle(bundle);
      if (!validation.ok) {
        return { ok: false, idempotent: false, import_result: null, repair_report: makeTransferRepairReport(bundle.bundle_id || "invalid", source, validation.issues) };
      }
      const imported = importLocalBridgeBundle(bridgeFromTransfer(bundle), { dryRun: false, conflictStrategy: "skip" }, db);
      const rejected = [
        ...imported.conflicts.filter((conflict) => conflict.reason === "missing_dependency").map((conflict): TodosTransferIssue => ({
          code: "dependency", section: conflict.table, row_id: conflict.id, message: "destination rejected a row with a missing dependency",
        })),
        ...imported.issues.map((message): TodosTransferIssue => ({ code: "attachment", section: "artifact_contents", row_id: null, message })),
      ];
      return {
        ok: imported.ok && rejected.length === 0,
        idempotent: Object.values(imported.inserted).every((count) => count === 0),
        import_result: imported,
        repair_report: rejected.length > 0 ? makeTransferRepairReport(bundle.bundle_id, source, rejected) : null,
      };
    },
  };
}

export function createCloudAuthorityEndpoint(
  profileInput: TodosCloudAuthorityProfile,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): TodosAuthorityEndpoint {
  const profile = normalizeAuthorityProfile(profileInput);
  if (profile.mode !== "cloud") throw new Error("cloud authority endpoint requires a cloud profile");
  const apiKey = env[profile.api_key_env]?.trim();
  if (!apiKey) throw new Error(`cloud authority requires ${profile.api_key_env}`);
  const origin = profile.base_url.replace(/\/v1\/?$/, "");
  const client = new TodosV1Client({
    baseUrl: origin,
    apiKey,
    fetch: (input, init) => fetchImpl(input, { ...init, redirect: "manual" }),
  });
  return {
    profile,
    authority: profile.base_url,
    async exportBundle() {
      const response = await client.exportAuthorityTransfer();
      const bundle = response.bundle as unknown as TodosAuthorityTransferBundle;
      const validation = validateAuthorityTransferBundle(bundle);
      if (!validation.ok) throw new Error(`cloud authority returned an invalid transfer bundle: ${validation.issues.map((item) => item.message).join("; ")}`);
      return bundle;
    },
    async importBundle(bundle) {
      const response = await client.importAuthorityTransfer(bundle as unknown as Record<string, unknown>);
      const result = response.result as unknown as TodosTransferImportResult;
      if (!result || typeof result !== "object" || typeof result.ok !== "boolean" || typeof result.idempotent !== "boolean") {
        throw new Error("cloud authority returned an invalid transfer import result");
      }
      return result;
    },
  };
}

function rowMap(bundle: TodosAuthorityTransferBundle): Map<string, string> {
  const result = new Map<string, string>();
  for (const section of [...DATA_KEYS, "artifact_contents"] as const) {
    const rows = section === "artifact_contents" ? bundle.artifact_contents : bundle.data[section];
    for (const row of rows as readonly unknown[]) result.set(`${section}:${rowIdentity(section, row)}`, sha256(row));
  }
  return result;
}

export function verifyTransferredRows(expected: TodosAuthorityTransferBundle, actual: TodosAuthorityTransferBundle): TodosTransferValidation {
  const issues: TodosTransferIssue[] = [];
  const actualValidation = validateAuthorityTransferBundle(actual);
  if (!actualValidation.ok) issues.push(...actualValidation.issues);
  const actualRows = rowMap(actual);
  for (const section of [...DATA_KEYS, "artifact_contents"] as const) {
    const rows = section === "artifact_contents" ? expected.artifact_contents : expected.data[section];
    for (const row of rows as readonly unknown[]) {
      const id = rowIdentity(section, row);
      const expectedHash = sha256(row);
      const found = actualRows.get(`${section}:${id}`);
      if (!found) issue(issues, "checksum", section, id || null, "transferred row is missing from destination");
      else if (found !== expectedHash) issue(issues, "checksum", section, id || null, "destination row differs from transferred row");
    }
  }
  return { ok: issues.length === 0, issues };
}

export function defaultTransferPaths(home = process.env.HOME || "."): TodosTransferPaths {
  const root = join(home, ".hasna", "todos");
  return {
    profile: join(root, "authority-profile.json"),
    receipts: join(root, "transfers", "receipts"),
    repairs: join(root, "transfers", "repairs"),
  };
}

export function normalizeAuthorityProfile(value: unknown): TodosAuthorityProfile {
  const record = asRecord(value);
  if (record?.mode === "local") return { mode: "local" };
  if (record?.mode !== "cloud") throw new Error("authority profile mode must be local or cloud");
  if (typeof record.base_url !== "string" || !record.base_url.trim()) throw new Error("cloud authority profile requires base_url");
  if (typeof record.api_key_env !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(record.api_key_env)) {
    throw new Error("cloud authority profile requires an uppercase api_key_env name");
  }
  const url = new URL(record.base_url);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname))) {
    throw new Error("cloud authority base_url must use HTTPS (HTTP is allowed only for loopback)");
  }
  if (url.username || url.password || url.search || url.hash) throw new Error("cloud authority base_url must not contain credentials, query, or fragment");
  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname && pathname !== "/v1") throw new Error("cloud authority base_url must be an origin or end in /v1");
  return { mode: "cloud", base_url: `${url.origin}/v1`, api_key_env: record.api_key_env };
}

export function readAuthorityProfile(path = defaultTransferPaths().profile): TodosAuthorityProfile {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as TodosAuthorityProfileFile;
    if (parsed.kind !== TODOS_AUTHORITY_PROFILE_KIND || parsed.schema_version !== TODOS_AUTHORITY_PROFILE_SCHEMA_VERSION) {
      throw new Error("unsupported authority profile file");
    }
    return normalizeAuthorityProfile(parsed.active);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { mode: "local" };
    throw error;
  }
}

export function writeAuthorityProfile(profile: TodosAuthorityProfile, path = defaultTransferPaths().profile): void {
  const normalized = normalizeAuthorityProfile(profile);
  const value: TodosAuthorityProfileFile = {
    kind: TODOS_AUTHORITY_PROFILE_KIND,
    schema_version: TODOS_AUTHORITY_PROFILE_SCHEMA_VERSION,
    active: normalized,
  };
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function writeDurableJson(directory: string, id: string, value: unknown): string {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${id}.json`);
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  return path;
}

export async function transferAndSwitch(options: TransferAndSwitchOptions): Promise<TransferAndSwitchResult> {
  if (options.source.profile.mode === options.destination.profile.mode) {
    throw new Error("source and destination authority profiles must differ");
  }
  const paths = { ...defaultTransferPaths(), ...options.paths };
  const bundle = await options.source.exportBundle();
  const validation = validateAuthorityTransferBundle(bundle);
  if (!validation.ok) {
    const repair = makeTransferRepairReport(bundle.bundle_id, { mode: options.destination.profile.mode, authority: options.destination.authority }, validation.issues);
    const repairPath = writeDurableJson(paths.repairs, repair.repair_id, repair);
    throw new Error(`transfer bundle validation failed; repair report: ${repairPath}`);
  }
  const imported = await options.destination.importBundle(bundle);
  if (!imported.ok) {
    const repair = imported.repair_report ?? makeTransferRepairReport(bundle.bundle_id, { mode: options.destination.profile.mode, authority: options.destination.authority }, [{
      code: "bundle", section: "import", row_id: null, message: "destination rejected the transfer",
    }]);
    const repairPath = writeDurableJson(paths.repairs, repair.repair_id, repair);
    throw new Error(`destination import failed; repair report: ${repairPath}`);
  }
  const exported = await options.destination.exportBundle();
  const verification = verifyTransferredRows(bundle, exported);
  if (!verification.ok) {
    const repair = makeTransferRepairReport(bundle.bundle_id, { mode: options.destination.profile.mode, authority: options.destination.authority }, verification.issues);
    const repairPath = writeDurableJson(paths.repairs, repair.repair_id, repair);
    throw new Error(`destination verification failed; repair report: ${repairPath}`);
  }
  const destination = { mode: options.destination.profile.mode, authority: options.destination.authority };
  const receiptBody = { bundle_id: bundle.bundle_id, source: bundle.source, destination };
  const receipt: TodosTransferReceipt = {
    kind: TODOS_TRANSFER_RECEIPT_KIND,
    schema_version: 1,
    receipt_id: sha256(receiptBody),
    bundle_id: bundle.bundle_id,
    source: bundle.source,
    destination,
    counts: bundle.counts,
    verified: true,
    replayed: imported.idempotent,
  };
  await options.beforePersist?.(receipt);
  const receiptPath = writeDurableJson(paths.receipts, receipt.receipt_id, receipt);
  writeAuthorityProfile(options.destination.profile, paths.profile);
  return { ok: true, bundle, receipt, receipt_path: receiptPath };
}

export function localTransferPackageVersion(): string {
  return getPackageVersion(import.meta.url);
}
