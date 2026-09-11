import { randomBytes } from "node:crypto";
import { mkdir, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { SwitcherClient, clientFromEnv } from "./sdk";
import { startServer } from "./server";
import { Fault } from "./domain";
import type { CatalogCredentialResolver } from "./catalog";
import { resolveCredential as resolveClientCredential, clientTransportEnvKeys, appConfigDiskValue, keychainConfigValue } from "@hasna/contracts/client";
import { announceSwitcherLocalMode, hasSwitcherEnvAuthorityIntent, isSwitcherLocalOptIn, remoteConfigMissingMessage } from "./lib/local-opt-in";

/** The refusal code when no Switcher API credential is configured and the local opt-in is not set. */
export const REMOTE_API_CONFIG_MISSING = "remote_api_config_missing";

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
  const remote = () => ({client: clientFromEnv(env), mode: "remote" as const, providerEnv, close: async () => {}});
  // 1. A configured environment outranks the local opt-in. Contracts refuses a
  //    half-configured or unsafe source loudly; no resolver error becomes local data.
  if (hasSwitcherEnvAuthorityIntent(env)) return remote();
  // 2. The deliberate opt-in is answered from the environment alone, before any
  //    Keychain or disk read.
  if (!isSwitcherLocalOptIn(env)) {
    // 3. Ambient tiers: the Keychain item and the canonical credentials file. A
    //    Keychain item that exists but cannot be read throws inside Contracts
    //    (terminal); complete absence fails closed here. Never a local default.
    const keys = clientTransportEnvKeys("switcher");
    const configured = resolveClientCredential("switcher",env) || keychainConfigValue("switcher",env) || appConfigDiskValue("switcher",env,keys.apiUrlKeys);
    if (configured) return remote();
    throw new Fault(401, REMOTE_API_CONFIG_MISSING, remoteConfigMissingMessage(env));
  }
  const home = switcherHome(env);
  announceSwitcherLocalMode(home);
  if (!env.HASNA_SWITCHER_DATABASE_URL && !env.HASNA_SWITCHER_SQLITE_PATH) await privateDirectory(home);
  const apiKey = randomBytes(32).toString("base64url");
  const service = await startServer({apiKey, databaseUrl: env.HASNA_SWITCHER_DATABASE_URL,
    sqlitePath: env.HASNA_SWITCHER_SQLITE_PATH ?? (env.HASNA_SWITCHER_DATABASE_URL ? undefined : join(home, "switcher.db")), providerEnv, resolveCredential});
  return {client: new SwitcherClient({baseUrl: service.url, apiKey}), mode: "local" as const, providerEnv, close: service.close};
}
