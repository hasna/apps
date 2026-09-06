import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "./store-interface.js";
import {
  LOCAL_OPT_IN_ENV_KEY,
  LOCAL_OPT_IN_ENV_KEYS,
  isLocalOptIn,
  missingBackendMessage,
  resolveStore,
  withStore,
} from "./client-store.js";
import { CloudShortlinksStore } from "./cloud-store.js";

const CLOUD_ENV = {
  HASNA_SHORTLINKS_API_URL: "https://shortlinks.hasna.xyz",
  HASNA_SHORTLINKS_API_KEY: "hasna_shortlinks_test_key",
} as const;

const CLOUD_ALIAS_ENV = {
  SHORTLINKS_API_URL: "https://shortlinks.hasna.xyz",
  SHORTLINKS_API_KEY: "hasna_shortlinks_test_key",
} as const;

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), "shortlinks-resolver-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Hermetic env base: HOME + SHORTLINKS_HOME point at a scratch dir so the
 * @hasna/contracts resolver never sees a real fleet app-config / credential
 * file on disk from the machine running the tests. A no-op notice keeps the
 * local-mode stderr announcement out of the test log.
 */
function env(home: string, extra: Record<string, string> = {}): Env {
  return { HOME: home, SHORTLINKS_HOME: home, ...extra };
}

const quiet = () => {};

/** Write a disk credential for the resolver's disk tier in a scratch HOME. */
function writeDiskCredential(home: string, body: string): void {
  const dir = join(home, ".hasna", "shortlinks", "config");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "credentials");
  writeFileSync(file, body, { mode: 0o600 });
  chmodSync(file, 0o600);
}

describe("fail-closed store resolution (owner ruling 2026-09-04)", () => {
  test("no hosted env and no local opt-in: resolveStore throws naming the credential chain", () => {
    const home = tempHome();
    const error = () => resolveStore(env(home));
    expect(error).toThrow(/HASNA_SHORTLINKS_API_URL/);
    expect(error).toThrow(/HASNA_SHORTLINKS_API_KEY/);
    // The error is actionable: it names the local opt-in as well.
    expect(error).toThrow(new RegExp(`${LOCAL_OPT_IN_ENV_KEY}=1`));
    expect(error).toThrow(/never falls back to local storage/);
  });

  test("failed resolution creates no local database and no data-dir files", () => {
    const home = tempHome();
    expect(() => resolveStore(env(home))).toThrow(/HASNA_SHORTLINKS_API_URL/);
    // The on-box SQLite store (~/.hasna/<app>/<app>.db) is never opened or
    // created by a failing resolution — no db file, no config file.
    expect(existsSync(join(home, "shortlinks.db"))).toBe(false);
    expect(existsSync(join(home, "config.json"))).toBe(false);
  });

  test("withStore rejects without env and creates no local database", async () => {
    const home = tempHome();
    await expect(withStore(async () => null, env(home))).rejects.toThrow(
      /HASNA_SHORTLINKS_API_URL/,
    );
    expect(existsSync(join(home, "shortlinks.db"))).toBe(false);
  });

  test("a URL without a credential fails closed even when --db would opt into local", () => {
    // A partially configured hosted client must fail loudly, never silently
    // drift to the local dataset: the URL declares intent, so --db cannot
    // quietly serve the on-box store instead.
    const home = tempHome();
    const urlOnly = () =>
      resolveStore(env(home, { HASNA_SHORTLINKS_API_URL: "https://shortlinks.example.test" }), {
        dbPath: join(home, "explicit.db"),
      });
    expect(urlOnly).toThrow(/no API key could be resolved/);
    expect(existsSync(join(home, "explicit.db"))).toBe(false);
  });

  test("a declared-but-blank authority variable fails closed (blank means a loud error at the resolver)", () => {
    const home = tempHome();
    const blank = () => resolveStore(env(home, { HASNA_SHORTLINKS_API_URL: "" }));
    // "blank means unset" holds at the APP seam (see client-resolver-inputs.ts),
    // so a blank URL with nothing else is the missing-credential case; a blank
    // authored ALONGSIDE a real value is not — that pair is refused by the
    // resolver's own disagreeing-authority rule. Either way: no local store.
    expect(blank).toThrow(/HASNA_SHORTLINKS_API_URL/);
    expect(existsSync(join(home, "shortlinks.db"))).toBe(false);
  });

  test("a fully configured hosted API selects the cloud store", () => {
    const home = tempHome();
    const store = resolveStore(env(home, CLOUD_ENV));
    expect(store.kind).toBe("http");
    void store.close();
  });

  test("a credential alone selects the cloud store at the fleet gateway", () => {
    // Owner directive 2026-09-04: URLs never need configuring — a key from any
    // tier is enough, and the default authority is https://api.hasna.com/<app>.
    const home = tempHome();
    const store = resolveStore(env(home, { HASNA_SHORTLINKS_API_KEY: "hasna_shortlinks_test_key" }));
    expect(store.kind).toBe("http");
    expect((store as CloudShortlinksStore).baseUrl).toBe("https://api.hasna.com/shortlinks/v1");
    void store.close();
  });

  test("legacy alias env (SHORTLINKS_API_URL / SHORTLINKS_API_KEY) selects the cloud store", () => {
    const home = tempHome();
    const store = resolveStore(env(home, CLOUD_ALIAS_ENV));
    expect(store.kind).toBe("http");
    void store.close();
  });

  test("a fully configured hosted API wins over the local opt-in", () => {
    const home = tempHome();
    const store = resolveStore(env(home, { ...CLOUD_ENV, [LOCAL_OPT_IN_ENV_KEY]: "1" }));
    expect(store.kind).toBe("http");
    void store.close();
  });

  test("blank authority env is normalised at the app seam (env by identity when nothing is blank)", () => {
    // Regression for hasna/apps#1788: scrubbed test environments author blanks
    // instead of deleting. The app seam treats a declared-but-blank variable as
    // unset — but only by removing it BEFORE the resolver sees it, and the
    // resolver is never handed a silent copy.
    const home = tempHome();
    const store = resolveStore(
      env(home, {
        HASNA_SHORTLINKS_API_URL: "",
        HASNA_SHORTLINKS_API_KEY: "",
        SHORTLINKS_API_URL: "",
        SHORTLINKS_API_KEY: "",
      }),
      { dbPath: join(home, "explicit.db") },
    );
    expect(store.kind).toBe("local");
    void store.close();
    expect(existsSync(join(home, "explicit.db"))).toBe(true);
  });
});

