import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import {
  DISTRIBUTION_EVENT_TYPES,
  buildRolloutRecord,
  defaultAppIdForPackage,
  rolloutRecordToEventData,
  type RolloutRecordDoc,
  type RolloutResult,
  type RolloutVerification,
} from "../distribution.js";
import { findFreeze, listActiveFreezes } from "./freeze.js";
import { readManifest } from "../manifests.js";
import { ensureParentDir, getManifestPath, getRolloutRecordsPath } from "../paths.js";
import type { FleetManifest, FreezeEntry, ManifestPackageSpec } from "../types.js";

// Desired-state package reconcile loop for machines-agent.
//
// Desired state comes from the machines.json manifest (fleet-wide `packages`
// plus per-machine overrides). Installed state comes from the bun global
// tree (`bun pm ls -g`). The plan installs/updates via `bun install -g
// pkg@version`, verifies the CLI answers `--version` with the new number
// (and the hasna-*-mcp health endpoint when declared), rolls back to the
// prior version when verification fails, and blocks frozen packages via the
// supply-chain freeze gate. Every terminal outcome is recorded as a
// hasna.rollout_record.v1 document and emitted through the open-events
// envelope.

export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type ExecFn = (command: string, args: string[]) => ExecResult;

export function defaultExec(command: string, args: string[]): ExecResult {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 120_000 });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export interface InstalledPackage {
  name: string;
  version: string;
}

/** Parse `bun pm ls -g` output lines like `├── @hasna/todos@0.1.2`. */
export function parseBunGlobalList(output: string): InstalledPackage[] {
  const installed: InstalledPackage[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/[├└]─+\s*(.+)@([^@\s]+)\s*$/);
    if (!match) continue;
    const name = match[1]!.trim();
    if (!name) continue;
    installed.push({ name, version: match[2]! });
  }
  return installed;
}

export function getInstalledGlobalPackages(exec: ExecFn = defaultExec): { installed: InstalledPackage[]; warnings: string[] } {
  const result = exec("bun", ["pm", "ls", "-g"]);
  if (result.status !== 0) {
    return { installed: [], warnings: [`bun_global_list_failed:${(result.stderr || "unknown").trim().split(/\r?\n/)[0]}`] };
  }
  return { installed: parseBunGlobalList(result.stdout), warnings: [] };
}

export function readInstalledSnapshot(path: string): InstalledPackage[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("installed snapshot must be a JSON array of { name, version }");
  return raw.map((entry) => {
    const item = entry as { name?: unknown; version?: unknown };
    if (typeof item.name !== "string" || typeof item.version !== "string") {
      throw new Error("installed snapshot entries require string name and version");
    }
    return { name: item.name, version: item.version };
  });
}

export interface DesiredPackage {
  name: string;
  version?: string;
  appId: string;
  bin: string;
  mcpHealthUrl?: string;
}

export function defaultBinForPackage(packageName: string): string {
  return packageName.includes("/") ? packageName.split("/").at(-1)! : packageName;
}

function toDesired(spec: ManifestPackageSpec): DesiredPackage {
  return {
    name: spec.name,
    version: spec.version,
    appId: spec.appId ?? defaultAppIdForPackage(spec.name),
    bin: spec.bin ?? defaultBinForPackage(spec.name),
    mcpHealthUrl: spec.mcpHealthUrl,
  };
}

function isBunManaged(spec: ManifestPackageSpec): boolean {
  return spec.manager === undefined || spec.manager === "bun";
}

/** Fleet-wide packages plus per-machine overrides (machine wins by name); bun-managed only. */
export function resolveDesiredPackages(manifest: FleetManifest, machineId: string): DesiredPackage[] {
  const merged = new Map<string, ManifestPackageSpec>();
  for (const spec of manifest.packages ?? []) {
    if (isBunManaged(spec)) merged.set(spec.name, spec);
  }
  const machine = manifest.machines.find((entry) => entry.id === machineId);
  for (const spec of machine?.packages ?? []) {
    if (isBunManaged(spec)) merged.set(spec.name, { ...merged.get(spec.name), ...spec });
  }
  return [...merged.values()].map(toDesired).sort((left, right) => left.name.localeCompare(right.name));
}

