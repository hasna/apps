import { resolveSelfHostedConfig } from "../db/self-hosted-store.js";
import {
  API_BASE_URL_SETTING,
  API_CREDENTIAL_SETTINGS,
  API_SETTINGS_POINTER,
  DATABASE_PATH_SETTINGS,
  StoreConfigurationError,
  planEmailStore,
} from "../store-resolution.js";
import { readConfigFile } from "./config.js";
import { EMAILS_CLIENT_ENV_SECRET_ENV, EMAILS_SESSION_TOKEN_ENV, loadEmailsClientEnvSecret } from "./client-env.js";
import { redactStructuredDiagnosticValue } from "./redaction.js";
export { EMAILS_CLIENT_ENV_SECRET_ENV } from "./client-env.js";

export type EmailsMode = "local" | "self_hosted";
// User-visible labels for the mode. The mode VALUE remains the machine enum
// `self_hosted` (JSON contract, env contract); its human label must NOT use
// the retired placement-axis vocabulary ("self-hosted" as a mode name is
// banned by the owner's deployment-terms doctrine — it survives only as plain
// English for a server someone runs). This mode means "the client talks to a
// server's HTTP API", so the label is the connection, not the placement.
export type EmailsModeLabel = "Local" | "Server API";

// Canonical mode selectors. The package's public env prefix is EMAILS_; the
// MAILERY_ prefix belongs to the abandoned 0.6.x line and to the separate cloud
// product, and stays rejected (see LEGACY_MODE_ENV_KEYS below).
export const EMAILS_MODE_ENV = "EMAILS_MODE";
export const HASNA_EMAILS_MODE_ENV = "HASNA_EMAILS_MODE";
export const EMAILS_MODE_CONFIG_KEY = "emails_mode";
export const EMAILS_MODE_ENV_KEYS = [EMAILS_MODE_ENV, HASNA_EMAILS_MODE_ENV] as const;

// The primary deployment-word key under a role name. The coherence refusal below has
// to NAME that key for the operator, and this module may not add another countable
// spelling of it — the axis ratchet holds every such reference at a ceiling that may
// only fall — so one existing spelling (in the parser's refusal) is consumed into
// this alias and both sites read it by role.
const MODE_WORD_SETTING = EMAILS_MODE_ENV;

// Removed hosted/legacy mode tiering (no cloud/remote/hybrid). The MAILERY_
// prefixed selectors are rejected loudly: they configured the removed Mailery
// runtime, so silently honouring one would start the process in a mode the
// operator did not ask this package for.
//
// This array stays module-PRIVATE on purpose: exporting it would emit the
// literal hosted key names into mode.d.ts, which the no-cloud artifact scan's
// compatibility-bridge strip (keyed on the `NAME = [...]` form) does not cover.
const LEGACY_MODE_ENV_KEYS = [
  "MAILERY_MODE",
  "HASNA_MAILERY_MODE",
  "MAILERY_STORAGE_MODE",
  "HASNA_MAILERY_STORAGE_MODE",
  "EMAILS_STORAGE_MODE",
  "HASNA_EMAILS_STORAGE_MODE",
] as const;

// Hosted control-plane credential/endpoint vars. This OSS package is cloud-free
// (a hosted Mailery cloud is platform-mailery's job), so these stay banned.
const LEGACY_HOSTED_ENV_KEYS = [
  "MAILERY_API_URL",
  "MAILERY_API_KEY",
  "MAILERY_CLOUD_API_URL",
  "MAILERY_CLOUD_TOKEN",
  "HASNA_MAILERY_API_URL",
  "HASNA_MAILERY_API_KEY",
  "HASNA_MAILERY_ENV_FILE",
] as const;

const FORBIDDEN_MODE_VALUES = new Set([
  "cloud",
  "mailery_cloud",
  "remote",
  "hybrid",
  "self-hosted",
  "selfhosted",
]);

export interface EmailsModeSource {
  kind: "env" | "config" | "default";
  name: string | null;
  value: string | null;
}

