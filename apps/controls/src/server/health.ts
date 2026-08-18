import { serverBackend, type ServerBackend } from "../config.js";
import { getDatabase, migrationsApplied } from "../db/database.js";
import { APP_VERSION } from "../version.js";

export interface HealthPayload {
  status: "ok" | "degraded" | "unavailable";
  version: string;
  backend: ServerBackend;
}

/** GET /health and GET /version share this contract shape { status, version, backend }. */
export function healthPayload(): HealthPayload {
  return { status: "ok", version: APP_VERSION, backend: serverBackend() };
}

export interface ReadyPayload {
  status: "ready" | "unavailable";
  migrations_applied?: number;
}

/** GET /ready — confirms the DB connection + migrations are live. */
export function readyPayload(): { ready: boolean; body: ReadyPayload } {
  try {
    const db = getDatabase();
    const applied = migrationsApplied(db);
    return { ready: applied > 0, body: { status: applied > 0 ? "ready" : "unavailable", migrations_applied: applied } };
  } catch {
    return { ready: false, body: { status: "unavailable" } };
  }
}
