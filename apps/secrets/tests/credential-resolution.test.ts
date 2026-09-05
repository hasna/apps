import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  getStoreWithResolution,
  LOCAL_VAULT_OPT_IN_ENV_KEY,
} from "../src/store/index.js";
import type { KeychainCommandRunner } from "../src/store/client.js";

// The five-tier credential contract, as @hasna/secrets consumes it (#1720).
//
// These tests exercise the seam, not @hasna/contracts' resolver — that package
// owns and tests the tier semantics. What must hold HERE is that the CLI, MCP
// and SDK surfaces of this package reach the vault through that resolver: every
// tier is honoured, the precedence is the resolver's, the base URL defaults to
// the fleet gateway, and a run with NO credential fails closed without opening
// a single SQLite file.
//
// Every test passes an EXPLICIT env object. That is the resolver's hermetic
// seam: a caller-built env never reaches the machine's Keychain (unless a
// runner is injected) and never reads a HOME the caller did not put in it, so
// nothing here depends on the credentials that happen to exist on the machine
// running the suite.

const APP = "secrets";
const FIXTURE_KEY = "hasna_secrets_fixture_key_0001";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `secrets-credentials-${process.pid}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

/** A `security find-generic-password` stand-in: one item, or "not found" (exit 44). */
function fakeKeychain(items: Record<string, string>): KeychainCommandRunner {
  return (argv) => {
    const service = argv[argv.indexOf("-s") + 1] ?? "";
    const value = items[service];
    if (value === undefined) {
      return { status: 44, stdout: "", stderr: "The specified item could not be found in the keychain." };
    }
    return { status: 0, stdout: `${value}\n`, stderr: "" };
  };
}

/** Write `~/.hasna/secrets/config/credentials` under a throwaway HASNA_HOME. */
function writeCredentialsFile(contents: string, mode = 0o600): string {
  const hasnaHome = join(testDir, "hasna-home");
  const dir = join(hasnaHome, APP, "config");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "credentials");
  writeFileSync(path, contents, { mode });
  return hasnaHome;
}

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Deliberately NOT `{ ...process.env }`: an explicit env is the hermetic seam.
  return { ...extra } as NodeJS.ProcessEnv;
}

describe("credential tiers (@hasna/contracts resolver)", () => {
  it("tier 5 — HASNA_SECRETS_API_KEY alone reaches the default fleet gateway", () => {
    const resolved = getStoreWithResolution(env({ HASNA_SECRETS_API_KEY: FIXTURE_KEY }));
    expect(resolved.store.mode).toBe("api");
    expect(resolved.notice).toBeNull();
    expect(resolved.resolution).toMatchObject({
      transport: "http",
      // URLs never need configuring: a key from any tier is enough (owner
      // directive 2026-09-04). The client appends /v1 to the gateway base.
      baseUrl: "https://api.hasna.com/secrets/v1",
      apiUrlSource: "default",
      apiKeySource: "HASNA_SECRETS_API_KEY",
      apiKeyTier: "env",
      apiKeyPresent: true,
    });
  });

  it("tier 5 — the canonical name works with no alias present", () => {
    // The package used to read `SECRETS_API_URL` / `SECRETS_API_KEY` ahead of
    // the canonical names in its SDK factory, which SHADOWED them. Those reads
    // are gone; the canonical name must resolve on its own.
    const resolved = getStoreWithResolution(
      env({ HASNA_SECRETS_API_URL: "http://127.0.0.1:9999", HASNA_SECRETS_API_KEY: FIXTURE_KEY }),
    );
    expect(resolved.resolution?.baseUrl).toBe("http://127.0.0.1:9999/v1");
    expect(resolved.resolution?.apiUrlSource).toBe("HASNA_SECRETS_API_URL");
  });

  it("tier 4 — a 0600 credentials file under HASNA_HOME outranks the env key", () => {
    const hasnaHome = writeCredentialsFile(`HASNA_SECRETS_API_KEY="${FIXTURE_KEY}_disk"\n`);
    const resolved = getStoreWithResolution(
      env({ HASNA_HOME: hasnaHome, HASNA_SECRETS_API_KEY: `${FIXTURE_KEY}_env` }),
    );
    expect(resolved.resolution?.apiKeyTier).toBe("disk");
    expect(resolved.resolution?.apiKeySource).toBe(join(hasnaHome, APP, "config", "credentials"));
    // A file on disk is re-read every call while an export is a snapshot, so the
    // divergence is reported rather than silently resolved.
    expect(resolved.resolution?.warning).toContain("hold different keys");
  });

  it("tier 4 — a world-readable credentials file is a loud refusal, never a fall-through", () => {
    const hasnaHome = writeCredentialsFile(`HASNA_SECRETS_API_KEY="${FIXTURE_KEY}"\n`, 0o644);
    expect(() => getStoreWithResolution(env({ HASNA_HOME: hasnaHome }))).toThrow(/owner-only/);
  });

  it("tier 3 — the Keychain item outranks disk and env", () => {
    const hasnaHome = writeCredentialsFile(`HASNA_SECRETS_API_KEY="${FIXTURE_KEY}_disk"\n`);
    const resolved = getStoreWithResolution(
      env({
        HASNA_HOME: hasnaHome,
        HASNA_STATION: "station-test",
        HASNA_SECRETS_API_KEY: `${FIXTURE_KEY}_env`,
      }),
      {
        credentials: {
          keychain: {
            platform: "darwin",
            run: fakeKeychain({ "hasna.credentials.secrets.api-key": `${FIXTURE_KEY}_keychain` }),
          },
        },
      },
    );
    expect(resolved.resolution?.apiKeyTier).toBe("keychain");
    expect(resolved.resolution?.apiKeySource).toBe("keychain:hasna.credentials.secrets.api-key@station-test");
  });

  it("tier 3 — the Keychain api-url item selects the authority", () => {
    const resolved = getStoreWithResolution(env({ HASNA_STATION: "station-test" }), {
      credentials: {
        keychain: {
          platform: "darwin",
          run: fakeKeychain({
            "hasna.credentials.secrets.api-key": FIXTURE_KEY,
            "hasna.credentials.secrets.api-url": "http://127.0.0.1:9999",
          }),
        },
      },
    });
    expect(resolved.resolution?.baseUrl).toBe("http://127.0.0.1:9999/v1");
    expect(resolved.resolution?.apiUrlSource).toBe("keychain:hasna.credentials.secrets.api-url@station-test");
  });

  it("tier 2 — HASNA_SECRETS_API_KEY_OVERRIDE outranks the Keychain", () => {
    const resolved = getStoreWithResolution(
      env({ HASNA_STATION: "station-test", HASNA_SECRETS_API_KEY_OVERRIDE: `${FIXTURE_KEY}_override` }),
      {
        credentials: {
          keychain: {
            platform: "darwin",
            run: fakeKeychain({ "hasna.credentials.secrets.api-key": `${FIXTURE_KEY}_keychain` }),
          },
        },
      },
    );
    expect(resolved.resolution?.apiKeyTier).toBe("override");
    expect(resolved.resolution?.apiKeySource).toBe("HASNA_SECRETS_API_KEY_OVERRIDE");
  });

  it("tier 1 — an explicit argument outranks every ambient tier", () => {
    const resolved = getStoreWithResolution(env({ HASNA_SECRETS_API_KEY: `${FIXTURE_KEY}_env` }), {
      credentials: { apiKey: `${FIXTURE_KEY}_argument` },
    });
    expect(resolved.resolution?.apiKeyTier).toBe("argument");
  });
});

describe("no credential (owner ruling 2026-09-04)", () => {
  it("fails closed, naming every tier that was consulted and the local opt-in", () => {
    const hasnaHome = join(testDir, "empty-home");
    let thrown: Error | null = null;
    try {
      getStoreWithResolution(env({ HASNA_HOME: hasnaHome }));
    } catch (error) {
      thrown = error as Error;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = thrown!.message;
    expect(message).toContain("HASNA_SECRETS_API_KEY");
    expect(message).toContain("HASNA_SECRETS_API_URL");
    expect(message).toContain("Keychain");
    expect(message).toContain(join(hasnaHome, APP, "config", "credentials"));
    expect(message).toContain(LOCAL_VAULT_OPT_IN_ENV_KEY);
    // The false-green shapes stay gone.
    expect(message).not.toContain("secrets-local-fallback");
    // No local vault file was created while failing closed.
    expect(existsSync(join(hasnaHome, "vault.db"))).toBe(false);
  });

  it("an authority with no credential fails closed too — never a local read", () => {
    expect(() =>
      getStoreWithResolution(env({ HASNA_SECRETS_API_URL: "http://127.0.0.1:9999" })),
    ).toThrow(/HASNA_SECRETS_API_KEY/);
  });

  it("the explicit local opt-in selects the local vault and says so in one line", () => {
    const resolved = getStoreWithResolution(env({ [LOCAL_VAULT_OPT_IN_ENV_KEY]: "1" }));
    expect(resolved.store.mode).toBe("local");
    expect(resolved.resolution).toBeNull();
    expect(resolved.notice).toContain(LOCAL_VAULT_OPT_IN_ENV_KEY);
    expect(resolved.notice).toContain("local vault");
  });

  it("the local opt-in yields to a credential — an opted-in station stays hosted", () => {
    // The opt-in is an UNHOSTED lane, not an override. A station that holds a
    // hosted credential must not quietly diverge from the hosted vault.
    const resolved = getStoreWithResolution(
      env({ [LOCAL_VAULT_OPT_IN_ENV_KEY]: "1", HASNA_SECRETS_API_KEY: FIXTURE_KEY }),
    );
    expect(resolved.store.mode).toBe("api");
    expect(resolved.notice).toBeNull();
  });
});

describe("retired configuration is inert", () => {
  it("no *_MODE / *_STORAGE_MODE variable selects anything — the transport is URL + key", () => {
    // Deployment modes no longer exist. The variables are not a selector and not
    // an error surface of this package any more: routing is decided by the
    // credential and the authority alone.
    const resolved = getStoreWithResolution(
      env({
        HASNA_SECRETS_STORAGE_MODE: "local",
        HASNA_SECRETS_MODE: "cloud",
        SECRETS_STORAGE_MODE: "local",
        HASNA_SECRETS_API_KEY: FIXTURE_KEY,
      }),
    );
    expect(resolved.store.mode).toBe("api");
    expect(resolved.resolution?.apiKeyTier).toBe("env");
  });

  it("the retired credential locations are never consulted", async () => {
    // ~/.hasna/fleet-env, ~/.hasna/cloud and ~/.config/hasna are retired: the
    // ~/.hasna root is a closed namespace of app folders and XDG is not read.
    const hasnaHome = join(testDir, "hasna-home");
    for (const retired of [
      join(hasnaHome, "fleet-env", "secrets.env"),
      join(hasnaHome, "cloud", "secrets-cloud.env"),
      join(testDir, "xdg-config", "hasna", "secrets.env"),
    ]) {
      mkdirSync(dirname(retired), { recursive: true });
      writeFileSync(retired, `HASNA_SECRETS_API_KEY="${FIXTURE_KEY}"\n`, { mode: 0o600 });
    }
    expect(() =>
      getStoreWithResolution(
        env({
          HASNA_HOME: hasnaHome,
          HOME: testDir,
          XDG_CONFIG_HOME: join(testDir, "xdg-config"),
        }),
      ),
    ).toThrow(/no API key could be resolved|No API key could be resolved/);

    // No source file in this package may compose a retired location either.
    // Comments MAY name them — saying "this is never read" is the point — so the
    // scan looks at code only, with line and block comments stripped.
    const sources = new Bun.Glob("**/*.ts").scan({ cwd: join(import.meta.dir, "..", "src"), absolute: true });
    for await (const file of sources) {
      const code = (await Bun.file(file).text())
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n");
      for (const retired of [".hasna/fleet-env", ".hasna/cloud", "-cloud.env"]) {
        expect(code).not.toContain(retired);
      }
    }
  });
});
