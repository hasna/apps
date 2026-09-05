/**
 * Test-only helper: build the environment for a spawned `projects` CLI/MCP
 * process (and the in-process equivalent).
 *
 * Tests inherit `process.env`, and operator machines routinely hold live
 * credentials for Projects and its Todos, Mementos, and Conversations
 * authorities. Inheriting those turns local tests into runs against the *real*
 * fleet, which both masks local-store regressions and creates real rows as a
 * side effect of `bun test`.
 *
 * Since the client moved onto the shared @hasna/contracts credential resolver,
 * a hermetic environment means silencing all five tiers, not just the env one.
 * Blanking a variable is no longer an escape hatch — a DEFINED-but-blank API
 * URL is a configuration error the seam refuses — so this helper:
 *
 *   - DELETES the canonical and aliased API URL/key names, and the deliberate
 *     override / vault-pointer / profile selectors, for projects and for every
 *     authority a projects command may reach;
 *   - points `HASNA_HOME` at a path under the system temp dir that this suite
 *     never creates, so the disk tier (`~/.hasna/<app>/config/credentials`)
 *     resolves nothing for ANY app;
 *   - sets `HASNA_STATION` to an account with no Keychain items, so the macOS
 *     Keychain tier finds nothing (`security` exits 44) instead of picking up
 *     the developer's own station credentials.
 *
 * With every tier silent, `resolveProjectStore()` takes the unhosted OSS path
 * and drives the on-box SQLite registry — which is what these tests exercise.
 * A test that wants the hosted path passes the API env in `overrides`; a test
 * that wants the LOUD half-configured failure passes only the URL.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Every app a projects command may resolve a client for. */
const CLIENT_APPS = ["PROJECTS", "TODOS", "MEMENTOS", "CONVERSATIONS", "CONTACTS"] as const;

/**
 * The OTHER apps' local stores. Projects' own `HASNA_PROJECTS_DB_PATH` is
 * deliberately NOT here: it is how a fixture pins its temp registry.
 */
const AUTHORITY_APPS = ["TODOS", "MEMENTOS", "CONVERSATIONS"] as const;

/** The credential/authority env names dropped from the inherited environment. */
export const HOSTED_API_ENV_KEYS: readonly string[] = [
  ...CLIENT_APPS.flatMap((app) => [
    `HASNA_${app}_API_URL`,
    `HASNA_${app}_API_KEY`,
    `HASNA_${app}_API_KEY_OVERRIDE`,
    `HASNA_${app}_API_KEY_REF`,
    `${app}_API_URL`,
    `${app}_API_KEY`,
  ]),
  ...AUTHORITY_APPS.flatMap((app) => [`HASNA_${app}_DB_PATH`, `${app}_DB_PATH`]),
  "HASNA_PROFILE",
];

/**
 * A `~/.hasna` root this suite never creates. The credential file tier reads
 * `<HASNA_HOME>/<app>/config/credentials`; a missing path is simply an absent
 * tier, so nothing has to be created or cleaned up.
 */
export const TEST_HASNA_HOME = join(tmpdir(), "hasna-projects-tests-no-credentials");

/** A Keychain account with no `hasna.credentials.*` items on any machine. */
export const TEST_KEYCHAIN_STATION = "hasna-projects-tests-no-keychain";

export function testSpawnEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    env[key] = value;
  }
  for (const key of HOSTED_API_ENV_KEYS) {
    if (!(key in overrides)) delete env[key];
  }
  if (!("HASNA_HOME" in overrides)) env["HASNA_HOME"] = TEST_HASNA_HOME;
  if (!("HASNA_CONFIG_HOME" in overrides)) delete env["HASNA_CONFIG_HOME"];
  if (!("HASNA_STATION" in overrides)) env["HASNA_STATION"] = TEST_KEYCHAIN_STATION;
  return { ...env, ...overrides };
}

/**
 * Apply the same silencing to the CURRENT process environment.
 *
 * In-process suites resolve the store from `process.env`, so they need the
 * identical treatment; callers snapshot and restore around their own lifecycle.
 */
export function silenceHostedApiEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const key of HOSTED_API_ENV_KEYS) delete env[key];
  delete env["HASNA_CONFIG_HOME"];
  env["HASNA_HOME"] = TEST_HASNA_HOME;
  env["HASNA_STATION"] = TEST_KEYCHAIN_STATION;
}

/**
 * The prefix of the one line unhosted mode prints on stderr.
 *
 * Local (OSS) mode is never silent — the owner ruling requires exactly one
 * line saying so — but that line is noise for every OTHER stderr assertion.
 * Suites therefore strip it with {@link withoutUnhostedNotice} and assert its
 * presence explicitly where the notice itself is the subject.
 */
export const UNHOSTED_MODE_NOTICE_PREFIX = "projects: local mode";

/** Drop the unhosted-mode notice line(s) from a captured stderr. */
export function withoutUnhostedNotice(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => !line.startsWith(UNHOSTED_MODE_NOTICE_PREFIX))
    .join("\n");
}