describe("credential resolution through the @hasna/contracts chain", () => {
  test("env tier: HASNA_SHORTLINKS_API_KEY resolves the hosted store and reports its source", () => {
    const home = tempHome();
    const store = resolveStore(env(home, { HASNA_SHORTLINKS_API_KEY: "env-key" })) as CloudShortlinksStore;
    expect(store.kind).toBe("http");
    // The transport sealed the credential it will send; requesting is lazy, so
    // no network is touched here.
    expect(store.baseUrl).toBe("https://api.hasna.com/shortlinks/v1");
    void store.close();
  });

  test("disk tier: ~/.hasna/shortlinks/config/credentials resolves the hosted store", () => {
    const home = tempHome();
    writeDiskCredential(home, "HASNA_SHORTLINKS_API_KEY=disk-key\n");
    const store = resolveStore(env(home)) as CloudShortlinksStore;
    expect(store.kind).toBe("http");
    expect(store.baseUrl).toBe("https://api.hasna.com/shortlinks/v1");
    void store.close();
  });

  test("disk tier can also pin the authority via HASNA_SHORTLINKS_API_URL", () => {
    const home = tempHome();
    writeDiskCredential(home, "HASNA_SHORTLINKS_API_KEY=disk-key\nHASNA_SHORTLINKS_API_URL=https://shortlinks.disk.test\n");
    const store = resolveStore(env(home)) as CloudShortlinksStore;
    expect(store.kind).toBe("http");
    expect(store.baseUrl).toBe("https://shortlinks.disk.test/v1");
    void store.close();
  });

  test("injected security runner: the Keychain tier resolves on a darwin platform", () => {
    const home = tempHome();
    const reads: Array<readonly string[]> = [];
    const envWithKeychain = env(home, { HASNA_STATION: "test-station", USER: "hasna" });
    const store = resolveStore(envWithKeychain, {
      cloudOverrides: {
        credentials: {
          keychain: {
            platform: "darwin",
            run: (argv) => {
              reads.push(argv);
              const args = argv.join(" ");
              if (args.includes("api-url")) return { status: 44, stdout: "", stderr: "" };
              if (args.includes("api-key")) return { status: 0, stdout: "keychain-key", stderr: "" };
              return { status: 44, stdout: "", stderr: "" };
            },
          },
        },
      },
    }) as CloudShortlinksStore;
    expect(store.kind).toBe("http");
    expect(store.baseUrl).toBe("https://api.hasna.com/shortlinks/v1");
    // The runner was consulted for the credential item (and the absent api-url
    // item, which correctly fell through to the fleet gateway).
    expect(reads.some((argv) => argv.join(" ").includes("hasna.credentials.shortlinks.api-key"))).toBe(true);
    void store.close();
  });

  test("an unreadable credential file is a loud error, never a fallback to local", () => {
    const home = tempHome();
    writeDiskCredential(home, "HASNA_SHORTLINKS_API_KEY=disk-key\n");
    chmodSync(join(home, ".hasna", "shortlinks", "config", "credentials"), 0o644);
    expect(() => resolveStore(env(home))).toThrow(/owner-only/);
    expect(existsSync(join(home, "shortlinks.db"))).toBe(false);
  });
});

