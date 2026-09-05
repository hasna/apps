// Regression suite for HC-00304: the test suite had write access to the hosted
// production vault.
//
// WHAT HAPPENED (measured, 2026-07-27): this repo's own tests wrote fixtures into
// the hosted vault at secrets.hasna.xyz. `getStore()` reads the client-flip env
// from the ambient process environment, and on a fleet machine that environment
// carries HASNA_SECRETS_STORAGE_MODE + HASNA_SECRETS_API_URL + HASNA_SECRETS_API_KEY.
// Tests set OPEN_SECRETS_DB (which only steers LocalStore) and were therefore
// trusted, by convention alone, to stay local. Any test that reached src/env.ts
// or src/aws.ts — both of which call getStore() internally — wrote to production.
// Two production secrets were destroyed when a fixture key name collided with a
// real one.
//
// WHAT THESE TESTS PIN. Isolation must be STRUCTURAL, not conventional:
//   1. fails closed — a test process that would reach a hosted vault ERRORS
//   2. no opt-in — a test author who sets nothing is still isolated
//   3. ambient-env resistant — the process environment cannot steer a test run
//
// SAFETY: nothing here targets a real vault. Network assertions use the reserved
// TLD `.invalid` (RFC 6761 — guaranteed never to resolve) or a loopback server.
// The one place the production hostname appears, it is only ever handed to a
// resolver, never to a request; no method is invoked on the resulting store.
// Where a test asserts that a vault WAS opened, `HOME` is a `mkdtemp` directory
// created and removed by that test, so "the operator's default vault" is always a
// path we own. No AWS client is ever constructed: the one test that names the real
// factory never invokes it.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { getStore } from "../src/store/index.js";
import { testVaultDir } from "../src/test-isolation.js";
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
  HASNA_CONFIG_HOME_ENV_KEY,
  HASNA_HOME_ENV_KEY,
  KEYCHAIN_STATION_ENV_KEY,
} from "../src/store/client.js";

const rootDir = join(import.meta.dir, "..");

/**
 * Env keys that CARRY a hosted credential or authority. The preload DELETES
 * these. Retired `*_MODE` / `*_STORAGE_MODE` names are gone from the list
 * because they steer nothing any more (#1720).
 */
const SCRUBBED_SELECTOR_KEYS = (() => {
  const keys = clientTransportEnvKeys("secrets");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("secrets"),
    credentialPointerEnvKey("secrets"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
})();

/**
 * Env keys that ANCHOR the two ambient tiers — the credentials file on disk and
 * the Keychain account. Deleting these would not make the tiers absent (they
 * would fall back to `$HOME` and `hostname -s`, which on a station is exactly
 * where a live key lives), so the preload REDIRECTS them at a throwaway
 * location instead.
 */
const REDIRECTED_TIER_KEYS = [
  HASNA_HOME_ENV_KEY,
  HASNA_CONFIG_HOME_ENV_KEY,
  KEYCHAIN_STATION_ENV_KEY,
];

const SELECTOR_KEYS = [...SCRUBBED_SELECTOR_KEYS, ...REDIRECTED_TIER_KEYS];

/** Snapshot + restore the selector keys so one test cannot leak into the next. */
let savedSelectors: Record<string, string | undefined>;

beforeEach(() => {
  savedSelectors = {};
  for (const key of SELECTOR_KEYS) savedSelectors[key] = process.env[key];
});

afterEach(() => {
  for (const key of SELECTOR_KEYS) {
    const value = savedSelectors[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127\./.test(host);
  } catch {
    return false;
  }
}

/** Record every URL the process actually hands to global fetch. */
function spyOnFetch(): { urls: string[]; restore: () => void } {
  const urls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
    return realFetch(input as never, init as never);
  }) as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = realFetch; } };
}

