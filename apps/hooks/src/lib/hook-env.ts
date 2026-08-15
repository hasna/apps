/**
 * Hook child-process environment — a fixed allowlist plus a name-based deny
 * list (P1-1 env isolation).
 *
 * A hook executes third-party bytes inside the agent's session. Passing the
 * parent's process.env wholesale hands every credential the agent can reach
 * to arbitrary code. The child gets:
 *
 *   1. a fixed allowlist of non-secret session variables (HOME, LANG, TZ,
 *      SHELL, TERM, USER, PWD) plus PATH — PATH rebuilt from a trusted
 *      baseline with writable-directory entries removed (or a per-hook
 *      manifest env.PATH override, verbatim);
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
 * lists, module/startup injection, dynamic-loader preloads, TLS-trust
 * redirection, gconv/locale module injection). Exact case-sensitive names:
 * POSIX interpreters read these literals, and a differently-cased variant is
 * an inert, unrelated variable.
 *
 * Names that merely resemble credentials (e.g. HOOKS_DATA_DIR) survive; a
 * path is not a credential.
 */

import { dirname, isAbsolute } from "path";
import { existsSync, statSync } from "fs";

const ALLOWLIST = new Set(["PATH", "HOME", "LANG", "TZ", "SHELL", "TERM", "USER", "PWD"]);

/**
 * Interpreter-injection variables — stripped alongside the deny list (bug
 * cf99cf76, extended by reviewer efcad315). Each one lets a child interpreter
 * execute or source code the hook script never asked for, which can
 * re-import credentials from files on disk even when every credential-shaped
 * NAME was stripped at the parent, or redirect the child's TLS trust to an
 * attacker-controlled CA (MITM on every connection the hook makes).
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
  "PYTHONHOME",      // python: stdlib hijack (attacker stdlib on the first import)
  "LD_PRELOAD",      // loader: shared-object injection into ANY binary
  "LD_LIBRARY_PATH", // loader: library shadowing into any binary
  "GCONV_PATH",      // glibc iconv: gconv module directory (code injection)
  "LOCPATH",         // glibc: locale data directory (code injection)
  "PERL5OPT",        // perl: option list (code injection, like NODE_OPTIONS)
  "RUBYOPT",         // ruby: option list (code injection, like NODE_OPTIONS)
  // TLS-trust redirection: a hook that connects anywhere with these set
  // trusts attacker certificates (MITM on the child's every connection).
  "NODE_EXTRA_CA_CERTS",
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "CURL_CA_BUNDLE",
  "GIT_SSL_CAINFO",
  "AWS_CA_BUNDLE",
]);

/**
 * Interpreter-injection PREFIXES: git reads every GIT_CONFIG_* name as a
 * config override (GIT_CONFIG_GLOBAL/SYSTEM/NOSYSTEM point at files whose
 * include.path / hooks can execute code; GIT_CONFIG_COUNT/KEY_n/VALUE_n
 * inject inline settings) — the whole family is stripped.
 */
const INTERPRETER_INJECTION_PREFIXES = ["GIT_CONFIG_"];

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
  if (INTERPRETER_INJECTION.has(name)) return true;
  return INTERPRETER_INJECTION_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * True when a variable NAME is a bash exported-function entry
 * (BASH_FUNC_<name>%%): bash imports EXPORTED FUNCTIONS from the environment
 * into the child shell, where they shadow commands (env/cat/git/node) and
 * run attacker code on the hook's first command. The %% suffix is bash's
 * export encoding; the prefix test covers every form (%% , single %, none).
 *
 * Aliases are deliberately NOT denied: bash cannot import aliases from the
 * environment (BASH_ALIASES is an associative array and is never exported) —
 * functions are the only env-importable code vector for bash, so the strip
 * is precisely the BASH_FUNC_* prefix.
 */
export function isBashFunctionEnvName(name: string): boolean {
  return name.startsWith("BASH_FUNC_");
}

/**
 * True when a PATH entry may hold attacker-controlled executables: an empty
 * or relative entry (resolves against the child's cwd), an entry under the
 * user's home, an entry under a shared tmp tree, or a world-writable
 * directory (any user can drop a fake binary there).
 */
export function isUnsafePathEntry(entry: string, home: string | undefined): boolean {
  if (entry === "" || !isAbsolute(entry)) return true;
  if (home && (entry === home || entry.startsWith(home + "/"))) return true;
  if (entry === "/tmp" || entry.startsWith("/tmp/")) return true;
  if (entry === "/var/tmp" || entry.startsWith("/var/tmp/")) return true;
  try {
    if ((statSync(entry).mode & 0o002) !== 0) return true;
  } catch {
    // Nonexistent entry: nothing to execute there — harmless, keep it.
  }
  return false;
}

const PATH_BASELINE = ["/usr/bin", "/bin", "/usr/local/bin", "/sbin", "/usr/sbin"];

/**
 * Rebuild a PATH for the hook child from a trusted baseline: the system
 * directories (plus /opt/homebrew/bin on macOS when present) and the
 * runner's own bun directory (the interpreter the hook runs under, trusted
 * by definition even when it lives under $HOME). Parent entries are kept
 * only when they do not live under $HOME, /tmp, /var/tmp, or a world-writable
 * path — a fake `node`/`git` planted in a writable directory must never
 * execute on the hook's first command. An explicit per-hook env.PATH
 * (manifest) override bypasses this entirely: the hook author declares the
 * complete PATH it needs.
 */
export function sanitizeHookPath(pathValue: string, home: string | undefined): string {
  const baseline = PATH_BASELINE.slice();
  if (process.platform === "darwin" && existsSync("/opt/homebrew/bin")) baseline.push("/opt/homebrew/bin");
  const bunDir = dirname(process.execPath);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of baseline) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  if (!seen.has(bunDir)) {
    seen.add(bunDir);
    out.push(bunDir);
  }
  for (const entry of pathValue.split(":")) {
    if (seen.has(entry)) continue;
    if (isUnsafePathEntry(entry, home)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out.join(":");
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
    if (name === "PATH") continue; // PATH is rebuilt below (sanitized or overridden)
    const value = source[name] ?? extra?.[name];
    if (value !== undefined && value !== null) out[name] = value;
  }

  // PATH: an explicit per-hook env.PATH (manifest) override wins VERBATIM —
  // the hook author declares the complete PATH the hook needs. Otherwise the
  // parent PATH is rebuilt from a trusted baseline with every entry that
  // could hold attacker-controlled executables removed (reviewer efcad315):
  // a fake `node`/`git` planted in a writable directory must never execute
  // on the hook's first command.
  const pathOverride = extra?.PATH;
  if (pathOverride !== undefined && pathOverride !== null) {
    out.PATH = pathOverride;
  } else {
    const parentPath = source.PATH;
    if (parentPath !== undefined && parentPath !== null) {
      out.PATH = sanitizeHookPath(parentPath, source.HOME ?? extra?.HOME);
    }
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
    if (isBashFunctionEnvName(name)) continue;
    if (value !== undefined && value !== null) out[name] = value;
  }

  return out;
}