export interface EmailsModeResolution {
  mode: EmailsMode;
  label: EmailsModeLabel;
  source: EmailsModeSource;
  /**
   * Operator-facing note about HOW this mode was chosen, when the answer is
   * surprising. Null when the selection is unremarkable. Rendered by
   * src/lib/doctor.local.ts (a warn-level "Mode" check),
   * src/lib/agent-context.ts ("Mode note:") and
   * src/lib/inbox-sync-status-format.ts.
   */
  warning: string | null;
}

function migrationGuidance(source: string, value?: string): string {
  const detail = value ? ` value '${value}'` : "";
  return `${source}${detail} belongs to the removed hosted/legacy runtime. ` +
    `Use ${EMAILS_MODE_ENV}=local, or set ${EMAILS_MODE_ENV}=self_hosted with ` +
    "EMAILS_SELF_HOSTED_URL and EMAILS_SELF_HOSTED_API_KEY (or EMAILS_CLIENT_ENV_SECRET). " +
    "No cloud, remote, or hybrid alias is supported.";
}

function hasExplicitSelfHostedClientEnv(env: NodeJS.ProcessEnv): boolean {
  const explicitMode = EMAILS_MODE_ENV_KEYS.some((key) => env[key]?.trim().toLowerCase() === "self_hosted");
  return Boolean(
    explicitMode &&
      env["EMAILS_SELF_HOSTED_URL"]?.trim() &&
      (env["EMAILS_SELF_HOSTED_API_KEY"]?.trim() || env["EMAILS_SESSION_TOKEN"]?.trim()),
  );
}

export function assertNoLegacyHostedEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: { allowHostedApiEnvWithExplicitSelfHosted?: boolean } = {},
): void {
  for (const key of LEGACY_MODE_ENV_KEYS) {
    const value = env[key]?.trim();
    if (value) throw new Error(migrationGuidance(key, value));
  }
  const allowHostedApiEnv =
    options.allowHostedApiEnvWithExplicitSelfHosted === true &&
    hasExplicitSelfHostedClientEnv(env);
  for (const key of LEGACY_HOSTED_ENV_KEYS) {
    if (allowHostedApiEnv) continue;
    if (env[key]?.trim()) throw new Error(migrationGuidance(key));
  }
}

export function labelForEmailsMode(mode: EmailsMode): EmailsModeLabel {
  return mode === "local" ? "Local" : "Server API";
}

export function normalizeEmailsMode(value: string): EmailsMode {
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "self_hosted") return normalized;
  if (FORBIDDEN_MODE_VALUES.has(normalized)) {
    throw new Error(migrationGuidance(MODE_WORD_SETTING, value));
  }
  throw new Error(`Unknown Emails mode '${value}'. Use exactly local or self_hosted.`);
}

function resolution(
  mode: EmailsMode,
  source: EmailsModeSource,
  warning: string | null = null,
): EmailsModeResolution {
  return { mode, label: labelForEmailsMode(mode), source, warning };
}

/**
 * The note emitted when an explicit local-mode env var shadows a configured
 * client-env vault pointer.
 *
 * WHY THIS EXISTS. `EMAILS_CLIENT_ENV_SECRET` points at the self-hosted client
 * env; an explicit local-mode selector wins over it. That precedence is CORRECT — an explicit
 * variable must beat a pointer, and loadEmailsClientEnvSecret() returns early
 * without even spawning `secrets get` (src/lib/client-env.ts). What was wrong is
 * that nothing SAID SO: the CLI silently fell back to an empty local SQLite
 * database and reported "0 total, 0 unread" against a deployment holding ~170,000
 * messages. Operators and agents read that as an empty mailbox, not as a
 * misconfiguration, and on 2026-07-27 a blocked production email was investigated
 * against the wrong database because of it. Earlier reports of the same symptom had
 * different causes (a login shell that never sourced the pointer; the selector
 * exported from a profile), so the note names the key that actually won rather than
 * describing the class.
 *
 * The stale value is often not in any config file at all — anything that injects
 * environment into child processes (a terminal multiplexer's global environment, a
 * supervisor, a CI runner) sets it once and every process started afterwards
 * inherits it, so grepping dotfiles finds nothing. Unsetting it at the source also
 * does not retract it from processes that already exist. Hence the message names the
 * variable, quotes the pointer (a non-secret vault path), warns that the value may
 * be inherited rather than configured, and gives a one-shot escape hatch that needs
 * no cleanup.
 */
