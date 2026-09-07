// Regression: a TEST PROCESS must not resolve the PRODUCTION conversations store
// from ambient environment.
//
// THE DEFECT, MEASURED IN THIS REPOSITORY BEFORE THE FIX. On station01 the fleet
// exports `HASNA_CONVERSATIONS_API_URL` and `HASNA_CONVERSATIONS_API_KEY` into
// every interactive shell, and neither `CONVERSATIONS_DB_PATH` nor
// `HASNA_CONVERSATIONS_DB_PATH` is set. A `bun test` process in this repo
// therefore resolved the live deployment:
//
//     NODE_ENV=test
//     DB_PATH_SET=no
//     RESOLVED_CLOUD=true
//     RESOLVED_HOST=conversations.hasna.xyz
//
// No test calls `getStore()` bare — but 260 production call sites do, and a test
// that exercises any CLI command, MCP handler, or poll loop reaches them. That is
// how `@hasna/domains` wrote 122 rows into its production store in one hour, and
// how an `@hasna/accounts` harness that set BOTH `ACCOUNTS_HOME` and
// `NODE_ENV=test` still wrote into a real profile directory. Setting an isolation
// variable is a REQUEST, not a guarantee: it isolates nothing until the code that
// decides actually reads it.
//
// WHY THE GUARD KEYS ON AMBIENT RESOLUTION RATHER THAN ON A VARIABLE. A caller
// that hands `getStore` an explicit env has chosen its target deliberately —
// including the existing suites here that assert `cloud-http` against a synthetic
// env, and the ones that point a store at a closed loopback port. A caller that
// calls `getStore()` bare inherits whatever the operator's shell happens to hold.
// Only the second is the defect, so only the second is refused.
//
// WHY IT THROWS RATHER THAN FALLING BACK TO LOCAL. This module already refuses to
// answer an ambiguous configuration from the on-box SQLite store, because that
// store holds a different dataset and the swap is silent. A fallback here would
// reintroduce exactly that failure under a different name.

import { afterEach, describe, expect, test } from "bun:test";
import { HERMETIC_STATION } from "../../test/hermetic.js";
import {
  ALLOW_CLOUD_IN_TESTS_ENV_KEY,
  ConversationsCloudInTestError,
  DB_PATH_KEYS,
  ENV_KEYS,
  cloudApiUrl,
  detectTestRuntime,
  getStore,
  isCloudStore,
  isLoopbackApiUrl,
  resolveConversationsCloud,
} from "./index.js";

