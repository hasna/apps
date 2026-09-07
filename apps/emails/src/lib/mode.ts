// THE CLIENT DATA-SOURCE MODE, mapped from the storage plan and from nothing else.
//
// The store seam (src/store-resolution.ts) decides which store this process reads
// and writes: the HTTP API client when the shared @hasna/contracts resolver
// (src/lib/emails-credentials.ts) produces a hosted authority plus a credential, and
// the local SQLite database only when a database path is configured explicitly
// (HASNA_EMAILS_DB_PATH / EMAILS_DB_PATH). Every other row — both configured, an
// authority without a credential, or nothing at all — is a boot error in the
// seam's own words (`StoreConfigurationError`, fail-closed ruling 2026-09-04).
// This module maps that plan onto the two-arm "client mode" value the repository
// families that are NOT yet collapsed onto the store seam still route on:
// `local` for the SQLite plan, `self_hosted` for the API plan.
//
// THE DEPLOYMENT WORD IS NOT READ HERE, AND NOTHING ELSE READS IT EITHER. The
// variables that used to declare the mode were removed with the mode axis
// (hasna/apps#1566, #1720); there is no guard module left to spell them. Keep
// this file free of those spellings.

import { planEmailStore } from "../store-resolution.js";
import { loadEmailsClientEnvSecret } from "./client-env.js";

/**
 * Which of the two client data sources this process's storage configuration
 * selects. The value tokens are the historical machine contract and stay
 * unchanged; only their production changed (see the module header).
 */
export type ClientMode = "local" | "self_hosted";

/**
 * User-visible labels for the mode. The mode VALUE remains the machine enum
 * `self_hosted` (JSON contract); its human label must NOT use the retired
 * placement-axis vocabulary ("self-hosted" as a mode name is banned by the
 * owner's deployment-terms doctrine — it survives only as plain English for a
 * server someone runs). This mode means "the client talks to a server's HTTP
 * API", so the label is the connection, not the placement.
 */
export type ClientModeLabel = "Local" | "Server API";

/** Where a resolved mode came from. */
export interface ClientModeSource {
  kind: "env" | "config" | "default";
  name: string | null;
  value: string | null;
}

export interface ClientModeResolution {
  mode: ClientMode;
  label: ClientModeLabel;
  source: ClientModeSource;
  /**
   * Operator-facing note about HOW this mode was chosen, when the answer is
   * surprising. Null when the selection is unremarkable. Rendered by
   * src/lib/doctor.local.ts (a warn-level "Mode" check),
   * src/lib/agent-context.ts ("Mode note:") and
   * src/lib/inbox-sync-status-format.ts.
   *
   * Always null today: the override notes this field used to carry described a
   * local-mode variable shadowing a configured API, and the variable that made
   * that possible is retired. The field survives so the renderers above keep
   * compiling until the mode itself is deleted.
   */
  warning: string | null;
}

export function clientModeLabel(mode: ClientMode): ClientModeLabel {
  return mode === "local" ? "Local" : "Server API";
}

function resolution(mode: ClientMode, source: ClientModeSource): ClientModeResolution {
  return { mode, label: clientModeLabel(mode), source, warning: null };
}

/**
 * Resolve which client data source this process's configuration selects,
 * WITHOUT requiring a credential or a hosted authority.
 *
 * Fail-closed in the seam's own words: an API authority without a credential,
 * a both-configured environment, or nothing configured at all each throw the
 * same typed `StoreConfigurationError` that `planEmailStore` throws — there is
 * deliberately no default row here, and no mode-vocabulary message of this
 * module's own. Callers that cannot reach the API without their credential
 * should use `resolveClientMode` instead; callers that only need to know which
 * arm a store resolves to should read the plan directly
 * (src/store-resolution.ts).
 */
export function resolveClientModeSelection(env: NodeJS.ProcessEnv = process.env): ClientModeResolution {
  const plan = planEmailStore(env);
  return plan.store === "api"
    ? resolution("self_hosted", {
        // `baseUrl` is the credential-free origin (userinfo, query and fragment
        // stripped) — safe to carry in a resolution a status payload may render.
        kind: "env",
        name: plan.setting,
        value: plan.baseUrl,
      })
    : resolution("local", {
        kind: "env",
        name: plan.setting,
        value: plan.databasePath,
      });
}

/**
 * Resolve one client data-source mode for the whole process.
 *
 * Delivers the app's own principals (session/identity tokens) from a configured
 * EMAILS_CLIENT_ENV_SECRET vault pointer into the environment FIRST — a live
 * session is a credential the API arm can use — then resolves the mode exactly
 * as `resolveClientModeSelection` does. Local storage is reachable only through
 * an explicit configured database path; nothing configured fails closed instead
 * of defaulting (fail-closed ruling, 2026-09-04, incident 715712).
 */
export function resolveClientMode(env: NodeJS.ProcessEnv = process.env): ClientModeResolution {
  loadEmailsClientEnvSecret(env);
  return resolveClientModeSelection(env);
}

export function getClientMode(): ClientMode {
  return resolveClientMode().mode;
}
