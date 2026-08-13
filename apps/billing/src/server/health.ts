import { resolveStorageBackend, type StorageBackend } from "../config.js";
import { APP_VERSION } from "../version.js";

/**
 * System health payload in the contract shape { status, version, backend }.
 */
export interface Health {
  status: "ok" | "degraded" | "unavailable";
  version: string;
  backend: StorageBackend;
}

export function health(): Health {
  return { status: "ok", version: APP_VERSION, backend: resolveStorageBackend() };
}
