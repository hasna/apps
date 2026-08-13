import { APP_VERSION } from "../version.js";
import { getDatabase, getStorageMode } from "../db/database.js";

/** System endpoint payloads (§6.2). Shape is contract-mandated ({status,version,mode}). */

export function healthPayload(): { status: "ok"; version: string; mode: "local" | "cloud" } {
  return { status: "ok", version: APP_VERSION, mode: getStorageMode() };
}

export function versionPayload(): { status: "ok"; version: string; mode: "local" | "cloud" } {
  return { status: "ok", version: APP_VERSION, mode: getStorageMode() };
}

export function readyPayload(): { ready: boolean; status: string; reason?: string } {
  try {
    getDatabase().query("SELECT 1").get();
    return { ready: true, status: "ready" };
  } catch (error) {
    return { ready: false, status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
}
