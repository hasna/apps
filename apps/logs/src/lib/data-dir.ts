/**
 * @hasna/logs — on-box data directory resolution.
 * Copyright 2026 Hasna Inc.
 * Licensed under the Apache License, Version 2.0
 *
 * ONE resolver for where the local store lives (`logs.db`, the raw event
 * segments, `agent-registry.db`), read FRESH per call so a test or an operator
 * that moves the root after module load is honoured:
 *
 *   HASNA_LOGS_DATA_DIR (alias LOGS_DATA_DIR)      explicit, wins
 *   $HASNA_HOME/logs                               HASNA_HOME REPLACES `~/.hasna`
 *   $HOME/.hasna/logs                              the default
 *
 * `HASNA_HOME` follows the @hasna/contracts credential chain exactly
 * (hasna/apps#1720 acceptance): the resolver relocates
 * `~/.hasna/logs/config/credentials` under it, so the data beside that config
 * moves with it — an absolute, non-blank value counts; anything else is unset.
 * The env object is read by identity and never copied.
 */
import { isAbsolute, join } from "node:path";

/** The env names that name the data directory explicitly, canonical first. */
export const LOGS_DATA_DIR_ENV_KEYS = ["HASNA_LOGS_DATA_DIR", "LOGS_DATA_DIR"] as const;

/** `HASNA_HOME` replaces the `~/.hasna` root for every app at once. */
export const HASNA_HOME_ENV_KEY = "HASNA_HOME";

function firstNonBlank(env: NodeJS.ProcessEnv, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return null;
}

/** The `~/.hasna` root: `HASNA_HOME` (absolute, non-blank), else `$HOME/.hasna`. */
export function resolveHasnaHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[HASNA_HOME_ENV_KEY]?.trim();
  if (override && isAbsolute(override)) return override;
  return join(env.HOME?.trim() || "~", ".hasna");
}

/** True when an explicit data-dir env (HASNA_LOGS_DATA_DIR / LOGS_DATA_DIR) is set. */
export function hasExplicitLogsDataDir(env: NodeJS.ProcessEnv = process.env): boolean {
  return firstNonBlank(env, LOGS_DATA_DIR_ENV_KEYS) !== null;
}

/** The on-box data directory, resolved fresh from `env` on every call. */
export function resolveLogsDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return firstNonBlank(env, LOGS_DATA_DIR_ENV_KEYS) ?? join(resolveHasnaHome(env), "logs");
}