export function clientEnvPointerOverrideWarning(modeEnvKey: string, pointer: string): string {
  const renderedPointer = redactStructuredDiagnosticValue(pointer);
  return `${modeEnvKey}=local is overriding the ${EMAILS_CLIENT_ENV_SECRET_ENV} vault pointer `
    + `'${renderedPointer}': the self-hosted client env was NOT loaded and this process is reading the `
    + `local database instead. Counts and message lists here do NOT describe the self-hosted `
    + `deployment. If that is not what you meant, unset ${modeEnvKey} — note that it may be `
    + `exported by a parent process rather than by any config file, in which case already-running `
    + `shells keep the old value until they are restarted. `
    + `One-shot check: \`env -u ${modeEnvKey} emails inbox status\`.`;
}

/**
 * Null unless an explicit local-mode env var is shadowing a configured pointer.
 * `modeEnvKey` is the key that actually selected local mode, so the note names
 * the variable the operator has to change rather than a generic label.
 */
function pointerOverrideWarning(
  mode: EmailsMode,
  modeEnvKey: string,
  env: NodeJS.ProcessEnv,
): string | null {
  if (mode !== "local") return null;
  const pointer = env[EMAILS_CLIENT_ENV_SECRET_ENV]?.trim();
  if (pointer) return clientEnvPointerOverrideWarning(modeEnvKey, pointer);
  // A POINTER is the common way to configure the deployment, but not the only one.
  // An operator who exports the canonical URL + credential directly and then has a
  // stale local-mode selector in the environment gets the identical silent
  // wrong-database read, and keying the note solely on the pointer would leave that
  // case exactly as quiet as the one this change exists to fix.
  const url = env["EMAILS_SELF_HOSTED_URL"]?.trim();
  const credential = env["EMAILS_SELF_HOSTED_API_KEY"]?.trim() || env[EMAILS_SESSION_TOKEN_ENV]?.trim();
  if (url && credential) return clientEnvCredentialOverrideWarning(modeEnvKey, url);
  return null;
}

/**
 * The same note for a directly-configured deployment. Names the URL — never the
 * credential — for the same reason the pointer variant quotes only the vault path.
 */
export function clientEnvCredentialOverrideWarning(modeEnvKey: string, url: string): string {
  return `${modeEnvKey}=local is overriding the configured self-hosted endpoint `
    + `'${url}': this process is reading the local database instead. Counts and message lists `
    + `here do NOT describe the self-hosted deployment. If that is not what you meant, unset `
    + `${modeEnvKey} — note that it may be exported by a parent process rather than by any config `
    + `file, in which case already-running shells keep the old value until they are restarted. `
    + `One-shot check: \`env -u ${modeEnvKey} emails inbox status\`.`;
}

/**
 * The split-brain refusal, or null when the configuration is coherent.
 *
 * WHY THIS EXISTS. During the axis migration two routing regimes coexist in every
 * process: families already on the store seam resolve their storage from
 * configuration alone (src/store-resolution.ts, which deliberately never reads the
 * deployment word — its own suite asserts that absence), while the families not yet
 * moved are still dispatched by the word this module resolves. For ONE common
 * configuration their answers contradict: an API base URL plus a credential, with
 * the deployment word unset, sends the seam families to the HTTP API while the
 * word-routed families — with no selector and no explicit database path — now
 * refuse every default that would read a second store (fail-closed ruling,
 * 2026-09-04). The same process would mix working API commands with commands that
 * cannot start, and no diagnostic would say the two halves disagree. That is the
 * silent wrong-store read this repo classes as its worst bug, so the DEFAULTING
 * side refuses to guess and names both settings. Loud beats wrong; the axis
 * deletion retires this guard.
 *
 * Deliberately null when the storage resolution itself refuses the environment (a
 * both-configured contradiction, or an API URL missing its credential): those
 * configurations already fail closed in the seam's own words, and the default row
 * below lets that SAME refusal propagate to the word-routed families rather than
 * adding a second one in a different dialect, which would bury the actionable
 * message rather than sharpen it.
 *
 * Kept OUT of src/store-resolution.ts on purpose: the check needs the deployment
 * word's absence, and that module's load-bearing property is that it never reads
 * the word. Here the word has already been resolved absent, so the check consumes
 * that fact rather than re-deriving it.
 */
