import { resolveStorageMode, type StorageMode } from "../config.js";
import { APP_VERSION } from "../version.js";

/**
 * Health payload in the Hasna Service Contract v1 shape: { status, version, mode }.
 * GET /health and GET /version both return exactly this (health_shape conformance).
 */
export interface Health {
  status: "ok" | "degraded" | "unavailable";
  version: string;
  mode: StorageMode;
}

export function health(): Health {
  return {
    status: "ok",
    version: APP_VERSION,
    mode: safeMode(),
  };
}

function safeMode(): StorageMode {
  try {
    return resolveStorageMode();
  } catch {
    // A misconfig (DSN present + local) throws; report cloud so /health still shapes.
    return "cloud";
  }
}
