import { serverBackend, type ServerBackend } from "../config.js";
import { getDatabase } from "../db/database.js";
import { APP_VERSION } from "../version.js";

// System endpoints (§6.2). Shape is contract-mandated: { status, version, backend }.

export interface HealthPayload {
  status: "ok";
  version: string;
  backend: ServerBackend;
}

export function healthPayload(): HealthPayload {
  return { status: "ok", version: APP_VERSION, backend: safeBackend() };
}

export function versionPayload(): HealthPayload {
  return healthPayload();
}

export interface ReadyPayload {
  status: "ready" | "unavailable";
  version: string;
  backend: ServerBackend;
  detail?: string;
}

/** Ready once the DB connection + migrations are confirmed. */
export function readyPayload(): { payload: ReadyPayload; status: number } {
  const backend = safeBackend();
  try {
    const db = getDatabase();
    const row = db.query("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number } | null;
    if (!row) throw new Error("schema_migrations ledger missing");
    return { payload: { status: "ready", version: APP_VERSION, backend }, status: 200 };
  } catch (error) {
    return {
      payload: { status: "unavailable", version: APP_VERSION, backend, detail: error instanceof Error ? error.message : String(error) },
      status: 503,
    };
  }
}

function safeBackend(): ServerBackend {
  try {
    return serverBackend();
  } catch {
    return "sqlite";
  }
}