const URL_VAR = ENV_KEYS.apiUrlKeys[0]!;
const KEY_VAR = ENV_KEYS.apiKeyKeys[0]!;
const PROD_URL = "https://conversations.hasna.xyz";
/** Not a credential: a syntactically plausible but deliberately invalid stub. */
const FAKE_KEY = ["hasna", "conversations", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");

/**
 * EVERY variable that can select a store, in precedence order.
 *
 * A case here asserts what the RESOLVER does with a named environment. It can only
 * do that if it CONSTRUCTS that environment — clearing the exact key it cares about
 * and inheriting the rest turns the assertion into a statement about whatever the
 * runner happens to hold. That is not hypothetical: `bun test` loads every file into
 * ONE process, roughly forty suites in this repository assign
 * `process.env.CONVERSATIONS_DB_PATH` at module top level and never restore it, and
 * `assertUnambiguousStoreEnv` returns at its FIRST step on any db-path variable —
 * before the half-configured check below is ever reached. Which of those two
 * outcomes you get is decided by file execution order, so the case passed locally
 * and failed in CI at the same commit.
 */
const STORE_SELECTING_KEYS: readonly string[] = [
  ...DB_PATH_KEYS,
  ...ENV_KEYS.apiUrlKeys,
  ...ENV_KEYS.apiKeyKeys,
  ALLOW_CLOUD_IN_TESTS_ENV_KEY,
];

/**
 * Run `fn` with EXACTLY `only` set among the store-selecting names, then restore
 * process.env precisely — including names `only` never mentions.
 *
 * Every case below is synchronous and issues no request, so the window in which
 * these names are set cannot be observed by another test file — which is the
 * hazard the poll/channel suites in this repo already document.
 *
 * THAT CAVEAT IS A CORRECTNESS BOUND, NOT A STYLE NOTE, so this stays file-local
 * and unexported. Hand this shape an ASYNC `fn` and it returns a PROMISE; the
 * `finally` fires the moment that promise is returned, which is BEFORE the awaited
 * body runs — the environment is restored underneath the test that asked to be
 * isolated. Suites needing the same clearing across an `await` use the hook-shaped
 * `pinStoreToDb` / `restoreStoreEnv` in `./isolated-test-env.ts`, which holds the
 * window for the whole test because bun awaits `beforeEach` and `afterEach` around
 * it. Both derive their key list from the same exports, so the two cannot drift.
 */
function withOnlyStoreEnv<T>(fn: () => T, only: Record<string, string> = {}): T {
  // The Keychain account is pinned to a station no real item uses: on a fleet
  // workstation the shared chain reads the operator's REAL api-key / api-url
  // items above the env tier, and a synthetic URL beside a real api-url item
  // is a "different authorities" refusal — not the case being asserted.
  const pinned: Record<string, string> = { HASNA_STATION: HERMETIC_STATION, ...only };
  const names = [...new Set([...STORE_SELECTING_KEYS, ...Object.keys(pinned)])];
  const saved = new Map(names.map((n) => [n, process.env[n]]));
  try {
    for (const n of names) delete process.env[n];
    for (const [k, v] of Object.entries(pinned)) process.env[k] = v;
    return fn();
  } finally {
    for (const [n, v] of saved) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
}

/** A simulated fleet shell: url + key present, nothing else selecting a store. */
function withAmbientCloudEnv<T>(fn: () => T, extra: Record<string, string> = {}): T {
  return withOnlyStoreEnv(fn, { [URL_VAR]: PROD_URL, [KEY_VAR]: FAKE_KEY, ...extra });
}

afterEach(() => {
  // Belt and braces: nothing this file sets may outlive it.
  expect(process.env[ALLOW_CLOUD_IN_TESTS_ENV_KEY]).toBeUndefined();
});

describe("detectTestRuntime", () => {
  test("positive control: this process IS detected, and names its indicators", () => {
    const signal = detectTestRuntime();
    expect(signal.detected).toBe(true);
    expect(signal.indicators.length).toBeGreaterThan(0);
  });

  test("negative control: a synthetic production process is NOT detected", () => {
    const signal = detectTestRuntime({
      env: { PATH: "/usr/bin" },
      entrypoint: "/srv/app/dist/cli.js",
      argv: ["/usr/local/bin/bun", "/srv/app/dist/cli.js"],
      globals: {},
    });
    expect(signal.detected).toBe(false);
    expect(signal.indicators).toEqual([]);
    expect(signal.degraded).toBe(false);
  });

  test("NODE_ENV is not the instrument: a test-file entrypoint is detected on its own", () => {
    // Measured on bun 1.3.14: `NODE_ENV=production bun test` leaves NODE_ENV at
    // "production", so a NODE_ENV-only detector is defeated by a single export.
    const signal = detectTestRuntime({
      env: { NODE_ENV: "production" },
      entrypoint: "/repo/src/lib/store/index.test.ts",
      argv: ["/usr/local/bin/bun", "/repo/src/lib/store/index.test.ts"],
      globals: {},
    });
    expect(signal.detected).toBe(true);
    expect(signal.indicators.some((i) => i.startsWith("entrypoint"))).toBe(true);
  });

  test("ordinary production CLI data arguments are not test-runner evidence", () => {
    const signal = detectTestRuntime({
      env: { PATH: "/usr/bin" },
      entrypoint: "/repo/bin/index.js",
      argv: [
        "/usr/local/bin/bun",
        "/repo/bin/index.js",
        "send",
        "src/lib/example.test.ts",
        "--to",
        "peer",
      ],
      globals: {},
    });
    expect(signal.detected).toBe(false);
    expect(signal.indicators).toEqual([]);
  });

  test("vitest and jest runtimes are detected too", () => {
    const base = { entrypoint: "/srv/app/main.js", argv: ["bun", "/srv/app/main.js"], globals: {} };
    expect(detectTestRuntime({ ...base, env: { VITEST: "true" } }).detected).toBe(true);
    expect(detectTestRuntime({ ...base, env: { JEST_WORKER_ID: "3" } }).detected).toBe(true);
    expect(detectTestRuntime({ ...base, env: {}, globals: { __vitest_worker__: {} } }).detected).toBe(true);
  });

  test("EVERY env probe is reachable under the runner it names — BUN_TEST is not", () => {
    // MEASURED on bun 1.3.14 (0d9b296a), probe in a bun-discoverable directory:
    //     BUN_TEST_IS=UNDEFINED
    //     CONTROL_PATH_IS=SET          <- the control: the read works
    // and the FULL env-key delta between `bun test` and `bun run` is three names:
    // NODE_ENV, plus HASNA_TEST_GUARD_HELD / HASNA_TEST_GUARD_SLOT, which are NOT
    // bun — `bun` on this fleet is a bash wrapper (`hasna-test-guard v1`). Re-checked
    // under a scrubbed `env -i` with a fresh HOME: still no BUN_TEST.
    //
    // So bun sets NO test-specific variable, and a BUN_TEST probe can never fire.
    // It was removed rather than kept, because a reader assessing this detector
    // counts probes: a dead one inflates the apparent indicator count, which is the
    // one number a reader uses to judge whether the guard is load-bearing.
    //
    // VITEST and JEST_WORKER_ID are deliberately NOT removed by the same argument —
    // those runners really do set them, so they are correct-but-unexercised here,
    // not dead.
    //
    // IF A FUTURE BUN SHIPS `BUN_TEST`: delete this case and add the probe back.
    // This assertion exists to record that the absence was measured, not overlooked.
    const signal = detectTestRuntime({
      env: { BUN_TEST: "1" },
      entrypoint: "/srv/app/dist/cli.js",
      argv: ["/usr/local/bin/bun", "/srv/app/dist/cli.js"],
      globals: {},
    });
    expect(signal.indicators).toEqual([]);
    expect(signal.detected).toBe(false);
  });

  test("FAILS CLOSED: a probe that throws counts as a HIT, never as a pass", () => {
    const hostile = {
      get NODE_ENV(): string {
        throw new Error("env read exploded");
      },
    } as unknown as Record<string, string | undefined>;
    const signal = detectTestRuntime({
      env: hostile,
      entrypoint: "/srv/app/dist/cli.js",
      argv: ["/usr/local/bin/bun", "/srv/app/dist/cli.js"],
      globals: {},
    });
    expect(signal.detected).toBe(true);
    expect(signal.degraded).toBe(true);
  });
});

describe("isLoopbackApiUrl", () => {
  test("isLoopbackApiUrl covers every loopback shape the suites or the resolver can reach", () => {
    // 127.0.0.1 is the exact-loopback authority the shared @hasna/contracts
    // resolver accepts for http; the /8 coverage here is defence in depth for
    // any future widening of that rule. Either way the guard must never refuse
    // a legitimate loopback fixture.
    expect(isLoopbackApiUrl("http://127.0.0.1:9/v1")).toBe(true);
    expect(isLoopbackApiUrl("http://127.0.0.9:9/v1")).toBe(true);
    expect(isLoopbackApiUrl("http://localhost:3000/v1")).toBe(true);
    expect(isLoopbackApiUrl("http://[::1]:8080/v1")).toBe(true);
  });

  test("does NOT treat a real host as loopback, including lookalikes", () => {
    expect(isLoopbackApiUrl(PROD_URL)).toBe(false);
    expect(isLoopbackApiUrl("https://localhost.attacker.example/v1")).toBe(false);
    expect(isLoopbackApiUrl("https://127.0.0.1.attacker.example/v1")).toBe(false);
    expect(isLoopbackApiUrl("not a url")).toBe(false);
    expect(isLoopbackApiUrl(null)).toBe(false);
  });
});

describe("getStore refuses the production store when it resolved it AMBIENTLY", () => {
  test("THE REGRESSION: a bare getStore() in a test process no longer hands back production", () => {
    withAmbientCloudEnv(() => {
      expect(() => getStore()).toThrow(ConversationsCloudInTestError);
    });
  });

  test("getStore(process.env) is the same ambient read and is refused identically", () => {
    withAmbientCloudEnv(() => {
      expect(() => getStore(process.env)).toThrow(ConversationsCloudInTestError);
    });
  });

  test("the refusal names the host, the source variable, and both ways out — and no credential", () => {
    withAmbientCloudEnv(() => {
      let caught: unknown;
      try {
        getStore();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConversationsCloudInTestError);
      const err = caught as ConversationsCloudInTestError;
      expect(err.code).toBe("CONVERSATIONS_CLOUD_IN_TEST");
      expect(err.host).toBe("conversations.hasna.xyz");
      expect(err.indicators.length).toBeGreaterThan(0);
      expect(err.message).toContain("CONVERSATIONS_DB_PATH");
      expect(err.message).toContain(ALLOW_CLOUD_IN_TESTS_ENV_KEY);
      // A credential value must never reach a message, a field, or a stack.
      const rendered = `${err.message}\n${err.stack ?? ""}\n${JSON.stringify({ h: err.host, i: err.indicators })}`;
      expect(rendered).not.toContain(FAKE_KEY);
    });
  });
});

describe("the guard covers the whole PUBLIC surface, not one entry point", () => {
  // `src/index.ts` re-exports this module with `export *`, so every exported
  // function here is package public API. Guarding `getStore` alone left a sibling
  // that MINTS THE SAME CAPABILITY unguarded, and an SDK consumer reaches it
  // directly. MEASURED on 92f632c3 inside a test process, before this change:
  //     A_getStore:                  REFUSED  ConversationsCloudInTestError
  //     B_resolveConversationsCloud: RETURNED_CLIENT baseUrl=https://conversations.hasna.xyz/v1
  //                                  hasCreate=true hasUpdate=true hasDelete=true
  // The client was constructed and inspected; no method was called, so the
  // capability is demonstrated and no write was issued.

  test("THE REGRESSION: ambient resolveConversationsCloud() no longer mints a production client", () => {
    withAmbientCloudEnv(() => {
      expect(() => resolveConversationsCloud()).toThrow(ConversationsCloudInTestError);
    });
  });

  test("resolveConversationsCloud(process.env) is the same ambient read and is refused identically", () => {
    withAmbientCloudEnv(() => {
      expect(() => resolveConversationsCloud(process.env)).toThrow(ConversationsCloudInTestError);
    });
  });

  test("an EXPLICIT env still mints a client — a named target is not this guard's to overturn", () => {
    withAmbientCloudEnv(() => {
      const client = resolveConversationsCloud({ [URL_VAR]: PROD_URL, [KEY_VAR]: FAKE_KEY });
      expect(client).not.toBeNull();
      expect(client!.baseUrl).toContain("conversations.hasna.xyz");
    });
  });

  // THE PREDICATES ARE NOT THE CAPABILITY, AND MUST NOT START THROWING.
  // `isCloudStore()` is called BARE in production code (admin-redaction.ts) to
  // decide a branch, and a suite here deliberately exports cloud credentials so
  // that bare call resolves true. A predicate hands back a boolean, never a client
  // that can write, so guarding it would break a real caller to close nothing.
  test("ambient isCloudStore() still answers instead of throwing", () => {
    withAmbientCloudEnv(() => {
      expect(isCloudStore()).toBe(true);
    });
  });

  test("ambient cloudApiUrl() still answers instead of throwing", () => {
    withAmbientCloudEnv(() => {
      expect(cloudApiUrl()).toBe(PROD_URL);
    });
  });
});

describe("the guard's scope is IN-PROCESS, and that boundary is asserted", () => {
  // NOT A REGRESSION TEST — a boundary-pinning test. This case passes on
  // 92f632c3 too. It exists so that the scope is a stated, checkable decision
  // rather than an accident of which probes happen to exist.
  //
  // MEASURED: a child spawned from a `bun test` parent with a curated env has no
  // test entrypoint and no test argv, so nothing fires —
  //     CURATED_CHILD -> CHILD_INDICATORS=[] detected=false
  //     CHILD_OUTCOME=cloud-http-REACHED baseUrl=https://conversations.hasna.xyz/v1
  //
  // THAT IS DELIBERATE. A child's environment is CONSTRUCTED BY ITS SPAWNER, so it
  // is not ambient from the spawner's point of view — it is an authored env, and
  // this guard's own rule is that a caller which names its target is left alone.
  // Guarding children while leaving `getStore(explicitEnv)` unguarded would apply
  // two different rules to the same act one level apart.
  test("a child-shaped process is NOT detected, and that is the documented boundary", () => {
    const childShaped = detectTestRuntime({
      env: { NODE_ENV: "production", PATH: "/usr/bin" },
      entrypoint: "/repo/probe/child.ts",
      argv: ["/usr/local/bin/bun", "run", "/repo/probe/child.ts"],
      globals: {},
    });
    expect(childShaped.detected).toBe(false);
    expect(childShaped.indicators).toEqual([]);
  });
});

describe("the guard stays silent where it must — known-negative cases", () => {
  test("an EXPLICIT env still resolves cloud-http, even at the production host", () => {
    // This is what the existing store-resolution suites assert. A caller that
    // names its target has chosen it; the guard must not touch that decision.
    withAmbientCloudEnv(() => {
      const store = getStore({ [URL_VAR]: PROD_URL, [KEY_VAR]: FAKE_KEY });
      expect(store.transport).toBe("cloud-http");
    });
  });

  test("an ambient LOOPBACK server is not production and is allowed", () => {
    withAmbientCloudEnv(
      () => {
        const store = getStore();
        expect(store.transport).toBe("cloud-http");
      },
      { [URL_VAR]: "http://127.0.0.1:9/v1" },
    );
  });

  test("the documented isolation variable still selects local, with no refusal", () => {
    withAmbientCloudEnv(
      () => {
        const store = getStore();
        expect(store.transport).toBe("local");
      },
      { CONVERSATIONS_DB_PATH: "/tmp/conversations-guard-negative-control.db" },
    );
  });

  test("the explicit opt-in still reaches the production store", () => {
    withAmbientCloudEnv(
      () => {
        const store = getStore();
        expect(store.transport).toBe("cloud-http");
      },
      { [ALLOW_CLOUD_IN_TESTS_ENV_KEY]: "1" },
    );
  });

  test("an ambiguous env still raises its OWN config error, not the guard's", () => {
    // Half a cloud configuration was already an error here. The guard must not
    // shadow that message, or an operator debugging a missing key is told the
    // wrong thing.
    //
    // A URL AND NOTHING ELSE is the whole point of the case, so every other
    // store-selecting name is cleared rather than inherited — a leaked db-path
    // variable short-circuits the resolver one step earlier and nothing throws at
    // all, which is exactly how this passed on a workstation and failed in CI.
    withOnlyStoreEnv(
      () => {
        let caught: unknown;
        try {
          getStore();
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        expect(caught).not.toBeInstanceOf(ConversationsCloudInTestError);
        expect((caught as Error).message).toContain(KEY_VAR);
      },
      { [URL_VAR]: PROD_URL },
    );
  });
});

// ---------------------------------------------------------------------------
// TWO-SIDED PROOF AGAINST THE REAL RUNTIME.
//
// Every case above runs inside one test process, so none of them can show that a
// PRODUCTION process is unaffected — the thing a guard like this most plausibly
// breaks. These two subprocesses run byte-identical code with byte-identical
// environment and differ only in HOW they are launched: `bun run` (production)
// versus `bun test` (test runtime). One must resolve the production store; the
// other must refuse.
// ---------------------------------------------------------------------------

describe("subprocess pair: production resolves, test refuses", () => {
  test("identical code and env; only the launcher differs", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");

    const storeModule = join(import.meta.dir, "index.ts");
    const fixture = `
import { getStore, ConversationsCloudInTestError } from ${JSON.stringify(storeModule)};
try {
  console.log("OUTCOME=" + getStore().transport);
} catch (error) {
  console.log("OUTCOME=" + (error instanceof ConversationsCloudInTestError ? "refused" : "other-error"));
}
`;
    const dir = mkdtempSync(join(tmpdir(), "conversations-guard-"));
    try {
      // `bun test` only collects files matching its test pattern, so the two
      // launchers need two names for the same bytes.
      const asScript = join(dir, "probe.script.ts");
      const asTest = join(dir, "probe.test.ts");
      writeFileSync(asScript, fixture);
      writeFileSync(asTest, fixture);

      const childEnv = { ...process.env };
      for (const key of STORE_SELECTING_KEYS) delete childEnv[key];
      childEnv[URL_VAR] = PROD_URL;
      childEnv[KEY_VAR] = FAKE_KEY;
      // Same pin as the in-process cases: the station Keychain must not answer.
      childEnv.HASNA_STATION = HERMETIC_STATION;
      delete childEnv.NODE_ENV;

      const run = async (argv: string[]) => {
        const proc = Bun.spawn(argv, { cwd: dir, stdout: "pipe", stderr: "pipe", env: childEnv });
        const [out, err] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        await proc.exited;
        return `${out}\n${err}`;
      };

      const production = await run(["bun", "run", asScript]);
      const underTest = await run(["bun", "test", asTest]);

      expect(production).toContain("OUTCOME=cloud-http");
      expect(underTest).toContain("OUTCOME=refused");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
