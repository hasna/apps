/**
 * The conversations app home on a station: `~/.hasna/conversations`.
 *
 * This is the ONLY per-app home the fleet layout allows (hasna home-layout
 * ruling, 2026-09-04). Overrides, in order:
 *   1. `HASNA_CONVERSATIONS_HOME` — exact-app override (the documented
 *      `HASNA_<APP>_HOME` exception);
 *   2. `HASNA_HOME` — replaces the `~/.hasna` root (shared with the
 *      @hasna/contracts credential chain, which reads
 *      `<root>/conversations/config/credentials`);
 *   3. `$HOME/.hasna/conversations`.
 *
 * No XDG / Application Support branches, no legacy `~/.conversations` copy,
 * and nothing is created on read — callers that persist a file create the
 * directory they write into. The home holds identity/session bindings only;
 * conversation DATA lives behind the hosted API, never on the station.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const CONVERSATIONS_HOME_ENV_KEY = "HASNA_CONVERSATIONS_HOME";
export const HASNA_HOME_ENV_KEY = "HASNA_HOME";

type Env = Record<string, string | undefined>;

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The `~/.hasna` root: `HASNA_HOME`, else `$HOME/.hasna`. */
export function getHasnaRoot(env: Env = process.env): string {
  const override = nonBlank(env[HASNA_HOME_ENV_KEY]);
  if (override) return resolve(override);
  const home = nonBlank(env.HOME) ?? homedir();
  return join(home, ".hasna");
}

/** The conversations app home (see the module comment for the override order). */
export function getConversationsHome(env: Env = process.env): string {
  const exact = nonBlank(env[CONVERSATIONS_HOME_ENV_KEY]);
  if (exact) return resolve(exact);
  return join(getHasnaRoot(env), "conversations");
}
