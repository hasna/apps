import { resolveServerBackend, type ServerDataBackend } from "../config.js";
import { APP_VERSION } from "../version.js";

/**
 * Health payload in the Hasna Service Contract v1 shape: { status, version, backend }.
 * GET /health and GET /version both return exactly this (health_shape conformance).
 */
export interface Health {
  status: "ok" | "degraded" | "unavailable";
  version: string;
  backend: ServerDataBackend;
}

export function health(): Health {
  return {
    status: "ok",
    version: APP_VERSION,
    backend: safeBackend(),
  };
}

function safeBackend(): ServerDataBackend {
  try {
    return resolveServerBackend();
  } catch {
    // A misconfig throws; report postgresql so /health still shapes.
    return "postgresql";
  }
}
