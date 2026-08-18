import { resolveDataBackend } from "../config.js";
import { openStore } from "../db/database.js";
import { APP_VERSION } from "../version.js";

// System endpoints in the contract-mandated { status, version, backend } shape.

export function healthPayload(): { status: "ok"; version: string; backend: "sqlite" | "postgresql" } {
  return { status: "ok", version: APP_VERSION, backend: resolveDataBackend() };
}

export function versionPayload(): { status: "ok"; version: string; backend: "sqlite" | "postgresql" } {
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
