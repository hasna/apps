/**
 * Hook child-process environment — a fixed allowlist plus a name-based deny
 * list (P1-1 env isolation).
 *
 * A hook executes third-party bytes inside the agent's session. Passing the
 * parent's process.env wholesale hands every credential the agent can reach
 * to arbitrary code. The child gets:
 *
 *   1. a fixed allowlist of non-secret session variables (PATH, HOME, LANG,
 *      TZ, SHELL, TERM, USER, PWD);
 *   2. non-secret HOOKS_* projections of the parent's HASNA_HOOKS_* config
 *      (data dir, DB path, lock path, config path) so in-process DB/config
 *      resolution inside the hook still finds the store the parent configured;
 *   3. caller-supplied extras, filtered through the same deny list.
 *
 * Denial is NAME-BASED by design. A value-shape test is explicitly rejected
 * as an acceptability test: a value test would have to miss something for a
 * credential to leak, so the deny list is the documented prefix/suffix set
 * below. The deny list strips:
 *
 *   suffix:  KEY, TOKEN, SECRET, PASSWORD, PASSWD, CREDENTIAL, CREDENTIALS,
 *            URL, URI (a URL/URI-bearing variable can embed credentials)
 *   prefix:  HASNA_, AWS_, AZURE_, GCP_, VAULT_, GOOGLE_, OPENAI_,
 *            ANTHROPIC_, POSTGRES_, MYSQL_, REDIS_, MONGO_, MEMENTOS_
 *   contains: DATABASE_URL (any variant)
 *
 * Names that merely resemble credentials (e.g. HOOKS_DATA_DIR) survive; a
 * path is not a credential.
 */

const ALLOWLIST = new Set(["PATH", "HOME", "LANG", "TZ", "SHELL", "TERM", "USER", "PWD"]);

const DENY_SUFFIXES = ["KEY", "TOKEN", "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL", "CREDENTIALS", "URL", "URI"];

const DENY_PREFIXES = [
  "HASNA_",
  "AWS_",
  "AZURE_",
  "GCP_",
  "VAULT_",
  "GOOGLE_",
  "OPENAI_",
  "ANTHROPIC_",
  "POSTGRES_",
  "MYSQL_",
  "REDIS_",
  "MONGO_",
  "MEMENTOS_",
];

const DENY_CONTAINS = ["DATABASE_URL"];

/**
 * True when a variable NAME is credential-bearing and must never reach a
 * hook child process. Case-insensitive.
 */
export function isDeniedEnvName(name: string): boolean {
  const upper = name.toUpperCase();
  if (DENY_PREFIXES.some((prefix) => upper.startsWith(prefix))) return true;
  if (DENY_SUFFIXES.some((suffix) => upper.endsWith(suffix))) return true;
  return DENY_CONTAINS.some((token) => upper.includes(token));
}

/**
 * Non-secret HASNA_HOOKS_* config the child still needs, projected to the
 * bare HOOKS_* aliases (config.ts and db/index.ts read both). API URLs are
 * deliberately NOT projected: a URL can embed credentials.
 */
const CONFIG_PROJECTIONS: Array<[string, string]> = [
  ["HASNA_HOOKS_DATA_DIR", "HOOKS_DATA_DIR"],
  ["HASNA_HOOKS_DB_PATH", "HOOKS_DB_PATH"],
  ["HASNA_HOOKS_LOCK_PATH", "HOOKS_LOCK_PATH"],
  ["HASNA_HOOKS_CONFIG_PATH", "HOOKS_CONFIG_PATH"],
];

/**
 * Build the sanitized environment for a hook child process.
 *
 * `source` is the parent's environment; `extra` is any caller-supplied env
 * the hook may need. The deny list applies to BOTH — a caller cannot
 * reintroduce a credential-bearing name.
 */
export function buildHookEnv(
  source: Record<string, string | undefined>,
  extra?: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const name of ALLOWLIST) {
    const value = source[name] ?? extra?.[name];
    if (value !== undefined && value !== null) out[name] = value;
  }

  for (const [from, to] of CONFIG_PROJECTIONS) {
    const value = source[from] ?? extra?.[from];
    if (value !== undefined && value !== null) out[to] = value;
  }

  const merged = { ...source, ...(extra ?? {}) };
  for (const [name, value] of Object.entries(merged)) {
    if (out[name] !== undefined) continue;
    if (isDeniedEnvName(name)) continue;
    if (value !== undefined && value !== null) out[name] = value;
  }

  return out;
}