describe("transport report", () => {
  test("hosted resolution reports the source of the authority and the credential", () => {
    const home = tempHome();
    const store = resolveStore(
      env(home, {
        HASNA_SHORTLINKS_API_URL: "https://shortlinks.report.test",
        HASNA_SHORTLINKS_API_KEY: "report-key",
      }),
    ) as CloudShortlinksStore;
    expect(store.kind).toBe("http");
    expect(store.baseUrl).toBe("https://shortlinks.report.test/v1");
    void store.close();
  });

  test("missingBackendMessage names the chain tiers and the local opt-in", () => {
    const message = missingBackendMessage();
    expect(message).toContain("hasna.credentials.shortlinks.api-key");
    expect(message).toContain("~/.hasna/shortlinks/config/credentials");
    expect(message).toContain("HASNA_SHORTLINKS_API_KEY");
    expect(message).toContain("HASNA_SHORTLINKS_API_URL");
    expect(message).toContain(`${LOCAL_OPT_IN_ENV_KEY}=1`);
    expect(message).toContain("--db <path>");
    expect(message).toContain("never falls back to local storage");
    expect(message).not.toMatch(/local-fallback/);
  });
});

describe("explicit local opt-in", () => {
  test("an explicit dbPath opts into the on-box SQLite store", () => {
    const home = tempHome();
    const dbPath = join(home, "explicit.db");
    const store = resolveStore(env(home), { dbPath, notice: quiet });
    expect(store.kind).toBe("local");
    void store.close();
    expect(existsSync(dbPath)).toBe(true);
  });

  test("HASNA_SHORTLINKS_LOCAL=1 opts into the on-box SQLite store without a dbPath", () => {
    const home = tempHome();
    const previousHome = process.env.SHORTLINKS_HOME;
    process.env.SHORTLINKS_HOME = home;
    try {
      const store = resolveStore(env(home, { [LOCAL_OPT_IN_ENV_KEY]: "1" }), { notice: quiet });
      expect(store.kind).toBe("local");
      void store.close();
      expect(existsSync(join(home, "shortlinks.db"))).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env.SHORTLINKS_HOME;
      else process.env.SHORTLINKS_HOME = previousHome;
    }
  });

  test("the legacy SHORTLINKS_LOCAL alias still opts in", () => {
    const home = tempHome();
    const store = resolveStore(env(home, { SHORTLINKS_LOCAL: "1" }), { notice: quiet });
    expect(store.kind).toBe("local");
    void store.close();
  });

  test("local opt-in is an explicit choice: 0/false/no/off do not select local", () => {
    for (const value of ["0", "false", "no", "off", ""]) {
      const home = tempHome();
      const error = () => resolveStore(env(home, { [LOCAL_OPT_IN_ENV_KEY]: value }));
      expect(error).toThrow(/HASNA_SHORTLINKS_API_URL/);
    }
  });

  test("isLocalOptIn accepts truthy values and rejects falsy ones, on both spellings", () => {
    for (const key of LOCAL_OPT_IN_ENV_KEYS) {
      for (const value of ["1", "true", "TRUE", "yes", "on"]) {
        expect(isLocalOptIn({ [key]: value })).toBe(true);
      }
      for (const value of ["0", "false", "no", "off", ""]) {
        expect(isLocalOptIn({ [key]: value })).toBe(false);
      }
    }
    expect(isLocalOptIn({})).toBe(false);
  });
});