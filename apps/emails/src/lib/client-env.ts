// The app's OWN principal store: user session tokens (and agent identity tokens)
// for the multi-tenancy service, persisted behind the EMAILS_CLIENT_ENV_SECRET
// vault pointer.
//
// WHAT THIS IS NOT, since the credential-resolver adoption (hasna/apps#1720).
// Until #1720 this module was the whole client-environment chain: it delivered
// EMAILS_SELF_HOSTED_URL and the API key from the vault entry into the process
// environment, and a second resolver selected a credential from a session, an
// identity token or the operator key. That chain is GONE. The URL and the API
// key now resolve through the shared @hasna/contracts client resolver
// (src/lib/emails-credentials.ts) — the Keychain, the credentials file and the
// canonical HASNA_EMAILS_API_URL / HASNA_EMAILS_API_KEY env names — and this
// module keeps exactly the one thing that is the product rather than the
// plumbing: the session and identity tokens the `emails` server issues to its
// users and agents (multi-tenancy design §5/§7, ADR-0002).
//
// A vault entry may still carry the legacy EMAILS_SELF_HOSTED_URL /
// EMAILS_SELF_HOSTED_API_KEY fields (existing entries do); they are simply no
// longer merged here. The authority and the operator key come from the resolver
// tiers, which supersede them.

import { spawnSync } from "node:child_process";
import { EMAILS_IDP_TOKEN_ENV, EMAILS_SESSION_TOKEN_ENV } from "./emails-credentials.js";

export const EMAILS_CLIENT_ENV_SECRET_ENV = "EMAILS_CLIENT_ENV_SECRET";

/** The app's own principals, plus the one-release key alias, re-exported from the credential seam. */
export { EMAILS_IDP_TOKEN_ENV, EMAILS_SELF_HOSTED_API_KEY_ENV, EMAILS_SESSION_TOKEN_ENV } from "./emails-credentials.js";

/**
 * The settings the vault entry may still carry: the app's own principals. The
 * operator URL/key fields are NOT listed — the shared resolver owns them now.
 */
const CLIENT_ENV_PRINCIPAL_KEYS = [
  EMAILS_SESSION_TOKEN_ENV,
  EMAILS_IDP_TOKEN_ENV,
] as const;

const SECRETS_COMMAND_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "HASNA_HOME",
  "CODEWITH_HOME",
] as const;

export interface EmailsClientEnvSecretLoad {
  secretPath: string | null;
  loaded: boolean;
  ready: boolean;
}

const loadedClientEnvSecrets = new WeakMap<NodeJS.ProcessEnv, string>();

function safeProcessErrorCode(error: unknown): string | null {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]*$/.test(code) ? code : null;
}

function parseClientEnvSecret(raw: string): Record<string, string> {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") out[key] = value;
      }
      return out;
    }
  } catch {
    // Fall through to dotenv-style parsing.
  }

  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) continue;
    const key = match[1];
    if (!key) continue;
    let value = (match[2] ?? "").trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// The `secrets` CLI needs its OWN backend configuration to resolve a vault path.
// In a cloud-vault setup that means HASNA_SECRETS_STORAGE_MODE / HASNA_SECRETS_API_URL
// / HASNA_SECRETS_API_KEY; other backends use similarly-prefixed vars. Stripping
// these silently downgrades `secrets get` to the empty local store and the pointer
// fails to load ("Not found"). Pass through the secrets-tooling config namespaces
// (and only those) so the loader works regardless of the configured backend.
const SECRETS_COMMAND_ENV_PREFIXES = ["HASNA_SECRETS_", "SECRETS_", "HASNA_VAULT_"] as const;

function secretsCommandEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = {};
  for (const key of SECRETS_COMMAND_ENV_ALLOWLIST) {
    const value = env[key] ?? (key === "PATH" ? process.env["PATH"] : undefined);
    if (value !== undefined) childEnv[key] = value;
  }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (SECRETS_COMMAND_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      childEnv[key] = value;
    }
  }
  return childEnv;
}

/**
 * Load the app's principals (session/identity tokens) from the vault entry the
 * EMAILS_CLIENT_ENV_SECRET pointer names into the process environment.
 *
 * Loaded values are never logged here; callers should report only presence/shape.
 * The vault entry no longer has to carry a URL or an API key — those come from
 * the shared resolver — so a session-only entry is complete on its own.
 */
