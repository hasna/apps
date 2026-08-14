import { resolveStorageMode } from "../config.js";
import { openStore } from "../db/database.js";
import { APP_VERSION } from "../version.js";

// System endpoints in the contract-mandated { status, version, mode } shape.

export function healthPayload(): { status: "ok"; version: string; mode: "local" | "cloud" } {
  return { status: "ok", version: APP_VERSION, mode: resolveStorageMode() };
}

export function versionPayload(): { status: "ok"; version: string; mode: "local" | "cloud" } {
  return healthPayload();
}

/** Readiness: DB reachable + migrations applied. */
export async function readyPayload(): Promise<{ ready: boolean; status: string }> {
  try {
    const store = await openStore();
    try {
      const reachable = await store.ping();
      const migrations = await store.migrationsApplied();
      const ready = reachable && migrations > 0;
      return { ready, status: ready ? "ready" : "not-ready" };
    } finally {
      await store.close();
    }
  } catch {
    return { ready: false, status: "not-ready" };
  }
}
