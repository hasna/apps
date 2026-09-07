import { randomBytes } from "node:crypto";
import { mkdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { SwitcherClient, clientFromEnv } from "./sdk";
import { startServer } from "./server";
import { Fault } from "./domain";
import type { CatalogCredentialResolver } from "./catalog";
import { resolveCredential as resolveClientCredential, clientTransportEnvKeys, appConfigDiskValue, keychainConfigValue } from "@hasna/contracts/client";

export function switcherHome(env: NodeJS.ProcessEnv = process.env) {
  const override = env.HASNA_HOME?.trim();
  const root = override && isAbsolute(override) ? override : join(env.HOME?.trim() || homedir(), ".hasna");
  return resolve(env.HASNA_SWITCHER_HOME ?? join(root, "switcher"));
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
  // Only complete absence of remote configuration selects the owned local API.
  // Let Contracts detect invalid sources; no resolver error becomes local data.
  const keys = clientTransportEnvKeys("switcher");
  const credential = resolveClientCredential("switcher",env);
  const configured = credential || keys.apiUrlKeys.some(name=>env[name] !== undefined)
    || keychainConfigValue("switcher",env) || appConfigDiskValue("switcher",env,keys.apiUrlKeys);
  if (configured) {
    return {client: clientFromEnv(env), mode: "remote" as const, providerEnv, close: async () => {}};
  }
  const home = switcherHome(env);
  if (!env.HASNA_SWITCHER_DATABASE_URL && !env.HASNA_SWITCHER_SQLITE_PATH) await privateDirectory(home);
  const apiKey = randomBytes(32).toString("base64url");
  const service = await startServer({apiKey, databaseUrl: env.HASNA_SWITCHER_DATABASE_URL,
    sqlitePath: env.HASNA_SWITCHER_SQLITE_PATH ?? (env.HASNA_SWITCHER_DATABASE_URL ? undefined : join(home, "switcher.db")), providerEnv, resolveCredential});
  return {client: new SwitcherClient({baseUrl: service.url, apiKey}), mode: "local" as const, providerEnv, close: service.close};
}