export function loadEmailsClientEnvSecret(env: NodeJS.ProcessEnv = process.env): EmailsClientEnvSecretLoad {
  const secretPath = env[EMAILS_CLIENT_ENV_SECRET_ENV]?.trim() ?? null;
  if (!secretPath) return { secretPath: null, loaded: false, ready: false };

  if (CLIENT_ENV_PRINCIPAL_KEYS.some((key) => Boolean(env[key]?.trim()))) {
    return {
      secretPath,
      loaded: false,
      ready: loadedClientEnvSecrets.get(env) === secretPath,
    };
  }

  // `--show` is the explicit plaintext opt-in required since @hasna/secrets 0.2.9,
  // whose default-deny guard makes plain `get` exit non-zero when stdout is
  // captured (2026-07-30 credential-leak incident). This capture is a private
  // parent-child pipe — the value never reaches this process's stdout, argv, or
  // logs. `secrets exec` was considered and rejected: the entry must be PARSED
  // in-process (env-map merge below), and this loader runs at lazy call sites in
  // the server/MCP where a self re-exec is unsafe. Pre-0.2.9 CLIs accept the flag
  // harmlessly — `show` has been a declared boolean flag in the CLI's parser since
  // its initial commit, so it can never swallow a following positional; old `get`
  // simply ignores it. Compatible in both directions.
  const result = spawnSync("secrets", ["get", secretPath, "--show"], {
    encoding: "utf8",
    env: secretsCommandEnv(env),
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  if (result.error) {
    const code = safeProcessErrorCode(result.error);
    throw new Error(
      `${EMAILS_CLIENT_ENV_SECRET_ENV} failed to load from the secrets vault because the secrets command could not start` +
        `${code ? ` (${code})` : ""}.`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `${EMAILS_CLIENT_ENV_SECRET_ENV} failed to load from the secrets vault because the secrets command exited with status ` +
        `${result.status ?? "unknown"}.`,
    );
  }

  const loaded = parseClientEnvSecret(result.stdout ?? "");
  for (const key of CLIENT_ENV_PRINCIPAL_KEYS) {
    const value = loaded[key]?.trim();
    if (value) env[key] = value;
  }

  loadedClientEnvSecrets.set(env, secretPath);
  return { secretPath, loaded: true, ready: true };
}

// ── session-token persistence (login/logout write the vault entry) ──────────
//
// A user session token is persisted so subsequent invocations authenticate as
// that user. It is written to BOTH the in-process env (so the current command is
// immediately authed) and — when the EMAILS_CLIENT_ENV_SECRET pointer is set —
// merged into that vault entry so it survives across processes. The token value
// is never logged or embedded in an error (only the failing subcommand name is).

export interface SessionTokenPersistResult {
  /** "vault" when the durable entry was updated; "process" when env-only. */
  scope: "vault" | "process";
  secretPath: string | null;
}

function runSecretsCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  input?: string,
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("secrets", args as string[], {
    encoding: "utf8",
    env: secretsCommandEnv(env),
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });
  if (result.error) {
    // Never include argv (which may carry the token value) in the message.
    throw new Error(`secrets ${args[0]} failed: ${result.error.message}`);
  }
  return { status: result.status ?? 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Read the current vault entry as a string map, or null if it cannot be read. */
function readClientEnvSecretMap(secretPath: string, env: NodeJS.ProcessEnv): Record<string, string> | null {
  // --show: explicit plaintext opt-in for the >=0.2.9 default-deny guard; a
  // pre-0.2.9 CLI ignores the trailing flag. See loadEmailsClientEnvSecret.
  const result = runSecretsCommand(["get", secretPath, "--show"], env);
  if (result.status !== 0) return null;
  return parseClientEnvSecret(result.stdout ?? "");
}

function writeClientEnvSecretMap(secretPath: string, map: Record<string, string>, env: NodeJS.ProcessEnv): void {
  // The value carries secrets. It rides to the `secrets` CLI on STDIN
  // (`set <key> --stdin`, added in 0.2.9) — never in argv, which any same-user
  // process can read from `ps`/procfs for the life of the child. That argv
  // exposure was found while fixing the 2026-07-30 guard incident.
  const value = JSON.stringify(map);
  const result = runSecretsCommand(["set", secretPath, "--stdin"], env, value);
  if (result.status === 0) return;
  // A pre-0.2.9 CLI rejects `--stdin` with its usage line (the value positional
  // is missing there). Only THAT failure falls back to the legacy argv form —
  // a genuine write failure on a current CLI is never retried with the value
  // in argv. The gate is exact: the pre-0.2.9 usage line never mentions
  // `--stdin`, while every >=0.2.9 usage variant does, so a current CLI's
  // usage output can never match.
  if (result.stderr.includes("Usage: secrets set") && !result.stderr.includes("--stdin")) {
    const legacy = runSecretsCommand(["set", secretPath, value], env);
    if (legacy.status === 0) return;
    throw new Error(`secrets set failed for the EMAILS_CLIENT_ENV_SECRET entry (exit ${legacy.status}).`);
  }
  throw new Error(`secrets set failed for the EMAILS_CLIENT_ENV_SECRET entry (exit ${result.status}).`);
}

/**
 * Persist a user session token: always into the in-process env, and — when a
 * vault pointer is configured — durably into that entry. Callers must reset the
 * self-hosted config cache afterwards so the new credential takes effect.
 */
export function persistClientEnvSessionToken(
  token: string,
  env: NodeJS.ProcessEnv = process.env,
): SessionTokenPersistResult {
  env[EMAILS_SESSION_TOKEN_ENV] = token;
  const secretPath = env[EMAILS_CLIENT_ENV_SECRET_ENV]?.trim();
  if (!secretPath) return { scope: "process", secretPath: null };
  const current = readClientEnvSecretMap(secretPath, env);
  if (!current) return { scope: "process", secretPath };
  current[EMAILS_SESSION_TOKEN_ENV] = token;
  writeClientEnvSecretMap(secretPath, current, env);
  return { scope: "vault", secretPath };
}

/** Remove the persisted session token from env and (if present) the vault entry. */
export function clearClientEnvSessionToken(env: NodeJS.ProcessEnv = process.env): SessionTokenPersistResult {
  delete env[EMAILS_SESSION_TOKEN_ENV];
  const secretPath = env[EMAILS_CLIENT_ENV_SECRET_ENV]?.trim();
  if (!secretPath) return { scope: "process", secretPath: null };
  const current = readClientEnvSecretMap(secretPath, env);
  if (current && EMAILS_SESSION_TOKEN_ENV in current) {
    delete current[EMAILS_SESSION_TOKEN_ENV];
    writeClientEnvSecretMap(secretPath, current, env);
    return { scope: "vault", secretPath };
  }
  return { scope: "process", secretPath };
}