export type ReconcileActionKind = "install" | "update" | "skip" | "freeze-blocked";

export interface ReconcilePlanAction {
  package: string;
  appId: string;
  bin: string;
  mcpHealthUrl?: string;
  action: ReconcileActionKind;
  desiredVersion: string | null;
  installedVersion: string | null;
  reason: string;
}

export interface ReconcilePlan {
  machineId: string;
  generatedAt: string;
  actions: ReconcilePlanAction[];
  warnings: string[];
}

export interface BuildReconcilePlanOptions {
  manifest?: FleetManifest;
  manifestPath?: string;
  machineId?: string;
  installed?: InstalledPackage[];
  freezes?: FreezeEntry[];
  freezePath?: string;
  packageFilter?: string;
  /** Versions announced by release.published events; used when the manifest tracks the package without a pin. */
  eventVersions?: Record<string, string>;
  exec?: ExecFn;
  now?: Date;
}

export function buildReconcilePlan(options: BuildReconcilePlanOptions = {}): ReconcilePlan {
  const now = options.now ?? new Date();
  const machineId = options.machineId?.trim() || process.env["HASNA_MACHINES_MACHINE_ID"] || "local";
  const manifest = options.manifest ?? readManifest(options.manifestPath ?? getManifestPath());
  const warnings: string[] = [];

  let installed = options.installed;
  if (!installed) {
    const listed = getInstalledGlobalPackages(options.exec ?? defaultExec);
    installed = listed.installed;
    warnings.push(...listed.warnings);
  }
  const installedByName = new Map(installed.map((entry) => [entry.name, entry.version]));

  const freezes = options.freezes ?? listActiveFreezes({
    freezePath: options.freezePath,
    manifestPath: options.manifestPath,
    entries: options.manifest ? [...(options.manifest.freeze ?? [])] : undefined,
    now,
  });

  const desired = resolveDesiredPackages(manifest, machineId)
    .filter((spec) => !options.packageFilter || spec.name === options.packageFilter);

  const actions: ReconcilePlanAction[] = desired.map((spec) => {
    const installedVersion = installedByName.get(spec.name) ?? null;
    const target = spec.version ?? options.eventVersions?.[spec.name] ?? null;
    const base = {
      package: spec.name,
      appId: spec.appId,
      bin: spec.bin,
      mcpHealthUrl: spec.mcpHealthUrl,
      desiredVersion: target,
      installedVersion,
    };
    if (!target) {
      return { ...base, action: "skip" as const, reason: "unpinned: no manifest version and no release.published version" };
    }
    if (installedVersion === target) {
      return { ...base, action: "skip" as const, reason: "up-to-date" };
    }
    const freeze = findFreeze(spec.name, freezes, now);
    if (freeze) {
      return {
        ...base,
        action: "freeze-blocked" as const,
        reason: `frozen: ${freeze.reason ?? "supply-chain freeze"}`,
      };
    }
    if (!installedVersion) {
      return { ...base, action: "install" as const, reason: `not installed; want ${target}` };
    }
    return { ...base, action: "update" as const, reason: `installed ${installedVersion}; want ${target}` };
  });

  return {
    machineId,
    generatedAt: now.toISOString(),
    actions,
    warnings,
  };
}

export type RolloutEventSeverity = "debug" | "info" | "notice" | "warning" | "error" | "critical";

export interface RolloutEmitInput {
  source: string;
  type: string;
  subject?: string;
  severity?: RolloutEventSeverity;
  message?: string;
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface RolloutEmitter {
  emit(input: RolloutEmitInput, options?: { deliver?: boolean }): Promise<unknown> | unknown;
}

export type McpHealth = NonNullable<RolloutVerification["mcpHealth"]>;

export async function defaultMcpHealthCheck(url: string): Promise<McpHealth> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    return response.ok ? "ok" : "degraded";
  } catch {
    return "unavailable";
  }
}

