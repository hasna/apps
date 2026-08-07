// Is this process a TEST RUNNER, and is that URL a real host?
//
// WHY THIS EXISTS. On a fleet machine the cloud transport variables are exported
// into every interactive shell, so a `bun test` process resolves the LIVE
// deployment unless something stops it. Measured in this repository before the
// guard landed: `RESOLVED_CLOUD=true`, `RESOLVED_HOST=conversations.hasna.xyz`,
// with no isolation variable set. The same mechanism wrote 122 rows into the
// production `@hasna/domains` store in one hour.
//
// WHY IT LIVES IN THE APP-OWNED LAYER. `src/lib/contracts-client/*` is a
// byte-faithful vendored copy of `@hasna/contracts` and is periodically
// re-vendored; a guard placed there would be silently reverted by the next
// re-vendor. That reasoning is already recorded in `./index.ts` for this
// module's sibling guard, and it applies here unchanged. The upstream resolver
// has no concept of a test context at all — it keys on the API-URL keys, the
// API-key keys, and the mode, and has no notion of a local store path — so it
// cannot see this conflict by construction. That gap is tracked upstream
// separately; this file is what protects the app in the meantime.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It is dormant outside a test runner. An
// operator running the CLI by hand against production is the intended production
// path, not the defect, and nothing here should slow it down.

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
 * TWO INDEPENDENT INDICATORS, ON PURPOSE. `NODE_ENV` alone is not the
 * instrument — measured on bun 1.3.14, `NODE_ENV=production bun test` leaves
 * `NODE_ENV` at `"production"`, so a single export defeats a NODE_ENV-only
 * detector. The entry-point probe survives that, and neither depends on the
 * other.
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
  probe("BUN_TEST", () => (env.BUN_TEST ? "BUN_TEST" : null));
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
 * `127.0.0.1`, because this repository's own suites bind `127.0.0.9` as well —
 * a guard that knew only `127.0.0.1` would refuse a legitimate local fixture.
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
