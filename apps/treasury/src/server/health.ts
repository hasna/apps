import { APP_VERSION } from "../version.js";
import { resolveStorageMode } from "../config.js";
import { openDatabase } from "../db/database.js";

// System endpoint payloads (BUILD-SPEC §6.2). health_shape conformance locks
// the { status, version, mode } shape.

export function versionPayload(): { status: "ok"; version: string; mode: "local" | "cloud" } {
  return { status: "ok", version: APP_VERSION, mode: resolveStorageMode() };
}

export function healthPayload(): { status: "ok"; version: string; mode: "local" | "cloud" } {
  return { status: "ok", version: APP_VERSION, mode: resolveStorageMode() };
}

/**
 * Readiness probe. The response BODY matches BUILD-SPEC §6.2 exactly:
 * `{ status: "ready" }` with 200 on success, and a minimal `{ status: "unavailable" }`
 * with 503 on failure. `ok` is a transport-only discriminant for the HTTP status
 * code and is NOT part of the response body.
 */
export async function readyPayload(): Promise<{ ok: boolean; body: { status: "ready" | "unavailable" } }> {
  try {
    const db = await openDatabase();
    await db.get("SELECT 1 AS ok");
    return { ok: true, body: { status: "ready" } };
  } catch {
    return { ok: false, body: { status: "unavailable" } };
  }
}