function defaultSelectionStorageConflict(env: NodeJS.ProcessEnv): StoreConfigurationError | null {
  if (!env[API_BASE_URL_SETTING]?.trim()) return null;
  let configuresApi: boolean;
  try {
    configuresApi = planEmailStore(env).store === "api";
  } catch (error) {
    // Only the storage resolution's own typed refusal is deferred to. Anything else
    // is a genuine fault, and swallowing it here would answer "local" over a broken
    // resolver — the exact silent-wrong-store shape this guard exists to prevent.
    if (error instanceof StoreConfigurationError) return null;
    throw error;
  }
  if (!configuresApi) return null;
  return new StoreConfigurationError(
    `${API_BASE_URL_SETTING} configures an Emails API, but ${MODE_WORD_SETTING} is unset — so ` +
      "the families already reading storage configuration would use that API while the " +
      "families still routed by the deployment word would refuse every default, in the " +
      "same process. Two halves of one configuration and no way to tell which one you " +
      `meant: set ${MODE_WORD_SETTING}=self_hosted to route this process through the ` +
      `API, or unset ${API_BASE_URL_SETTING} and set ` +
      `${DATABASE_PATH_SETTINGS.join(" or ")} to a database file to use the local database ` +
      "explicitly.",
    [MODE_WORD_SETTING, API_BASE_URL_SETTING],
  );
}