export interface ExecuteReconcileOptions {
  dryRun?: boolean;
  exec?: ExecFn;
  emitter?: RolloutEmitter | null;
  deliver?: boolean;
  /** Where terminal rollout records are appended as JSONL; null disables persistence. */
  recordsPath?: string | null;
  healthCheck?: (url: string) => Promise<McpHealth>;
  now?: () => Date;
}

export interface ReconcileActionResult extends ReconcilePlanAction {
  status: RolloutResult;
  error?: string;
  verifiedBy?: RolloutVerification;
  rolledBackTo?: string | null;
}

export interface ReconcileResult {
  machineId: string;
  mode: "dry-run" | "apply";
  plan: ReconcilePlan;
  results: ReconcileActionResult[];
  records: RolloutRecordDoc[];
  emitted: number;
  warnings: string[];
}

export function appendRolloutRecord(record: RolloutRecordDoc, path = getRolloutRecordsPath()): string {
  ensureParentDir(path);
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8");
  return path;
}

export function readRolloutRecords(path = getRolloutRecordsPath()): RolloutRecordDoc[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RolloutRecordDoc);
}

function versionFromOutput(output: string): string | null {
  const firstLine = output.split(/\r?\n/).find((line) => line.trim());
  const match = firstLine?.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/);
  return match?.[0] ?? null;
}

interface VerifyOutcome {
  ok: boolean;
  verifiedBy: RolloutVerification;
  error?: string;
}

async function verifyInstalledPackage(
  action: ReconcilePlanAction,
  targetVersion: string,
  exec: ExecFn,
  healthCheck: (url: string) => Promise<McpHealth>,
): Promise<VerifyOutcome> {
  const versionResult = exec(action.bin, ["--version"]);
  const cliVersion = versionResult.status === 0 ? versionFromOutput(versionResult.stdout) : null;
  const verifiedBy: RolloutVerification = {
    cliVersion: cliVersion ?? undefined,
    mcpHealth: "not_checked",
  };
  if (versionResult.status !== 0) {
    return { ok: false, verifiedBy, error: `verify failed: ${action.bin} --version exited ${versionResult.status}` };
  }
  if (cliVersion !== targetVersion) {
    return {
      ok: false,
      verifiedBy,
      error: `verify failed: ${action.bin} --version reported ${cliVersion ?? "no version"}, expected ${targetVersion}`,
    };
  }
  if (action.mcpHealthUrl) {
    verifiedBy.mcpHealth = await healthCheck(action.mcpHealthUrl);
    if (verifiedBy.mcpHealth === "unavailable") {
      return { ok: false, verifiedBy, error: `verify failed: MCP health unavailable at declared endpoint` };
    }
  }
  return { ok: true, verifiedBy };
}

interface EmitContext {
  emitter: RolloutEmitter | null;
  deliver: boolean;
  emitted: { count: number };
}

async function emitRolloutEvent(context: EmitContext, type: string, record: RolloutRecordDoc, message: string): Promise<void> {
  if (!context.emitter) return;
  await context.emitter.emit({
    source: "machines",
    type,
    subject: `${record.package}@${record.version}`,
    severity: record.result === "failed" || record.result === "blocked" ? "warning" : "info",
    message,
    data: rolloutRecordToEventData(record) as unknown as Record<string, unknown>,
    metadata: { contractSchema: record.schema, recordId: record.id, machine: record.machine },
  }, { deliver: context.deliver });
  context.emitted.count += 1;
}

