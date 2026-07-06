import { resolveStorageMode, type StorageMode } from "../config.js";
import { APP_VERSION } from "../version.js";

/**
 * System health payload in the contract shape { status, version, mode }
 * (BUILD-SPEC §6.2). Mandated shape — do not add fields (health_shape
 * conformance).
 */
export interface Health {
  status: "ok" | "degraded" | "unavailable";
  version: string;
  mode: StorageMode;
}

export function health(): Health {
  return { status: "ok", version: APP_VERSION, mode: resolveStorageMode() };
}
