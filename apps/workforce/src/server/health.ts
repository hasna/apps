import { resolveStorageMode, type StorageMode } from "../config.js";
import { getDatabase } from "../db/database.js";
import { APP_VERSION } from "../version.js";

// System endpoints (§6.2). Shape is contract-mandated: { status, version, mode }.

export interface HealthPayload {
  status: "ok";
  version: string;
  mode: StorageMode;
}

export function healthPayload(): HealthPayload {
  return { status: "ok", version: APP_VERSION, mode: safeMode() };
}

export function versionPayload(): HealthPayload {
  return healthPayload();
}

export interface ReadyPayload {
  status: "ready" | "unavailable";
  version: string;
  mode: StorageMode;
  detail?: string;
}

/** Ready once the DB connection + migrations are confirmed. */
export function readyPayload(): { payload: ReadyPayload; status: number } {
  const mode = safeMode();
  try {
    const db = getDatabase();
    const row = db.query("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number } | null;
    if (!row) throw new Error("schema_migrations ledger missing");
    return { payload: { status: "ready", version: APP_VERSION, mode }, status: 200 };
  } catch (error) {
    return {
      payload: { status: "unavailable", version: APP_VERSION, mode, detail: error instanceof Error ? error.message : String(error) },
      status: 503,
    };
  }
}

function safeMode(): StorageMode {
  try {
    return resolveStorageMode();
  } catch {
    return "local";
  }
}
