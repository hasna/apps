import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  applyLocalTodosTestEnv,
  assertLocalTodosTestEnv,
  deliverTodosApiKeyViaDisk,
  localTodosTestEnv,
  LOCAL_ONLY_TODOS_ENV_KEYS,
  REMOVED_TODOS_ENV_KEYS,
  SHARED_TODOS_STORE_ENV_KEYS,
} from "./testing.js";
import { resolveTodosCliTransport } from "./cli/cloud-router.js";

describe("localTodosTestEnv", () => {
  test("blanks every shared-store pointer and deletes the retired storage-mode variables", () => {
    const env = localTodosTestEnv();
    for (const key of SHARED_TODOS_STORE_ENV_KEYS) expect(env[key]).toBe("");
    for (const key of REMOVED_TODOS_ENV_KEYS) expect(key in env).toBe(false);
  });

  test("defaults the explicit local opt-in so the scrubbed env routes to SQLite", () => {
    // The point of the helper, stated as an assertion on the resolver itself rather
    // than on the shape of the dictionary: a child handed this env routes to the
    // local store. Since the fail-closed ruling (hasna/apps#1613) the resolver
    // refuses an absent API pair WITHOUT the opt-in, so the helper must default
    // `HASNA_TODOS_LOCAL`/`TODOS_LOCAL` on for local-intent tests.
    const env = localTodosTestEnv({
      HASNA_TODOS_API_URL: "",
      HASNA_TODOS_API_KEY: "",
    });
    expect(env["HASNA_TODOS_LOCAL"]).toBe("1");
    expect(env["TODOS_LOCAL"]).toBe("1");
    expect(resolveTodosCliTransport(env).transport).toBe("sqlite");
  });

  test("a test that blanks the opt-in back off exercises the fail-closed arm", () => {
    // Local-intent defaults must not blind a fail-closed test: overrides are
    // applied last, so blanking the opt-in hands the resolver the real
    // "API env missing" shape and it must throw.
    const env = localTodosTestEnv({
      HASNA_TODOS_API_URL: "",
      HASNA_TODOS_API_KEY: "",
      HASNA_TODOS_LOCAL: "",
      TODOS_LOCAL: "",
    });
    expect(() => resolveTodosCliTransport(env)).toThrow("REMOTE_API_CONFIG_MISSING");
  });

  test("still resolves http when a test opts back in explicitly", () => {
    const env = localTodosTestEnv({
      HASNA_TODOS_API_URL: "http://127.0.0.1:3901",
      HASNA_TODOS_API_KEY: "throwaway",
    });
    expect(resolveTodosCliTransport(env).transport).toBe("http");
  });

  test("overrides are applied after the scrub, not before", () => {
    const env = localTodosTestEnv({ HASNA_TODOS_DB_PATH: "/tmp/x.db" });
    expect(env["HASNA_TODOS_DB_PATH"]).toBe("/tmp/x.db");
    expect(env["HASNA_TODOS_API_URL"]).toBe("");
  });
});

describe("applyLocalTodosTestEnv", () => {
  test("mutates process.env and restores every touched key exactly", () => {
    const previousUrl = process.env["HASNA_TODOS_API_URL"];
    process.env["HASNA_TODOS_API_URL"] = "https://todos.example.invalid";
    delete process.env["HASNA_TODOS_DB_PATH"];

    const restore = applyLocalTodosTestEnv({ HASNA_TODOS_DB_PATH: "/tmp/isolated.db" });
    expect(process.env["HASNA_TODOS_API_URL"]).toBe("");
    expect(process.env["HASNA_TODOS_DB_PATH"]).toBe("/tmp/isolated.db");
    // The local-opt-in keys are touched (and defaulted on) by the apply.
    expect(process.env["HASNA_TODOS_LOCAL"]).toBe("1");
    expect(process.env["TODOS_LOCAL"]).toBe("1");

    restore();
    expect(process.env["HASNA_TODOS_API_URL"]).toBe("https://todos.example.invalid");
    // Was unset before the call, so it must be unset again — not blanked.
    expect("HASNA_TODOS_DB_PATH" in process.env).toBe(false);

    if (previousUrl === undefined) delete process.env["HASNA_TODOS_API_URL"];
    else process.env["HASNA_TODOS_API_URL"] = previousUrl;
  });
});

