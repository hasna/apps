/**
 * The ONE gated door to the on-box SQLite store.
 *
 * Every client surface — the CLI, the MCP server, `./sdk`, the local serve
 * process — reaches the LocalStore through this module and nowhere else. It
 * does two things a static `import` cannot:
 *
 *  1. **It refuses unless the explicit opt-in actually selected local.** The
 *     gate is the same decision the transport resolver makes
 *     ({@link resolveTelephonyClientTransport}): `HASNA_TELEPHONY_LOCAL=1`
 *     (alias `TELEPHONY_LOCAL=1`) AND nothing at all resolving a credential or
 *     an authority. A configured environment outranks the flag, so under a
 *     hosted credential no code path can open SQLite — this throws one clear
 *     line instead. With nothing configured at all the resolver's own
 *     fail-closed error propagates unchanged (it names the Keychain item, the
 *     credentials file, the env variables and the opt-in).
 *
 *  2. **It keeps the SQLite engine out of the shipped client bins.** The
 *     module specifier is computed at RUNTIME, so `bun build` cannot follow it
 *     and `src/lib/store/local-store.ts` (the only module that reaches
 *     `bun:sqlite`) is never folded into `dist/cli/index.js` or
 *     `dist/mcp/index.js`. It is emitted once, as its own
 *     `dist/local/local-store.js` entry, and loaded from there.
 *
 * Nothing in this file's own import graph touches `bun:sqlite`.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  resolveTelephonyClientTransport,
  TELEPHONY_LOCAL_MODE_ENV,
} from "../client-transport.js";
import type { TelephonyStore } from "./index.js";

/** The public shape of `./local-store.ts`, declared rather than imported. */
interface LocalStoreModule {
  createSqliteLocalStore(): TelephonyStore;
}

/**
 * Where the on-box store module sits RELATIVE TO THIS FILE in each shape we
 * run in. Checked in order, by existence, so a wrong guess can never mask a
 * real load error inside the module itself:
 *
 *   `./local-store.ts`            — running from source (`bun run src/cli/index.ts`, `bun test`)
 *   `../local/local-store.js`     — this loader bundled into `dist/cli/index.js`,
 *                                   `dist/mcp/index.js` or `dist/server/index.js`
 *   `./local/local-store.js`      — this loader bundled into `dist/index.js` or `dist/sdk.js`
 */
const LOCAL_STORE_CANDIDATES = [
  "./local-store.ts",
  "../local/local-store.js",
  "./local/local-store.js",
] as const;

/** Resolve the emitted on-box store module next to whatever bundle we are in. */
function localStoreSpecifier(): string {
  const tried: string[] = [];
  for (const relative of LOCAL_STORE_CANDIDATES) {
    const url = new URL(relative, import.meta.url);
    if (url.protocol !== "file:") continue;
    const file = fileURLToPath(url);
    if (existsSync(file)) return url.href;
    tried.push(file);
  }
  throw new Error(
    `The on-box store module (local-store) is not installed next to this build; looked for ` +
      `${tried.join(", ")}. Reinstall @hasna/telephony, or run hosted — put the fleet key in the Keychain ` +
      `item hasna.credentials.telephony.api-key, ~/.hasna/telephony/config/credentials, or ` +
      `HASNA_TELEPHONY_API_KEY.`,
  );
}

/** The refusal a hosted run gets if it ever asks for the on-box store. */
function hostedRefusal(): Error {
  return new Error(
    `Refusing to open the on-box SQLite store: a Hasna credential resolved for this process, ` +
      `so every read and write goes to the telephony HTTP API. The local store is reachable only under ` +
      `${TELEPHONY_LOCAL_MODE_ENV}=1 (alias TELEPHONY_LOCAL=1) with no credential and no authority ` +
      `configured anywhere; a configured environment outranks the flag.`,
  );
}

/**
 * The module is imported at most once per process; the store instance is not
 * cached, because {@link getStore} resolves the transport fresh on every call
 * and callers may hold their own.
 */
let localStoreModule: Promise<LocalStoreModule> | null = null;

/** Test seam: forget the loaded module so a suite can re-exercise the gate. */
export function resetLocalStoreModule(): void {
  localStoreModule = null;
}

/**
 * Load the on-box SQLite store — the only way any client surface may reach it.
 *
 * Throws (and imports nothing) unless the explicit opt-in selected local mode
 * for this environment.
 */
export async function loadLocalStore(env: NodeJS.ProcessEnv = process.env): Promise<TelephonyStore> {
  // The resolver is the gate: it throws the actionable fail-closed error when
  // nothing is configured, and reports "http" whenever a credential resolved.
  // Only its "local" verdict opens the door below.
  const resolved = resolveTelephonyClientTransport(env);
  if (resolved.mode !== "local") throw hostedRefusal();
  localStoreModule ??= import(localStoreSpecifier()) as Promise<LocalStoreModule>;
  return (await localStoreModule).createSqliteLocalStore();
}
