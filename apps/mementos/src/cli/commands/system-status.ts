import type { Command } from "commander";

import { getPackageVersion } from "../helpers.js";
import { withoutStartupDbAccess } from "../startup-side-effects.js";

import {
  API_KEY_ENV_KEYS,
  API_URL_ENV_KEYS,
  DB_PATH_ENV_KEYS,
  getConfiguredApiEnv,
} from "../../db/api-mode.js";

/**
 * The uniform API/transport report (hasna/apps#1588).
 *
 * It is a pure read of the resolved configuration: it constructs no store and
 * opens no database, so it is safe to print even when the CLI is unconfigured
 * — which it reports as `unconfigured` rather than by silently implying a
 * local store. The shape mirrors `messages status` so the fleet's operator
 * surfaces stay diffable.
 */
export interface MementosApiStatus {
  app: "mementos";
  version: string;
  transport: "http" | "local" | "unconfigured";
  /** The resolved `/v1` authority, e.g. https://api.hasna.com/mementos/v1. */
  api_url: string | null;
  /**
   * The base URL exactly as configured, before `/v1` resolution — but only
   * once it has passed validation. A refused base is reported as `null`: it
   * is not a base, and the very reason it was refused may be that it carries
   * userinfo, which this report must never serialise (`--json` sweeps get
   * pasted into issues).
   */
  api_base: string | null;
  api_key_present: boolean;
}

function firstEnvValue(keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

/**
 * Resolve the report. A malformed `HASNA_MEMENTOS_API_URL` throws out of
 * {@link getConfiguredApiEnv} by design (it must fail closed rather than
 * resolve to a wrong-but-plausible endpoint), so `status` is the one surface
 * that catches it: an operator running `mementos status` to debug a broken
 * endpoint needs the reason, not a stack trace.
 */
export function resolveApiStatus(version: string = getPackageVersion()): { status: MementosApiStatus; error: string | null } {
  const apiBase = firstEnvValue(API_URL_ENV_KEYS);
  const apiKeyPresent = Boolean(firstEnvValue(API_KEY_ENV_KEYS));
  const localOptIn = Boolean(firstEnvValue(DB_PATH_ENV_KEYS));

  let apiUrl: string | null = null;
  let error: string | null = null;
  if (apiBase) {
    try {
      apiUrl = getConfiguredApiEnv().baseUrl;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // A refused base configures no HTTP transport and is never echoed: the
  // rejection reason may be userinfo, and the `--json` branch would otherwise
  // print the raw env value verbatim, password included.
  const validBase = error ? null : apiBase;

  let transport: MementosApiStatus["transport"];
  if (validBase && apiKeyPresent && !localOptIn) transport = "http";
  else if (localOptIn) transport = "local";
  else transport = "unconfigured";

  return {
    status: {
      app: "mementos",
      version,
      transport,
      api_url: apiUrl,
      api_base: validBase,
      api_key_present: apiKeyPresent,
    },
    error,
  };
}

export function registerStatusCommand(program: Command): void {
  // Opts out of the startup store guard for the same reason `storage mode`
  // does: this command's entire value is answering "which endpoint am I
  // pointed at?" from the environment alone, including — especially — when
  // the environment is not yet configured or not yet trusted. Inheriting the
  // fail-closed preAction hook would make the one command an operator runs to
  // diagnose a missing endpoint the one command that refuses to run without
  // it. It opens no database and constructs no store, so the opt-out is safe.
  withoutStartupDbAccess(
    program
      .command("status")
      .description("Show the resolved API authority, transport and key presence")
      .option("--json", "Output as JSON")
      .action((opts: { json?: boolean }) => {
        const useJson = Boolean(opts.json || program.opts().json);
        const { status, error } = resolveApiStatus();

        if (useJson) {
          console.log(JSON.stringify(error ? { ...status, error } : status, null, 2));
        } else {
          // The `API:` line is the fleet-uniform format from hasna/apps#1588:
          // the resolved /v1 authority, never a bare origin, never the raw base.
          console.log(`mementos ${status.version}`);
          console.log(`API: ${status.api_url ?? "(none)"}`);
          console.log(`transport: ${status.transport}`);
          console.log(`api key: ${status.api_key_present ? "present" : "absent"}`);
        }

        if (error) {
          console.error(`${API_URL_ENV_KEYS[0]} is not usable: ${error}`);
          process.exit(1);
        }
        if (status.transport === "unconfigured") {
          console.error(
            `${API_URL_ENV_KEYS[0]} and ${API_KEY_ENV_KEYS[0]} are not both set and no `
              + `${DB_PATH_ENV_KEYS[0]} was given; no transport is configured.`,
          );
          process.exit(1);
        }
      }),
  );
}
