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
 * The deny list alone is NOT the whole boundary (bug cf99cf76): it strips
 * credential-shaped NAMES from the parent env, but a credential can be
 * re-imported from a FILE through interpreter machinery. BASH_ENV tells bash
 * to source a file before running any non-interactive script, and ENV does
 * the same for interactive shells — a parent whose BASH_ENV points at e.g.
 * hasna-cloud-env.sh hands the hook child a process that re-exports the
 * fleet credential env AFTER the deny list ran. The interpreter-injection
 * set below strips every variable that makes a child interpreter run or
 * source code the hook did not ask for (sourcing vectors, interpreter option
 * lists, module/startup injection, dynamic-loader preloads). Exact
 * case-sensitive names: POSIX interpreters read these literals, and a
 * differently-cased variant is an inert, unrelated variable.
 *
 * Names that merely resemble credentials (e.g. HOOKS_DATA_DIR) survive; a
 * path is not a credential.
 */

const ALLOWLIST = new Set(["PATH", "HOME", "LANG", "TZ", "SHELL", "TERM", "USER", "PWD"]);

/**
 * Interpreter-injection variables — stripped alongside the deny list (bug
 * cf99cf76). Each one lets a child interpreter execute or source code the
 * hook script never asked for, which can re-import credentials from files on
 * disk even when every credential-shaped NAME was stripped at the parent.
 */
const INTERPRETER_INJECTION = new Set([
  "BASH_ENV",        // bash: file sourced before every non-interactive run
  "ENV",             // sh/bash: file sourced at interactive startup
  "BASHOPTS",        // bash: colon-separated option list (interpreter config)
  "SHELLOPTS",       // sh: colon-separated option list (interpreter config)
  "NODE_OPTIONS",    // node: --require/--import/--loader runs arbitrary JS
  "NODE_PATH",       // node: module-resolution shadowing (code injection)
  "PYTHONSTARTUP",   // python: startup file (interactive sessions)
  "PYTHONINSPECT",   // python: interactive shell after a script runs
  "PYTHONPATH",      // python: module-resolution shadowing (code injection)
  "LD_PRELOAD",      // loader: shared-object injection into ANY binary
  "LD_LIBRARY_PATH", // loader: library shadowing into any binary
]);

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
 * True when a variable NAME is interpreter-injection (bug cf99cf76): it can
 * make a child interpreter run or source code the hook did not ask for.
 * Exact case-sensitive match — interpreters read these literals verbatim.
 */
export function isInterpreterInjectionEnvName(name: string): boolean {
  return INTERPRETER_INJECTION.has(name);
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
 * the hook may need. The deny list AND the interpreter-injection set apply
 * to BOTH — a caller cannot reintroduce a credential-bearing name, and
 * cannot reintroduce a variable that would make the child's interpreter
 * source or run code (bug cf99cf76).
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
    if (isInterpreterInjectionEnvName(name)) continue;
    if (value !== undefined && value !== null) out[name] = value;
  }

  return out;
}