describe("test-vault isolation — hosted writes", () => {
  it("refuses a vault write to a non-loopback host and sends no request at all", async () => {
    // The ambient environment is the attacker here: set the client-flip vars on
    // process.env exactly the way a fleet machine sets them (URL + key pair —
    // the storage-mode variable is retired and is itself a hard error now),
    // then ask for a write the way src/env.ts and src/aws.ts do (bare
    // getStore(), no argument).
    process.env.HASNA_SECRETS_API_URL = "https://vault.invalid";
    process.env.HASNA_SECRETS_API_KEY = "not-a-real-key-fixture";

    const spy = spyOnFetch();
    try {
      const write = async () => {
        const store = getStore();
        await store.setSecret("example/app/prod/isolation-canary", "fixture-value", "credential");
      };
      await expect(write()).rejects.toThrow(/isolation/i);
      expect(spy.urls.filter((u) => !isLoopbackUrl(u))).toEqual([]);
    } finally {
      spy.restore();
    }
  }, 20_000);

  it("refuses to resolve the ambient environment onto the hosted production vault", async () => {
    // Resolution only — no method is called on the result, so this performs no
    // I/O against the real host under any version of the code.
    process.env.HASNA_SECRETS_API_URL = "https://secrets.hasna.xyz";
    process.env.HASNA_SECRETS_API_KEY = "not-a-real-key-fixture";

    expect(() => getStore()).toThrow(/isolation/i);
  });

  it("POSITIVE CONTROL: the same guard lets a loopback vault through", async () => {
    // If this fails, the guard is a blanket network block rather than a
    // hosted-vault block, and the two preceding assertions prove nothing about
    // its aim. tests/cli-get.test.ts depends on this path staying open.
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req) => {
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/v1/secrets") {
          return new Response(JSON.stringify({ key: "example/app/prod/loopback", type: "credential" }), {
            status: 201,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            key: "example/app/prod/loopback",
            value: "fixture-value",
            type: "credential",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });
    try {
      process.env.HASNA_SECRETS_API_URL = `http://127.0.0.1:${server.port}`;
      process.env.HASNA_SECRETS_API_KEY = "not-a-real-key-fixture";

      const store = getStore();
      const entry = await store.setSecret("example/app/prod/loopback", "fixture-value", "credential");
      expect(entry.key).toBe("example/app/prod/loopback");
    } finally {
      server.stop(true);
    }
  }, 20_000);
});

/**
 * Open the vault in a child process with a throwaway HOME, so "the operator's
 * default vault" is a path we own and can assert about. Minimal env on purpose:
 * `env -i`-style sanitizing of a *bash* child does not hold on this fleet (login
 * shells re-source the fleet profile), so the child is spawned directly, never
 * through a shell.
 */
