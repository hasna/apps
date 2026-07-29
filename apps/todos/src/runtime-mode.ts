export const TODOS_MODE_ENV = "HASNA_TODOS_MODE" as const;

export type TodosMode = "local" | "cloud";

/** Resolve the single supported runtime selector. Absence means local. */
export function getTodosMode(env: Record<string, string | undefined> = process.env): TodosMode {
  const value = env[TODOS_MODE_ENV]?.trim();
  if (value === undefined || value === "") return "local";
  if (value === "local" || value === "cloud") return value;
  throw new Error(`${TODOS_MODE_ENV} must be exactly "local" or "cloud"`);
}

export interface TodosCloudEnvironment {
  apiUrl: string;
  apiKey: string;
}

export function getTodosCloudEnvironment(
  env: Record<string, string | undefined> = process.env,
): TodosCloudEnvironment {
  const apiUrl = env.HASNA_TODOS_API_URL?.trim();
  const apiKey = env.HASNA_TODOS_API_KEY?.trim();
  if (!apiUrl) throw new Error("HASNA_TODOS_API_URL is required in cloud mode");
  if (!apiKey) throw new Error("HASNA_TODOS_API_KEY is required in cloud mode");

  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new Error("HASNA_TODOS_API_URL must be an absolute HTTP(S) URL");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopback(parsed.hostname))) {
    throw new Error("HASNA_TODOS_API_URL must use HTTPS (HTTP is allowed only on loopback)");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("HASNA_TODOS_API_URL must not contain credentials, a query, or a fragment");
  }
  if (parsed.pathname !== "/" && parsed.pathname !== "/v1" && parsed.pathname !== "/v1/") {
    throw new Error("HASNA_TODOS_API_URL must be an authority root or end in /v1");
  }

  return { apiUrl: parsed.origin, apiKey };
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}