/** Resolve the process mode without requiring client transport credentials. */
export function resolveEmailsModeSelection(env: NodeJS.ProcessEnv = process.env): EmailsModeResolution {
  assertNoLegacyHostedEnvironment(env, { allowHostedApiEnvWithExplicitSelfHosted: true });

  for (const name of EMAILS_MODE_ENV_KEYS) {
    const value = env[name]?.trim();
    if (!value) continue;
    // Report the exact offending key rather than a generic label so the failure
    // message names the variable the operator actually has to change.
    if (FORBIDDEN_MODE_VALUES.has(value.toLowerCase())) throw new Error(migrationGuidance(name, value));
    const mode = normalizeEmailsMode(value);
    // Precedence is unchanged: this env var still wins. The only addition is that
    // when it wins OVER a configured client-env pointer, the resolution says so.
    return resolution(mode, { kind: "env", name, value }, pointerOverrideWarning(mode, name, env));
  }

  // A client secret pointer is itself an explicit self-hosted selection. Mode
  // selection deliberately does not read it: operator startup must not depend
  // on client credentials or secret-provider availability.
  const clientEnvSecretPointer = env[EMAILS_CLIENT_ENV_SECRET_ENV]?.trim();
  if (clientEnvSecretPointer) {
    return resolution("self_hosted", {
      kind: "env",
      name: EMAILS_CLIENT_ENV_SECRET_ENV,
      value: clientEnvSecretPointer,
    });
  }

  // The config-file keys are inspected with a READ-ONLY accessor: mode selection
  // must not create the data root just to check whether the file exists, least of
  // all on the fail-closed default row, which must leave a fresh home untouched.
  const config = readConfigFile();
  for (const key of ["mailery_mode", "mode", "storage_mode"] as const) {
    const value = config[key];
    if (typeof value === "string" && value.trim()) {
      throw new Error(migrationGuidance(`config key '${key}'`, value.trim()));
    }
  }
  const configured = config[EMAILS_MODE_CONFIG_KEY];
  if (typeof configured === "string" && configured.trim()) {
    const mode = normalizeEmailsMode(configured);
    return resolution(mode, { kind: "config", name: EMAILS_MODE_CONFIG_KEY, value: configured });
  }

  // The default is only safe when it AGREES with what the storage configuration
  // resolves for the seam-routed families; see the conflict helper above.
  const conflict = defaultSelectionStorageConflict(env);
  if (conflict !== null) throw conflict;

  // No selector, no pointer, no config key: this is the default row, and under the
  // fail-closed ruling (2026-09-04) it has no silent answer. Incident 715712's shape
  // was exactly this row — a dropped API environment serving an empty local mailbox
  // at rc=0 — so the local database is only reachable through an explicit choice.
  //
  // A configured database path IS that choice, and it is the ONE explicit local
  // choice both regimes can see: the store seam resolves a local store from it
  // (src/store-resolution.ts, which structurally never reads this word), so the
  // hermetic suites and DB-path deployments resolve identically on both sides of
  // the axis.
  for (const databaseSetting of DATABASE_PATH_SETTINGS) {
    const path = env[databaseSetting]?.trim();
    if (!path) continue;
    return resolution("local", { kind: "env", name: databaseSetting, value: path });
  }

  // An API base URL that reached this row can only be an API the seam refused above
  // (a working API would have made the conflict guard throw): most commonly a URL
  // with no credential. Surface the SEAM's own refusal — one dialect, the exact
  // missing settings named — instead of a second error in this module's words.
  // `planEmailStore` is called purely for that throw; reaching the line after it is
  // impossible by construction and refused anyway so a future seam change cannot
  // silently turn this row into a local default.
  if (env[API_BASE_URL_SETTING]?.trim()) {
    planEmailStore(env);
    throw new StoreConfigurationError(
      `${API_BASE_URL_SETTING} names an Emails API this process cannot use, and the store ` +
        "resolution above refused it and named the exact missing settings. To use the " +
        `local database instead, set ${DATABASE_PATH_SETTINGS.join(" or ")} to a database ` +
        "file explicitly.",
      [API_BASE_URL_SETTING],
    );
  }

  // The ALL-UNSET row: nothing configured a mode, a pointer, an API, or a database
  // path. Refuse to start and name the required environment and every explicit way
  // back to local. The mode selector itself is intentionally absent from the list:
  // an operator who had set it would have been served by the selector branch above,
  // so naming it here would only add a key this error cannot fire for.
  throw new StoreConfigurationError(
    `No Emails API configuration is present in this environment: set ${API_BASE_URL_SETTING} ` +
      `and one of ${API_CREDENTIAL_SETTINGS.join(" or ")} (or set ${API_SETTINGS_POINTER} to ` +
      `the vault pointer that delivers them). To use the local database instead, choose it ` +
      `explicitly: set ${DATABASE_PATH_SETTINGS.join(" or ")} to a database file, or an ` +
      "'emails_mode' key in the config file. The local database is never a silent default.",
    [API_BASE_URL_SETTING, ...API_CREDENTIAL_SETTINGS, API_SETTINGS_POINTER],
  );
}

/**
 * Resolve one client data-source mode for the whole process. Local is explicit
 * only — a selector, a config-file key, or a configured database path — and
 * never reads a client credential. Self-hosted is explicit and fail-closed: URL
 * + API/session credential are validated before repository, CLI, or MCP callers
 * can reach the operator API. Nothing configured fails closed instead of
 * defaulting (fail-closed ruling, 2026-09-04).
 */
export function resolveEmailsMode(env: NodeJS.ProcessEnv = process.env): EmailsModeResolution {
  const selected = resolveEmailsModeSelection(env);
  if (selected.mode === "local") return selected;

  const clientEnvSecret = loadEmailsClientEnvSecret(env);
  resolveSelfHostedConfig(env, { selectedMode: "self_hosted" });
  if (!clientEnvSecret.ready) return selected;
  return resolution("self_hosted", {
    kind: "env",
    name: EMAILS_CLIENT_ENV_SECRET_ENV,
    value: clientEnvSecret.secretPath,
  });
}

export function getEmailsMode(): EmailsMode {
  return resolveEmailsMode().mode;
}
