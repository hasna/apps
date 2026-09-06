// Is this process a TEST RUNNER, and is that URL a real host?
//
// WHY THIS EXISTS. On a fleet machine the cloud transport variables are exported
// into every interactive shell, so a `bun test` process resolves the LIVE
// deployment unless something stops it. Measured in this repository before the
// guard landed: `RESOLVED_CLOUD=true`, `RESOLVED_HOST=conversations.hasna.xyz`,
// with no isolation variable set. The same mechanism wrote 122 rows into the
// production `@hasna/domains` store in one hour.
//
// WHY IT LIVES IN THE APP-OWNED LAYER. The store resolver in
// `src/lib/store/index.ts` is the seam that routes to `@hasna/contracts/client`
// only for the full API pair; a guard placed in the shared package would have
// no notion of a test context or a local store path and cannot see this
// conflict by construction. That reasoning is already recorded in `./index.ts`
// for this module's sibling guard, and it applies here unchanged. The upstream
// resolver keys on the API-URL keys and the API-key keys, and has no concept of
// a local store path — so it cannot see this conflict. This file is what
// protects the app.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It is dormant outside a test runner. An
// operator running the CLI by hand against production is the intended production
// path, not the defect, and nothing here should slow it down.
//
// SCOPE: IN-PROCESS, AND THAT IS A DECISION RATHER THAN AN OVERSIGHT. Every probe
// below reads state belonging to THIS process. A CHILD process spawned by a test
// is NOT covered, and measurement says so plainly — a child launched from a
// `bun test` parent with a curated env reports `CHILD_INDICATORS=[] detected=false`
// and reaches `https://conversations.hasna.xyz/v1`.
//
// WHAT HOLDS THAT BOUNDARY IS A CONVENTION IN THE SUITES, NOT A PROPERTY OF CHILD
// PROCESSES. An earlier version of this comment argued the boundary from AUTHORSHIP:
// a child's environment is constructed by its spawner, key by key, so it is an
// authored env rather than an ambient one. THAT IS FALSE AS A DESCRIPTION OF THIS
// REPOSITORY. It is corrected here rather than quietly rewritten, because a reader
// who believes it concludes that a spawner forwarding the whole parent environment
// is an exotic mistake, when it is the default shape in this tree.
//
// Measured on this tree — 36 spawn sites across 26 test files, every one of which
// passes an `env`:
//
//     forward `...process.env` as the base env      34
//     author the env key by key                      2   serve-store.e2e.test.ts:80
//                                                         store-divergence.e2e.test.ts:37
//
// FORWARDING IS THE NORM, NOT THE EDGE CASE. On a fleet machine that parent
// environment carries the live transport keys, so each of those 34 children starts
// from an env that WOULD resolve production.
//
// THE INVARIANT TO PRESERVE, stated so it can be checked rather than believed: of
// the 31 sites whose child actually imports the store, 27 PUT A DB-PATH KEY IN THE
// CHILD ENV — inline in the spawn literal, or via a `cliEnv()` helper, or (the five
// in blocker-hook.test.ts) by setting `process.env.CONVERSATIONS_DB_PATH` in the
// parent's `beforeEach` and then forwarding it. A db-path key is the
// highest-precedence signal in `./index.ts` and forces mode `local`, so that key is
// the whole of the protection.
//
// THE OTHER FOUR ARE EACH SAFE FOR A DIFFERENT REASON, and none of them is
// authorship. The two authored envs clear every transport key, so no cloud URL
// exists to resolve. `channel-cloud.e2e.test.ts:61` sets BOTH db-path keys to `""`
// on purpose — blank reads as unset — and points its child at a `127.0.0.1` fixture,
// which `isLoopbackApiUrl` exempts by design. The fourth is the deliberate residual
// below. Five further sites are outside the invariant entirely because their child
// never imports the store: the four `bun -e` probes in redaction-notice.e2e.test.ts.
// (The former `bash` resolver in the removed scripts/ci/deploy-workflow.test.ts —
// deleted with the internal deploy lane — never imported the store either.)
//
// SO: IF YOU ADD A SPAWNER WHOSE CHILD TOUCHES THE STORE, PUT A DB-PATH KEY IN THE
// ENV YOU BUILD. Copying the surrounding `...process.env` and omitting that key is a
// live path to the production store, and nothing in this module will stop it.
//
// THE RESIDUAL IS REACHED, NOT HYPOTHETICAL, AND THIS REPOSITORY REACHES IT ON
// PURPOSE. The subprocess pair at cloud-in-test-guard.test.ts:445-465 builds
// `{...process.env}`, DELETES both db-path keys, and points the child at
// `https://conversations.hasna.xyz`; its `bun run` leg asserts `OUTCOME=cloud-http`
// against that host. It is harmless as written — the key is a synthetic
// non-credential and the fixture reads `getStore().transport` without calling a
// method, so no request is issued — and it is named here so nobody reads the
// residual as unexercised.
//
// The guard stays scoped in-process deliberately. Refusing a child while permitting
// an in-process `getStore({...process.env})` would apply two different rules to the
// same act one level apart, and a caller that names its target is the caller this
// module leaves alone.
//
// TWO ALTERNATIVES FOR COVERING CHILDREN, recorded so neither is re-proposed as new.
//
// REJECTED — exporting a marker into children from module load. It mutates the
// caller's environment as an import side effect, propagates to every unrelated child
// of that process, and covers only children of a process that imported this module
// at all — so a test that merely spawns the CLI gets nothing while a reader believes
// children are covered. Partial coverage with invisible gaps is the property that
// makes a guard dangerous, and it is the property this file exists to remove.
//
// NOT TAKEN, AND NOT REFUTED — ancestry inspection: read `/proc/<ppid>/cmdline` and
// treat a `bun test` ancestor as a test context. Neither objection above applies to
// it: no import side effect, and it covers any descendant regardless of what that
// descendant imports. The fleet's own `bun` wrapper already performs exactly this
// read (`$HOME/.bun/bin/bun`, lines 124-125), so it is a known-workable technique
// rather than a sketch. Its costs are why it is not here: `/proc` is Linux-only, so
// macOS and Windows would need separate implementations or would silently lose the
// guard; it puts a filesystem read on the store-resolution path, which is hot; and a
// long-lived daemon whose ancestry happens to include a test runner is misclassified.
// Stated as an option carrying those costs, not as a recommendation.

