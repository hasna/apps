import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The Keychain account every hermetic fixture pins.
 *
 * The shared @hasna/contracts chain consults the macOS Keychain item
 * `hasna.credentials.conversations.api-key` for the account named by
 * HASNA_STATION (else `hostname -s`, else USER) ABOVE the env tier, and the
 * matching `api-url` item can override — or contradict — a URL the test set.
 * On a fleet workstation both items exist, so a fixture that only clears the
 * env still resolves the operator's real credential and fails on the
 * disagreement. No real item uses this account, so with it pinned the machine's
 * Keychain can never answer for a test (hasna/apps#1720 validation).
 */
export const HERMETIC_STATION = "conversations-hermetic-no-such-station";

export const AMBIENT_TEST_ENV_KEYS = [
  "HASNA_CONVERSATIONS_API_URL",
  "CONVERSATIONS_API_URL",
  "HASNA_CONVERSATIONS_API_KEY",
  "CONVERSATIONS_API_KEY",
  "HASNA_CONVERSATIONS_DB_PATH",
  "CONVERSATIONS_DB_PATH",
  "HASNA_CONVERSATIONS_AGENT_ID",
  "CONVERSATIONS_AGENT_ID",
  "HASNA_CONVERSATIONS_PROJECT_ID",
  "CONVERSATIONS_PROJECT_ID",
  "CONVERSATIONS_SESSION_ID",
  "HASNA_CONVERSATIONS_API_SIGNING_KEY",
  "HASNA_API_SIGNING_KEY",
  "API_KEY_SIGNING_SECRET",
  "HASNA_STATION",
  "PGHOST",
  "PGPORT",
  "PGDATABASE",
  "PGUSER",
  "PGPASSWORD",
  "DATABASE_URL",
  "BASH_ENV",
  "ENV",
  "NODE_OPTIONS",
  "BUN_OPTIONS",
  "BUN_CONFIG_DOTENV",
  "DOTENV_CONFIG_PATH",
  "DOTENV_CONFIG_ENCODING",
  "DOTENV_CONFIG_QUIET",
  "DOTENV_KEY",
  "CONVERSATIONS_DASHBOARD_HOST",
  "CONVERSATIONS_DASHBOARD_PORT",
  "CONVERSATIONS_REGISTRY_TIMEOUT_MS",
  "CONVERSATIONS_LOCAL_READ_WORKER",
  "HASNA_CONVERSATIONS_EXPORT_DIR",
  "CONVERSATIONS_EXPORT_DIR",
] as const;

export function enterHermeticTestEnv(overrides: Record<string, string> = {}): () => void {
  const snapshot = new Map(AMBIENT_TEST_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of AMBIENT_TEST_ENV_KEYS) delete process.env[key];
  // Pinned by default so the station Keychain stays outside the fixture; an
  // override may still name a station of its own.
  Object.assign(process.env, { HASNA_STATION: HERMETIC_STATION }, overrides);
  return () => {
    for (const key of AMBIENT_TEST_ENV_KEYS) {
      const value = snapshot.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

export function createDisposableStore(label: string): { dbPath: string; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), `conversations-${label}-`));
  return {
    dbPath: join(directory, "store.db"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

export function installNetworkGuard(options: { allowLoopback?: boolean } = {}): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input);
    const url = new URL(raw);
    const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
    if (!options.allowLoopback || !loopback) {
      throw new Error(`Hermetic test blocked non-loopback network request to ${url.origin}`);
    }
    return original(input as RequestInfo | URL, init);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

export function hermeticSpawnEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "TMPDIR", "LANG", "LC_ALL"] as const) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return { ...env, HASNA_STATION: HERMETIC_STATION, ...overrides };
}
