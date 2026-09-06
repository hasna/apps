import { randomBytes } from "node:crypto";
import { mkdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { SwitcherClient, clientFromEnv } from "./sdk";
import { startServer } from "./server";
import { Fault } from "./domain";
import type { CatalogCredentialResolver } from "./catalog";

export function switcherHome(env: NodeJS.ProcessEnv = process.env) {
  return resolve(env.HASNA_SWITCHER_HOME ?? join(homedir(), ".hasna", "switcher"));
}

export async function privateDirectory(path: string) {
  await mkdir(path, {recursive: true, mode: 0o700});
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Fault(500, "home_permissions", "Switcher data directory must be a real directory.");
  if (process.platform !== "win32" && ((info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()))
    throw new Fault(500, "home_permissions", "Switcher data directory must be owned by this user and accessible only to its owner (mode 0700).");
}

/** Data access always uses HTTP, including the per-command owned local service. */
export async function openCliRuntime(env: NodeJS.ProcessEnv = process.env, resolveCredential?: CatalogCredentialResolver) {
  const providerEnv = Object.fromEntries(Object.entries(env).filter(([name]) => name.startsWith("SWITCHER_PROVIDER_")));
  // A partial or unavailable remote configuration is an error, never a local fallback.
  if (Object.hasOwn(env, "HASNA_SWITCHER_API_URL") || Object.hasOwn(env, "HASNA_SWITCHER_API_KEY")) {
    return {client: clientFromEnv(env), mode: "remote" as const, providerEnv, close: async () => {}};
  }
  const home = switcherHome(env);
  if (!env.HASNA_SWITCHER_DATABASE_URL && !env.HASNA_SWITCHER_SQLITE_PATH) await privateDirectory(home);
  const apiKey = randomBytes(32).toString("base64url");
  const service = await startServer({apiKey, databaseUrl: env.HASNA_SWITCHER_DATABASE_URL,
    sqlitePath: env.HASNA_SWITCHER_SQLITE_PATH ?? (env.HASNA_SWITCHER_DATABASE_URL ? undefined : join(home, "switcher.db")), providerEnv, resolveCredential});
  return {client: new SwitcherClient({baseUrl: service.url, apiKey}), mode: "local" as const, providerEnv, close: service.close};
}