function openVaultInChild(home: string, extraEnv: Record<string, string>) {
  const dbModule = pathToFileURL(join(rootDir, "src", "db.ts")).href;
  const code = [
    `const mod = await import(${JSON.stringify(dbModule)});`,
    `try { const db = mod.getDb(); console.log("OPENED:" + db.filename); }`,
    `catch (e) { console.log("THREW:" + (e instanceof Error ? e.message : String(e))); }`,
  ].join("\n");

  const result = Bun.spawnSync({
    cmd: ["bun", "-e", code],
    cwd: rootDir,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new TextDecoder().decode(result.stdout);
  return {
    exitCode: result.exitCode,
    stderr: new TextDecoder().decode(result.stderr),
    opened: stdout.split("\n").find((l) => l.startsWith("OPENED:"))?.slice("OPENED:".length).trim(),
    homeVaultExists: () => existsSync(join(home, ".hasna", "secrets", "vault.db")),
  };
}

describe("test-vault isolation — the operator's own vault", () => {
  it("never opens the default on-box vault from a test process", () => {
    // A test author who sets no DB path at all must still be isolated. The signal
    // relied on here is the preload MARKER, which tests/setup/isolate-vault.ts sets
    // in every real test process — not bare NODE_ENV, which is not sufficient for a
    // silent path swap and must not be (see the positive control below).
    const home = mkdtempSync(join(tmpdir(), "secrets-isolation-home-"));
    try {
      const r = openVaultInChild(home, { NODE_ENV: "test", HASNA_SECRETS_TEST_ISOLATION: "1" });

      expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
      // The operator's default vault must not exist afterwards.
      expect(r.homeVaultExists()).toBe(false);
      // And whatever it did open must not be under that home.
      if (r.opened) expect(r.opened.startsWith(join(home, ".hasna"))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("POSITIVE CONTROL: bare NODE_ENV=test does NOT silently redirect a non-test process", () => {
    // The discriminating half. Without this, the assertion above is satisfied by a
    // guard that redirects EVERYTHING, and "isolated" would be indistinguishable
    // from "the CLI can no longer reach any vault at all".
    //
    // This is not a hypothetical: keying the redirect on bare NODE_ENV shipped a CLI
    // that returned an empty read and discarded a write, both at exit code 0 and
    // with empty stderr, for any process under a JS test runner. Same $HOME, same
    // vault file, NODE_ENV the only varying input: count went 1 -> 0.
    //
    // So: a child that is NOT a test (no marker, entrypoint is not a `*.test.ts`)
    // must open the REAL vault under its HOME even with NODE_ENV=test present.
    const home = mkdtempSync(join(tmpdir(), "secrets-isolation-home-nodeenv-"));
    try {
      const r = openVaultInChild(home, { NODE_ENV: "test" });

      expect(r.exitCode, `stderr: ${r.stderr}`).toBe(0);
      expect(r.opened).toBe(join(home, ".hasna", "secrets", "vault.db"));
      expect(r.homeVaultExists()).toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);

  it("refuses an explicit HASNA_SECRETS_KEY_DIR aimed at the operator's vault", async () => {
    // src/db.ts has always checked its explicit path; src/crypto.ts did not, so a
    // test naming the operator's directory read the real vault KEY while only the
    // default was redirected.
    const { assertTestVaultPathAllowed, operatorVaultDir } = await import("../src/test-isolation.js");

    expect(() => assertTestVaultPathAllowed(operatorVaultDir())).toThrow(/isolation/i);
    expect(() => assertTestVaultPathAllowed(join(operatorVaultDir(), "keys"))).toThrow(/isolation/i);
    // POSITIVE CONTROL: a directory outside it is allowed, so the check is aimed
    // rather than a blanket refusal.
    expect(() => assertTestVaultPathAllowed(join(tmpdir(), "some-throwaway-keys"))).not.toThrow();
  });
});

describe("test-vault isolation — spawned children", () => {
  it("does not carry the preload's scrub or marker into a default-env child", () => {
    // Pins the runtime behaviour the preload's comment now documents, so the older
    // claim ("this process and every child it spawns with an inherited environment")
    // cannot drift back in. Measured on bun 1.3.14: a child spawned without `env:`
    // gets the process's INITIAL environment snapshot, not its current one.
    const script =
      'console.log(JSON.stringify({ marker: process.env.HASNA_SECRETS_TEST_ISOLATION ?? null, ' +
      'fresh: process.env.__SECRETS_ISOLATION_PROBE__ ?? null }));';

    process.env.__SECRETS_ISOLATION_PROBE__ = "yes";
    try {
      const dflt = Bun.spawnSync({ cmd: ["bun", "-e", script], stdout: "pipe", stderr: "pipe" });
      const explicit = Bun.spawnSync({
        cmd: ["bun", "-e", script],
        env: { ...process.env },
        stdout: "pipe",
        stderr: "pipe",
      });

      const parse = (r: { stdout: Uint8Array }) => JSON.parse(new TextDecoder().decode(r.stdout));

      // The mutation this process made after start is invisible to a default child.
      expect(parse(dflt).fresh).toBeNull();
      // POSITIVE CONTROL: spreading the CURRENT env does carry it, which is why
      // every CLI spawn in tests/ passes `env:` explicitly.
      expect(parse(explicit).fresh).toBe("yes");
      expect(parse(explicit).marker).toBe("1");
    } finally {
      delete process.env.__SECRETS_ISOLATION_PROBE__;
    }
  }, 30_000);
});

describe("test-vault isolation — the AWS client factory", () => {
  it("resets to a REFUSING factory, not the real AWS client", async () => {
    // The reset default used to be the real SecretsManagerClient, so every
    // `beforeEach` re-armed a live AWS client and the suite stayed offline only
    // because all four call sites happened to install a fake first. One forgotten
    // line and the suite talks to AWS.
    const { setAwsClientFactoryForTests, pushSecret } = await import("../src/aws.js");
    const { LocalStore } = await import("../src/store/index.js");
    const { resetDb } = await import("../src/db.js");

    // The push must get PAST the local read, or the rejection below would be an
    // ordinary "Secret not found" and would prove nothing about the factory.
    const dir = mkdtempSync(join(tmpdir(), "secrets-isolation-aws-"));
    const savedDb = process.env.OPEN_SECRETS_DB;
    process.env.OPEN_SECRETS_DB = join(dir, "vault.db");
    resetDb();

    const key = "example/app/prod/never-pushed";
    try {
      await new LocalStore().setSecret(key, "fixture-value", "credential");

      setAwsClientFactoryForTests();
      await expect(pushSecret(key, { profile: "example-aws-profile" })).rejects.toThrow(/isolation/i);

      // POSITIVE CONTROL: with a fake installed the same call reaches the client,
      // so the rejection above is the reset default and not a broken code path.
      //
      // The fake models a remote where this key genuinely does not exist, which is
      // what `never-pushed` describes: real DescribeSecret raises
      // ResourceNotFoundException rather than returning an empty object, and a push
      // onto an EXISTING remote is now refused unless --expect-version is supplied.
      // Returning `{}` would model a secret that exists with no AWSCURRENT version,
      // so the control would trip the refusal path instead of reaching the client.
      const sent: string[] = [];
      setAwsClientFactoryForTests(() => ({
        send: async (command: any) => {
          sent.push(command.constructor.name);
          if (command.constructor.name === "DescribeSecretCommand") {
            const notFound: any = new Error("Secrets Manager can't find the specified secret.");
            notFound.name = "ResourceNotFoundException";
            throw notFound;
          }
          if (command.constructor.name === "CreateSecretCommand") {
            // A real CreateSecret returns the version it minted; the checkpoint
            // is recorded from it, so an empty object is not a valid stand-in.
            return { ARN: `arn:aws:secretsmanager:eu-west-1:000000000000:secret:${key}`, VersionId: "v-created" };
          }
          return {};
        },
      }));
      await pushSecret(key, { profile: "example-aws-profile" });
      expect(sent).toContain("DescribeSecretCommand");
      expect(sent).toContain("CreateSecretCommand");
    } finally {
      setAwsClientFactoryForTests();
      resetDb();
      if (savedDb === undefined) delete process.env.OPEN_SECRETS_DB;
      else process.env.OPEN_SECRETS_DB = savedDb;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("test-vault isolation — the run-wide preload", () => {
  it("scrubs every hosted-vault selector from the environment before any test runs", () => {
    // Asserted against the selector list the transport itself publishes, so a
    // selector added to the client-flip contract later is covered automatically
    // rather than needing this list to be edited.
    expect(SCRUBBED_SELECTOR_KEYS.length).toBeGreaterThan(0);
    const present = SCRUBBED_SELECTOR_KEYS.filter((key) => (savedSelectors[key] ?? "").trim().length > 0);
    expect(present).toEqual([]);
  });

  it("redirects the ambient credential tiers instead of trusting them to be absent", () => {
    // The Keychain and ~/.hasna/<app>/config/credentials sit ABOVE the process
    // env in the chain, so scrubbing variables is not enough on a station that
    // holds a live key. Each anchor must point somewhere throwaway.
    for (const key of REDIRECTED_TIER_KEYS) {
      expect((process.env[key] ?? "").trim().length).toBeGreaterThan(0);
    }
    expect(process.env[HASNA_HOME_ENV_KEY]).toStartWith(testVaultDir());
    // A Keychain ACCOUNT no generic-password item is stored under, so the
    // lookup misses and the tier falls through rather than being disabled.
    expect(process.env[KEYCHAIN_STATION_ENV_KEY]).toContain("hasna-secrets-test-");
  });

  it("marks the process as isolated so the guard holds without a config file", () => {
    expect(process.env.HASNA_SECRETS_TEST_ISOLATION).toBe("1");
  });
});