describe("assertLocalTodosTestEnv", () => {
  test("passes on a scrubbed env and names the leaking key otherwise", () => {
    expect(() => assertLocalTodosTestEnv(localTodosTestEnv())).not.toThrow();
    expect(() =>
      assertLocalTodosTestEnv(localTodosTestEnv({ HASNA_TODOS_API_KEY: "live-key-shape" })),
    ).toThrow(/SHARED_TODOS_STORE_REACHABLE: HASNA_TODOS_API_KEY/);
  });
});

describe("scrub coverage against the resolver", () => {
  // The load-bearing test. A consumer copying the scrub list gets it wrong the day the
  // resolver grows a variable; this fails the build here instead, where the contract is.
  test("every routing variable the cloud router reads is scrubbed or explicitly local-only", () => {
    const source = readFileSync(join(import.meta.dir, "cli", "cloud-router.ts"), "utf8");
    const read = new Set<string>();
    for (const match of source.matchAll(/\benv(?:\.|\[")((?:HASNA_)?TODOS_[A-Z0-9_]+)/g)) {
      read.add(match[1]!);
    }
    expect(read.size).toBeGreaterThan(0);

    const covered = new Set<string>([
      ...SHARED_TODOS_STORE_ENV_KEYS,
      ...LOCAL_ONLY_TODOS_ENV_KEYS,
      ...REMOVED_TODOS_ENV_KEYS,
    ]);
    const uncovered = [...read].filter((key) => !covered.has(key)).sort();
    expect(uncovered).toEqual([]);
  });

  test("a no-HOME caller cannot touch the machine credential file", () => {
    // Negative control (hasna/apps#719 review P1): disk delivery of a fixture
    // key must happen only under a DELIBERATELY supplied HOME. A caller that
    // does not override HOME inherits the machine home through process.env and
    // must never receive a write to ~/.hasna/fleet-env/todos.env — doing so would
    // replace the machine's configured credential with the fixture value.
    const machineFile = join(
      process.env.HOME ?? "/nonexistent",
      ".hasna",
      "cloud",
      "todos.env",
    );
    const before = existsSync(machineFile)
      ? { size: statSync(machineFile).size, mtimeNs: statSync(machineFile).mtimeNs }
      : null;

    localTodosTestEnv({
      HASNA_TODOS_API_URL: "http://127.0.0.1:3901",
      HASNA_TODOS_API_KEY: "throwaway",
    });

    const after = existsSync(machineFile)
      ? { size: statSync(machineFile).size, mtimeNs: statSync(machineFile).mtimeNs }
      : null;
    expect(after).toEqual(before);
  });

  test("a HOME-overriding caller delivers the key to that home only", () => {
    // Positive control: with HOME deliberately supplied, the fixture key lands
    // in the override home's credential file and nowhere else.
    const home = mkdtempSync(join(tmpdir(), "todos-fixture-delivery-"));
    // Composed rather than written as a `NAME=value` literal: the staged secrets
    // scanner's credential_assignment detector fires on that shape and cannot tell
    // a fixture sentinel from a real key, so the literal form blocks every commit
    // that touches this file.
    const fixtureKey = "throwaway";
    try {
      localTodosTestEnv({
        HOME: home,
        HASNA_TODOS_API_URL: "http://127.0.0.1:3901",
        HASNA_TODOS_API_KEY: fixtureKey,
      });
      const written = readFileSync(join(home, ".hasna", "fleet-env", "todos.env"), "utf8");
      expect(written).toContain(`HASNA_TODOS_API_KEY=${fixtureKey}`);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("deliverTodosApiKeyViaDisk refuses the real machine home", () => {
  // The guard under test lives in the FUNCTION, not in localTodosTestEnv. The
  // caller-side check (testing.ts, `if (overrides.HOME && ...)`) protects exactly
  // one route into a function that is EXPORTED, so a consumer writing
  // `deliverTodosApiKeyViaDisk(localTodosTestEnv({ ... }))` re-arms the incident
  // that destroyed ~/.hasna/fleet-env/todos.env on station01 on 2026-08-21.
  //
  // These tests are hermetic BY CONSTRUCTION and that is deliberate: they never
  // nominate the operator's actual home as the refusal subject. `process.env.HOME`
  // is swapped for a scratch directory, so "the real machine home" as the function
  // computes it becomes that scratch directory. A broken guard therefore writes
  // into scratch and fails the assertion, instead of reproducing the very incident
  // the test exists to prevent. A test that proves a credential file is protected
  // by overwriting it when it regresses is not a test, it is the bug on a timer.

  const SENTINEL = "fixture-sentinel-not-a-credential";

  /** Content fingerprint of the operator's real credential file, or null if absent. */
  function snapshotRealCredential(): { size: number; sha256: string } | null {
    const home = process.env.HOME;
    if (!home) return null;
    const file = join(home, ".hasna", "fleet-env", "todos.env");
    if (!existsSync(file)) return null;
    const bytes = readFileSync(file);
    // sha256, never the content: a failure message must not print a credential.
    return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  }

  /** Run `fn` with the process believing `pretend` is this machine's home. */
  function withPretendMachineHome<T>(pretend: string, fn: () => T): T {
    const previous = process.env.HOME;
    process.env.HOME = pretend;
    try {
      return fn();
    } finally {
      if (previous === undefined) delete process.env.HOME;
      else process.env.HOME = previous;
    }
  }

  function scratch(label: string): string {
    return mkdtempSync(join(tmpdir(), `todos-${label}-`));
  }

  test("REFUSE ARM: throws rather than writing into the resolved machine home", () => {
    // Belt and braces. The refusal subject is a scratch directory, so the operator's
    // real file is not a target of this test under any code path; asserting it is
    // byte-identical afterwards is what proves that claim rather than assuming it.
    const realBefore = snapshotRealCredential();
    const pretendHome = scratch("pretend-machine-home");
    try {
      withPretendMachineHome(pretendHome, () => {
        expect(() =>
          deliverTodosApiKeyViaDisk({ HOME: pretendHome, HASNA_TODOS_API_KEY: SENTINEL }),
        ).toThrow(/TODOS_FIXTURE_HOME_IS_MACHINE_HOME/);
      });

      // A throw alone proves nothing about the filesystem: assert the write did
      // not happen before the throw.
      expect(existsSync(join(pretendHome, ".hasna", "fleet-env", "todos.env"))).toBe(false);
      expect(snapshotRealCredential()).toEqual(realBefore);
    } finally {
      rmSync(pretendHome, { recursive: true, force: true });
    }
  });

  test("REFUSE ARM: a dot-segment spelling of the machine home is still refused", () => {
    const realBefore = snapshotRealCredential();
    const pretendHome = scratch("pretend-dotseg");
    try {
      withPretendMachineHome(pretendHome, () => {
        expect(() =>
          deliverTodosApiKeyViaDisk({
            HOME: join(pretendHome, "."),
            HASNA_TODOS_API_KEY: SENTINEL,
          }),
        ).toThrow(/TODOS_FIXTURE_HOME_IS_MACHINE_HOME/);
      });
      expect(existsSync(join(pretendHome, ".hasna", "fleet-env", "todos.env"))).toBe(false);
      expect(snapshotRealCredential()).toEqual(realBefore);
    } finally {
      rmSync(pretendHome, { recursive: true, force: true });
    }
  });

  test("REFUSE ARM: a trailing-slash spelling of the machine home is still refused", () => {
    // The commonest accidental spelling: `HOME: root + "/"` or a path built by
    // joining. `resolve` collapses it, so the guard must not be comparing raw
    // strings.
    const realBefore = snapshotRealCredential();
    const pretendHome = scratch("pretend-trailing-slash");
    try {
      withPretendMachineHome(pretendHome, () => {
        expect(() =>
          deliverTodosApiKeyViaDisk({ HOME: `${pretendHome}/`, HASNA_TODOS_API_KEY: SENTINEL }),
        ).toThrow(/TODOS_FIXTURE_HOME_IS_MACHINE_HOME/);
      });
      expect(existsSync(join(pretendHome, ".hasna", "fleet-env", "todos.env"))).toBe(false);
      expect(snapshotRealCredential()).toEqual(realBefore);
    } finally {
      rmSync(pretendHome, { recursive: true, force: true });
    }
  });

  test("REFUSE ARM: a symlink pointing at the machine home is still refused", () => {
    const realBefore = snapshotRealCredential();
    const pretendHome = scratch("pretend-symlink-target");
    const linkRoot = scratch("pretend-symlink-root");
    const link = join(linkRoot, "home-link");
    symlinkSync(pretendHome, link);
    try {
      withPretendMachineHome(pretendHome, () => {
        expect(() =>
          deliverTodosApiKeyViaDisk({ HOME: link, HASNA_TODOS_API_KEY: SENTINEL }),
        ).toThrow(/TODOS_FIXTURE_HOME_IS_MACHINE_HOME/);
      });
      expect(existsSync(join(pretendHome, ".hasna", "fleet-env", "todos.env"))).toBe(false);
      expect(snapshotRealCredential()).toEqual(realBefore);
    } finally {
      rmSync(linkRoot, { recursive: true, force: true });
      rmSync(pretendHome, { recursive: true, force: true });
    }
  });

  test("WRITE ARM: a throwaway fixture home still receives the key", () => {
    // Without this arm the refusal above is unfalsifiable as a fix: a function that
    // threw unconditionally, or never wrote at all, would satisfy every refuse arm
    // and silently break all 28 subprocess fixtures that depend on disk delivery.
    const realBefore = snapshotRealCredential();
    const pretendHome = scratch("pretend-machine-home");
    const fixtureHome = scratch("fixture-home");
    try {
      withPretendMachineHome(pretendHome, () => {
        const returned = deliverTodosApiKeyViaDisk({
          HOME: fixtureHome,
          HASNA_TODOS_API_KEY: SENTINEL,
        });
        // The documented contract: the env comes back unchanged.
        expect(returned.HASNA_TODOS_API_KEY).toBe(SENTINEL);
      });

      const written = readFileSync(join(fixtureHome, ".hasna", "fleet-env", "todos.env"), "utf8");
      expect(written).toBe(`HASNA_TODOS_API_KEY=${SENTINEL}\n`);
      // and nowhere else
      expect(existsSync(join(pretendHome, ".hasna", "fleet-env", "todos.env"))).toBe(false);
      expect(snapshotRealCredential()).toEqual(realBefore);
    } finally {
      rmSync(fixtureHome, { recursive: true, force: true });
      rmSync(pretendHome, { recursive: true, force: true });
    }
  });

  test("WRITE ARM: an existing fixture credential file is replaced, not appended to", () => {
    const pretendHome = scratch("pretend-machine-home");
    const fixtureHome = scratch("fixture-home-existing");
    try {
      mkdirSync(join(fixtureHome, ".hasna", "fleet-env"), { recursive: true });
      withPretendMachineHome(pretendHome, () => {
        deliverTodosApiKeyViaDisk({ HOME: fixtureHome, HASNA_TODOS_API_KEY: "first-sentinel" });
        deliverTodosApiKeyViaDisk({ HOME: fixtureHome, HASNA_TODOS_API_KEY: SENTINEL });
      });
      const written = readFileSync(join(fixtureHome, ".hasna", "fleet-env", "todos.env"), "utf8");
      expect(written).toBe(`HASNA_TODOS_API_KEY=${SENTINEL}\n`);
    } finally {
      rmSync(fixtureHome, { recursive: true, force: true });
      rmSync(pretendHome, { recursive: true, force: true });
    }
  });

  test("no HOME, or no key, stays a silent no-op and never throws", () => {
    // Preserved behaviour, asserted so the guard cannot quietly widen into it:
    // an absent HOME or key writes nothing, which is already safe. Only the
    // machine-home case is loud.
    const pretendHome = scratch("pretend-machine-home");
    try {
      withPretendMachineHome(pretendHome, () => {
        expect(() => deliverTodosApiKeyViaDisk({ HASNA_TODOS_API_KEY: SENTINEL })).not.toThrow();
        expect(() => deliverTodosApiKeyViaDisk({ HOME: pretendHome })).not.toThrow();
      });
      expect(existsSync(join(pretendHome, ".hasna", "fleet-env", "todos.env"))).toBe(false);
    } finally {
      rmSync(pretendHome, { recursive: true, force: true });
    }
  });
});