/** The values a probe reads. Injectable so both outcomes are testable. */
export interface TestRuntimeProbeInputs {
  env: Record<string, string | undefined>;
  /** The process entry point (`Bun.main`, else `process.argv[1]`). */
  entrypoint: string | null;
  argv: readonly string[];
  /** Runner-injected globals (`__vitest_worker__`, `jest`). */
  globals: Record<string, unknown>;
}

export interface TestRuntimeSignal {
  detected: boolean;
  /** NAMES of the indicators that fired. Never a value that could be a secret. */
  indicators: string[];
  /** True when a probe threw and the detector failed closed. */
  degraded: boolean;
}

/** A path that only a test runner is the entry point for. */
const TEST_ENTRYPOINT = /(?:^|[\\/])(?:[^\\/]+\.(?:test|spec)\.[cm]?[jt]sx?|__tests__[\\/])/i;

/** A runner binary in argv's launcher/entrypoint slot (vitest, jest, mocha, ava, node --test). */
const TEST_RUNNER_ARG = /(?:^|[\\/])(?:vitest|jest(?:-worker)?|mocha|ava)(?:\.[cm]?js)?$|^--test$/i;

function defaultEntrypoint(): string | null {
  const bun = (globalThis as { Bun?: { main?: string } }).Bun;
  return bun?.main ?? process.argv[1] ?? null;
}

/**
 * Report whether this process is a test runner.
 *
 * FAIL CLOSED. Each probe is isolated: one that throws is counted as a HIT and
 * marks the signal `degraded`. A guard that passes when its own instrument
 * breaks is worse than no guard, because it reports safety it never checked.
 *
 * INDEPENDENT INDICATORS, ON PURPOSE. `NODE_ENV` alone is not the instrument —
 * measured on bun 1.3.14, `NODE_ENV=production bun test` leaves `NODE_ENV` at
 * `"production"`, so a single export defeats a NODE_ENV-only detector. Under bun
 * the entry-point and argv probes both survive that, and neither depends on
 * `NODE_ENV`.
 *
 * THERE IS NO `BUN_TEST` PROBE, AND ITS ABSENCE IS MEASURED RATHER THAN
 * OVERLOOKED. On bun 1.3.14 `bun test` does not set `BUN_TEST` — read as
 * `UNDEFINED` against a live control that read `PATH` as `SET` in the same
 * process. The complete env-key delta between `bun test` and `bun run` is
 * `NODE_ENV` plus two names belonging to a local `bun` wrapper script, not to
 * bun. So bun exports no test-specific variable at all, and a `BUN_TEST` probe
 * could never fire. It was removed rather than left in place because a reader
 * judging this detector counts the probes; a dead one inflates that count, which
 * is the single number the reader uses to decide whether the guard is
 * load-bearing. If a future bun ships the variable, add the probe back.
 *
 * `VITEST` and `JEST_WORKER_ID` stay for the opposite reason: those runners
 * really do set them. They are correct-but-unexercised here, which is not the
 * same as dead.
 */