export async function executeReconcilePlan(plan: ReconcilePlan, options: ExecuteReconcileOptions = {}): Promise<ReconcileResult> {
  const dryRun = options.dryRun !== false;
  const warnings = [...plan.warnings];

  if (dryRun) {
    return {
      machineId: plan.machineId,
      mode: "dry-run",
      plan,
      results: plan.actions.map((action) => ({
        ...action,
        status: action.action === "skip" ? "skipped" : action.action === "freeze-blocked" ? "blocked" : "pending",
      })),
      records: [],
      emitted: 0,
      warnings,
    };
  }

  const exec = options.exec ?? defaultExec;
  const healthCheck = options.healthCheck ?? defaultMcpHealthCheck;
  const now = options.now ?? (() => new Date());
  const recordsPath = options.recordsPath === null ? null : options.recordsPath ?? getRolloutRecordsPath();
  const context: EmitContext = {
    emitter: options.emitter ?? null,
    deliver: options.deliver ?? false,
    emitted: { count: 0 },
  };
  const results: ReconcileActionResult[] = [];
  const records: RolloutRecordDoc[] = [];

  const keepRecord = (record: RolloutRecordDoc): RolloutRecordDoc => {
    records.push(record);
    if (recordsPath) appendRolloutRecord(record, recordsPath);
    return record;
  };

  for (const action of plan.actions) {
    if (action.action === "skip") {
      results.push({ ...action, status: "skipped" });
      continue;
    }

    if (action.action === "freeze-blocked") {
      const record = keepRecord(buildRolloutRecord({
        appId: action.appId,
        package: action.package,
        version: action.desiredVersion ?? action.installedVersion ?? "0.0.0",
        machine: plan.machineId,
        action: "freeze-blocked",
        result: "blocked",
        at: now().toISOString(),
      }));
      await emitRolloutEvent(context, DISTRIBUTION_EVENT_TYPES.rolloutFailed, record, `Rollout blocked by freeze gate: ${action.package} (${action.reason})`);
      results.push({ ...action, status: "blocked", error: action.reason });
      continue;
    }

    const targetVersion = action.desiredVersion!;
    const startedRecord = buildRolloutRecord({
      appId: action.appId,
      package: action.package,
      version: targetVersion,
      machine: plan.machineId,
      action: action.action,
      result: "running",
      at: now().toISOString(),
    });
    await emitRolloutEvent(context, DISTRIBUTION_EVENT_TYPES.rolloutStarted, startedRecord, `Rollout started: ${action.action} ${action.package}@${targetVersion}`);

    const install = exec("bun", ["install", "-g", `${action.package}@${targetVersion}`]);
    if (install.status !== 0) {
      const error = `bun install -g exited ${install.status}: ${(install.stderr || install.stdout).trim().split(/\r?\n/)[0] ?? ""}`;
      const record = keepRecord(buildRolloutRecord({
        appId: action.appId,
        package: action.package,
        version: targetVersion,
        machine: plan.machineId,
        action: action.action,
        result: "failed",
        at: now().toISOString(),
      }));
      await emitRolloutEvent(context, DISTRIBUTION_EVENT_TYPES.rolloutFailed, record, `Rollout failed: ${action.action} ${action.package}@${targetVersion}`);
      results.push({ ...action, status: "failed", error });
      continue;
    }

    const verify = await verifyInstalledPackage(action, targetVersion, exec, healthCheck);
    if (verify.ok) {
      const record = keepRecord(buildRolloutRecord({
        appId: action.appId,
        package: action.package,
        version: targetVersion,
        machine: plan.machineId,
        action: action.action,
        result: "succeeded",
        verifiedBy: verify.verifiedBy,
        at: now().toISOString(),
      }));
      await emitRolloutEvent(context, DISTRIBUTION_EVENT_TYPES.rolloutCompleted, record, `Rollout completed: ${action.action} ${action.package}@${targetVersion}`);
      if (action.action === "install") {
        await emitRolloutEvent(context, DISTRIBUTION_EVENT_TYPES.appInstalled, record, `App installed: ${action.package}@${targetVersion}`);
      }
      results.push({ ...action, status: "succeeded", verifiedBy: verify.verifiedBy });
      continue;
    }

    // Verification failed: record the failure, then roll back to the prior version when one exists.
    const failedRecord = keepRecord(buildRolloutRecord({
      appId: action.appId,
      package: action.package,
      version: targetVersion,
      machine: plan.machineId,
      action: action.action,
      result: "failed",
      verifiedBy: verify.verifiedBy,
      at: now().toISOString(),
    }));
    await emitRolloutEvent(context, DISTRIBUTION_EVENT_TYPES.rolloutFailed, failedRecord, `Rollout verification failed: ${action.package}@${targetVersion}`);

    let rolledBackTo: string | null = null;
    if (action.installedVersion) {
      const rollback = exec("bun", ["install", "-g", `${action.package}@${action.installedVersion}`]);
      const rollbackOk = rollback.status === 0;
      rolledBackTo = rollbackOk ? action.installedVersion : null;
      const rollbackRecord = keepRecord(buildRolloutRecord({
        appId: action.appId,
        package: action.package,
        version: action.installedVersion,
        machine: plan.machineId,
        action: "rollback",
        result: rollbackOk ? "succeeded" : "failed",
        at: now().toISOString(),
      }));
      await emitRolloutEvent(
        context,
        rollbackOk ? DISTRIBUTION_EVENT_TYPES.rolloutCompleted : DISTRIBUTION_EVENT_TYPES.rolloutFailed,
        rollbackRecord,
        `Rollback ${rollbackOk ? "completed" : "failed"}: ${action.package}@${action.installedVersion}`,
      );
      if (!rollbackOk) warnings.push(`rollback_failed:${action.package}`);
    } else {
      warnings.push(`rollback_unavailable:${action.package}`);
    }

    results.push({ ...action, status: "failed", error: verify.error, verifiedBy: verify.verifiedBy, rolledBackTo });
  }

  return {
    machineId: plan.machineId,
    mode: "apply",
    plan,
    results,
    records,
    emitted: context.emitted.count,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// release.published event trigger
// ---------------------------------------------------------------------------

export interface ReleaseEventEnvelope {
  id?: string;
  type: string;
  source?: string;
  data?: Record<string, unknown>;
}

export interface ReleaseEventTrigger {
  packageFilter: string;
  eventVersions: Record<string, string>;
}

/**
 * Extract a reconcile trigger from a `release.published` event envelope.
 * Returns null when the event is not a release.published event or the payload
 * is missing the required package/version fields.
 */
export function releaseEventTrigger(event: ReleaseEventEnvelope): ReleaseEventTrigger | null {
  if (event.type !== DISTRIBUTION_EVENT_TYPES.releasePublished) return null;
  const packageName = typeof event.data?.["package"] === "string" ? event.data["package"] as string : null;
  const version = typeof event.data?.["version"] === "string" ? event.data["version"] as string : null;
  if (!packageName || !version) return null;
  return {
    packageFilter: packageName,
    eventVersions: { [packageName]: version },
  };
}

export interface ReconcileFromEventOptions extends Omit<BuildReconcilePlanOptions, "now">, ExecuteReconcileOptions {}

/**
 * Reconcile in response to a `release.published` event. The manifest stays the
 * source of truth: pinned versions win, and unpinned tracked packages adopt
 * the event's version. Returns null for non-release.published events.
 */
export async function reconcileFromReleaseEvent(
  event: ReleaseEventEnvelope,
  options: ReconcileFromEventOptions = {},
): Promise<ReconcileResult | null> {
  const trigger = releaseEventTrigger(event);
  if (!trigger) return null;
  const { now, ...planOptions } = options;
  const plan = buildReconcilePlan({
    ...planOptions,
    now: now?.(),
    packageFilter: trigger.packageFilter,
    eventVersions: { ...trigger.eventVersions, ...options.eventVersions },
  });
  return executeReconcilePlan(plan, options);
}
