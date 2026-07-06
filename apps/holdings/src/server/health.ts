import type { Database } from "bun:sqlite";
import { resolveStorageMode, type StorageMode } from "../config.js";
import { APP_VERSION } from "../version.js";

// System endpoint payloads (§6.2). The { status, version, mode } shape is
// contract-mandated (health_shape conformance) and must not change.

export interface HealthPayload {
  status: "ok" | "degraded" | "unavailable";
  version: string;
  mode: StorageMode;
}

export function healthPayload(mode: StorageMode = resolveStorageMode()): HealthPayload {
  return { status: "ok", version: APP_VERSION, mode };
}

export function versionPayload(mode: StorageMode = resolveStorageMode()): HealthPayload {
  return { status: "ok", version: APP_VERSION, mode };
}

export interface ReadyResult {
  ready: boolean;
  payload: { status: "ready" | "unavailable" };
}

/** Ready once the DB connection + migrations ledger are confirmed. */
export function readyResult(db: Database): ReadyResult {
  try {
    const row = db.query<{ id: number }, []>("SELECT MAX(id) AS id FROM schema_migrations").get();
    const ready = Boolean(row && row.id && row.id >= 1);
    return { ready, payload: { status: ready ? "ready" : "unavailable" } };
  } catch {
    return { ready: false, payload: { status: "unavailable" } };
  }
}
