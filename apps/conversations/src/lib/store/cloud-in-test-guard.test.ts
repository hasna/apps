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
import {
  ALLOW_CLOUD_IN_TESTS_ENV_KEY,
  ConversationsCloudInTestError,
  ENV_KEYS,
  detectTestRuntime,
  getStore,
  isLoopbackApiUrl,
} from "./index.js";

const URL_VAR = ENV_KEYS.apiUrlKeys[0]!;
const KEY_VAR = ENV_KEYS.apiKeyKeys[0]!;
const PROD_URL = "https://conversations.hasna.xyz";
/** Not a credential: a syntactically plausible but deliberately invalid stub. */
const FAKE_KEY = ["hasna", "conversations", "FAKE", "NOT", "A", "REAL", "KEY"].join("_");

/**
 * Run `fn` with a simulated fleet shell, then restore process.env exactly.
 *
 * Every case below is synchronous and issues no request, so the window in which
 * these names are set cannot be observed by another test file — which is the
 * hazard the poll/channel suites in this repo already document.
 */
function withAmbientCloudEnv<T>(fn: () => T, extra: Record<string, string> = {}): T {
  const names = [URL_VAR, KEY_VAR, ALLOW_CLOUD_IN_TESTS_ENV_KEY, ...Object.keys(extra)];
  const saved = new Map(names.map((n) => [n, process.env[n]]));
  const savedDbPaths = new Map(
    ["CONVERSATIONS_DB_PATH", "HASNA_CONVERSATIONS_DB_PATH"].map((n) => [n, process.env[n]]),
  );
  try {
    for (const n of savedDbPaths.keys()) delete process.env[n];
    delete process.env[ALLOW_CLOUD_IN_TESTS_ENV_KEY];
    process.env[URL_VAR] = PROD_URL;
    process.env[KEY_VAR] = FAKE_KEY;
    for (const [k, v] of Object.entries(extra)) process.env[k] = v;
    return fn();
  } finally {
    for (const [n, v] of [...saved, ...savedDbPaths]) {
      if (v === undefined) delete process.env[n];
      else process.env[n] = v;
    }
  }
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

  test("vitest and jest runtimes are detected too", () => {
    const base = { entrypoint: "/srv/app/main.js", argv: ["bun", "/srv/app/main.js"], globals: {} };
    expect(detectTestRuntime({ ...base, env: { VITEST: "true" } }).detected).toBe(true);
    expect(detectTestRuntime({ ...base, env: { JEST_WORKER_ID: "3" } }).detected).toBe(true);
    expect(detectTestRuntime({ ...base, env: {}, globals: { __vitest_worker__: {} } }).detected).toBe(true);
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
  test("covers the whole 127.0.0.0/8 range this repo's suites actually bind", () => {
    // poll.test.ts uses 127.0.0.9 and channel.test.ts uses 127.0.0.1; a guard
    // that only knew 127.0.0.1 would refuse a legitimate local fixture.
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
      { [URL_VAR]: "http://127.0.0.9:9/v1" },
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
    const saved = process.env[KEY_VAR];
    const savedUrl = process.env[URL_VAR];
    try {
      delete process.env[KEY_VAR];
      process.env[URL_VAR] = PROD_URL;
      let caught: unknown;
      try {
        getStore();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(ConversationsCloudInTestError);
      expect((caught as Error).message).toContain(KEY_VAR);
    } finally {
      if (saved === undefined) delete process.env[KEY_VAR];
      else process.env[KEY_VAR] = saved;
      if (savedUrl === undefined) delete process.env[URL_VAR];
      else process.env[URL_VAR] = savedUrl;
    }
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

      const childEnv = { ...process.env, [URL_VAR]: PROD_URL, [KEY_VAR]: FAKE_KEY };
      delete childEnv.CONVERSATIONS_DB_PATH;
      delete childEnv.HASNA_CONVERSATIONS_DB_PATH;
      delete childEnv[ALLOW_CLOUD_IN_TESTS_ENV_KEY];
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
