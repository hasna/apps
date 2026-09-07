import type { Command } from "commander";

import { getPackageVersion } from "../helpers.js";
import { withoutStartupDbAccess } from "../startup-side-effects.js";

import {
  API_KEY_ENV_KEYS,
  API_URL_ENV_KEYS,
  DB_PATH_ENV_KEYS,
  getConfiguredApiEnv,
  getResolvedApiModeReport,
  type ResolvedApiModeReport,
} from "../../db/api-mode.js";
import {
  hasExplicitLocalDbPath,
  hasMementosEnvAuthorityIntent,
  isMementosLocalOptIn,
  MEMENTOS_LOCAL_OPT_IN_ENV_KEYS,
} from "../../lib/local-opt-in.js";

/**
 * The uniform API/transport report (hasna/apps#1588).
 *
 * It is a pure read of the resolved configuration: it constructs no store and
 * opens no database, so it is safe to print even when the CLI is unconfigured
 * — which it reports as `unconfigured` rather than by silently implying a
 * local store. The shape mirrors `messages status` so the fleet's operator
 * surfaces stay diffable.
 *
 * The transport is answered through the SAME @hasna/contracts chain the data
 * commands use (env key, macOS Keychain, `~/.hasna/mementos/config/credentials`
 * or the fleet gateway default), so what this prints is what a run would do.
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
 * Resolve the report. A malformed `HASNA_MEMENTOS_API_URL` throws out of the
 * resolver by design (it must fail closed rather than resolve to a
 * wrong-but-plausible endpoint), so `status` is the one surface that catches
 * it: an operator running `mementos status` to debug a broken endpoint needs
 * the reason, not a stack trace.
 */
export function resolveApiStatus(version: string = getPackageVersion()): { status: MementosApiStatus; error: string | null } {
  const apiBase = firstEnvValue(API_URL_ENV_KEYS);

  let apiUrl: string | null = null;
  let configured: { baseUrl: string | null; apiKeyPresent: boolean; dbPathKey: string | null } | null = null;
  let error: string | null = null;
  if (apiBase) {
    try {
      configured = getConfiguredApiEnv();
      apiUrl = configured.baseUrl;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // What the chain RESOLVES (env, Keychain, credentials file, fleet gateway) —
  // answered even with no URL configured, because a credential alone is a
  // complete configuration (`https://api.hasna.com/mementos` default).
  let resolved: ResolvedApiModeReport | null = null;
  if (!error) {
    try {
      resolved = getResolvedApiModeReport();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  // A refused base configures no HTTP transport and is never echoed: the
  // rejection reason may be userinfo, and the `--json` branch would otherwise
  // print the raw env value verbatim, password included.
  const validBase = error ? null : apiBase;
  const apiKeyConfigured = configured?.apiKeyPresent ?? false;

  let transport: MementosApiStatus["transport"];
  if (hasExplicitLocalDbPath()) {
    transport = "local"; // precedence 1: an explicit file is the narrowest signal
  } else if (isMementosLocalOptIn() && !hasMementosEnvAuthorityIntent()) {
    transport = "local"; // the flag opt-in, answered without the resolver
  } else if (resolved) {
    transport = "http";
  } else {
    transport = "unconfigured";
  }

  return {
    status: {
      app: "mementos",
      version,
      transport,
      api_url: apiUrl,
      api_base: validBase,
      api_key_present: apiKeyConfigured || resolved !== null,
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
            "mementos is not configured: no credential could be resolved from the Keychain item " +
              "hasna.credentials.mementos.api-key (macOS only), " +
              `~/.hasna/mementos/config/credentials, or ${API_KEY_ENV_KEYS[0]}; the authority would be the ` +
              `fleet gateway https://api.hasna.com/mementos (or ${API_URL_ENV_KEYS[0]} if set). ` +
              `Set ${API_URL_ENV_KEYS[0]} / ${API_KEY_ENV_KEYS[0]} to go hosted, or opt into the on-box ` +
              `store with ${DB_PATH_ENV_KEYS[0]} or ${MEMENTOS_LOCAL_OPT_IN_ENV_KEYS[0]}=1.`,
          );
          process.exit(1);
        }
      }),
  );
}