export function detectTestRuntime(inputs: Partial<TestRuntimeProbeInputs> = {}): TestRuntimeSignal {
  const indicators: string[] = [];
  let degraded = false;

  const probe = (name: string, fn: () => string | null): void => {
    try {
      const hit = fn();
      if (hit) indicators.push(hit);
    } catch {
      // The probe could not answer. Treat the unanswerable case as a hit.
      degraded = true;
      indicators.push(`${name}:probe-failed`);
    }
  };

  const env = inputs.env ?? process.env;
  const entrypoint = inputs.entrypoint !== undefined ? inputs.entrypoint : defaultEntrypoint();
  const argv = inputs.argv ?? process.argv;
  const globals = inputs.globals ?? (globalThis as unknown as Record<string, unknown>);

  probe("NODE_ENV", () => (env.NODE_ENV === "test" ? "NODE_ENV=test" : null));
  probe("VITEST", () => (env.VITEST ? "VITEST" : null));
  probe("JEST_WORKER_ID", () => (env.JEST_WORKER_ID !== undefined ? "JEST_WORKER_ID" : null));
  probe("entrypoint", () => (entrypoint && TEST_ENTRYPOINT.test(entrypoint) ? `entrypoint:${entrypoint}` : null));
  probe("argv", () => {
    // argv after index 1 is application data. The conversations CLI puts message
    // content there, so scanning the whole vector makes a message such as
    // `src/example.test.ts` impersonate test-runner control state.
    const launcher = argv[1];
    const hit = launcher && (TEST_RUNNER_ARG.test(launcher) || TEST_ENTRYPOINT.test(launcher))
      ? launcher
      : null;
    return hit ? `argv:${hit}` : null;
  });
  probe("globals", () => {
    if (globals.__vitest_worker__ !== undefined) return "globals:__vitest_worker__";
    if (globals.jest !== undefined) return "globals:jest";
    return null;
  });

  return { detected: indicators.length > 0, indicators, degraded };
}

/**
 * Is this API URL a loopback address?
 *
 * Covers the whole `127.0.0.0/8` range rather than the single literal
 * `127.0.0.1`, because this repository's own suites have bound `127.0.0.9`
 * as well — a guard that knew only `127.0.0.1` would refuse a legitimate
 * local fixture. (The shared @hasna/contracts resolver itself accepts ONLY
 * the exact loopback authorities `127.0.0.1`, `localhost`, and `[::1]` for
 * http, so today a resolver-routed fixture must use one of those; the /8
 * coverage here is defence in depth for any future widening of that rule.)
 * Parsing rather than matching is what keeps `localhost.attacker.example` and
 * `127.0.0.1.attacker.example` from passing as loopback.
 */
export function isLoopbackApiUrl(apiUrl: string | null | undefined): boolean {
  if (!apiUrl) return false;
  let hostname: string;
  try {
    hostname = new URL(apiUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (hostname === "localhost") return true;
  if (hostname === "[::1]" || hostname === "::1") return true;
  return /^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/.test(hostname);
}

/** The deliberate per-app opt-in. NOTHING populates this automatically. */
export const ALLOW_CLOUD_IN_TESTS_ENV_KEY = "HASNA_CONVERSATIONS_ALLOW_CLOUD_IN_TESTS";

/**
 * Raised when a test process resolved the production store from ambient env.
 *
 * Carries the HOST and the indicators that fired, never a credential value.
 */
export class ConversationsCloudInTestError extends Error {
  readonly code = "CONVERSATIONS_CLOUD_IN_TEST";
  readonly host: string;
  readonly indicators: string[];
  readonly degraded: boolean;

  constructor(host: string, signal: TestRuntimeSignal, dbPathKeys: readonly string[]) {
    super(
      `Refusing to hand a test process the PRODUCTION conversations store at ${host}. ` +
        `This process looks like a test runner (${signal.indicators.join(", ")})` +
        (signal.degraded ? " — and at least one probe failed, so the detector failed closed" : "") +
        `, and the store was resolved from the ambient environment rather than from an env passed by the caller. ` +
        `The fleet exports the API URL and key into every shell, so this would have read and written the live deployment. ` +
        `Set ${dbPathKeys.join(" or ")} to an isolated file to use a local store, ` +
        `pass an explicit env object to getStore() to name your own target, ` +
        `or set ${ALLOW_CLOUD_IN_TESTS_ENV_KEY}=1 if you genuinely mean to reach production.`,
    );
    this.name = "ConversationsCloudInTestError";
    this.host = host;
    this.indicators = signal.indicators;
    this.degraded = signal.degraded;
  }
}

/** A deliberate opt-in must be an affirmative value, not merely present-and-empty. */
function optedIn(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Refuse an AMBIENTLY-resolved production store inside a test runner.
 *
 * Call this only when the store was resolved from the ambient environment. A
 * caller that hands `getStore` an explicit env has NAMED its target — including
 * the resolution suites here that assert `cloud-http` against a synthetic env —
 * and that decision is not this guard's to overturn. The defect is the ambient
 * read, so the guard is scoped to the ambient read.
 */
export function assertAmbientCloudAllowed(
  baseUrl: string,
  env: Record<string, string | undefined>,
  dbPathKeys: readonly string[],
): void {
  if (optedIn(env[ALLOW_CLOUD_IN_TESTS_ENV_KEY])) return;
  if (isLoopbackApiUrl(baseUrl)) return;
  const signal = detectTestRuntime({ env });
  if (!signal.detected) return;
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    host = "<unparseable API URL>";
  }
  throw new ConversationsCloudInTestError(host, signal, dbPathKeys);
}
