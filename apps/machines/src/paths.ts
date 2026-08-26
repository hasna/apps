import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function homeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || "~";
}

export function getDataDir(): string {
  return process.env["HASNA_MACHINES_DIR"] || join(homeDir(), ".hasna", "machines");
}

export function getDbPath(): string {
  return process.env["HASNA_MACHINES_DB_PATH"] || join(getDataDir(), "machines.db");
}

export function getManifestPath(): string {
  return process.env["HASNA_MACHINES_MANIFEST_PATH"] || join(getDataDir(), "machines.json");
}

/**
 * Resolve one exact manifest authority for candidate operations.
 * An explicit CLI path may not silently override a different environment path.
 */
export function resolveExactManifestPath(explicitPath?: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = explicitPath?.trim() ? resolve(explicitPath) : null;
  const configured = env["HASNA_MACHINES_MANIFEST_PATH"]?.trim()
    ? resolve(env["HASNA_MACHINES_MANIFEST_PATH"]!)
    : null;
  if (explicit && configured && explicit !== configured) {
    throw new Error("Explicit --manifest and HASNA_MACHINES_MANIFEST_PATH resolve to different files.");
  }
  return explicit ?? configured ?? resolve(getManifestPath());
}

export function getNotificationsPath(): string {
  return process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] || join(getDataDir(), "notifications.json");
}

export function getFreezePath(): string {
  return process.env["HASNA_MACHINES_FREEZE_PATH"] || join(getDataDir(), "freeze.json");
}

export function getRolloutRecordsPath(): string {
  return process.env["HASNA_MACHINES_ROLLOUT_RECORDS_PATH"] || join(getDataDir(), "rollout-records.jsonl");
}

export function getRosterConfigPath(): string {
  return process.env["HASNA_MACHINES_ROSTER_CONFIG_PATH"] || join(getDataDir(), "roster.json");
}

export function getRosterRecordsPath(): string {
  return process.env["HASNA_MACHINES_ROSTER_RECORDS_PATH"] || join(getDataDir(), "roster-records.jsonl");
}

export function getRosterHeartbeatPath(): string {
  return process.env["HASNA_MACHINES_ROSTER_HEARTBEAT_PATH"] || join(getDataDir(), "roster-heartbeat.json");
}

export function getClipboardKeyPath(): string {
  return process.env["HASNA_MACHINES_CLIPBOARD_KEY_PATH"] || join(getDataDir(), "clipboard.key");
}

export function getClipboardHistoryPath(): string {
  return process.env["HASNA_MACHINES_CLIPBOARD_HISTORY_PATH"] || join(getDataDir(), "clipboard-history.json");
}

export function ensureParentDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  ensureParentDir(join(dir, ".keep"));
  return dir;
}

/**
 * The per-run flip ledger (P1-C). JSONL, one entry per machine per flip run.
 * Every row is value-free: machine, app, ts, result, source-of-value, sha256,
 * provenance-gate verdict.
 */
export function getFlipLedgerPath(): string {
  return process.env["HASNA_MACHINES_FLIP_LEDGER_PATH"] || join(getDataDir(), "flip-ledger.jsonl");
}
