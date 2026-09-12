import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { makeTempRoot } from "../lib/test-temp-root";

/**
 * `init --force` promises a fresh start. The route through the Store means two
 * very different outcomes share one `reset()` call:
 *
 *  - CloudConfigStore REFUSES by design — you cannot force-wipe the shared
 *    hosted store. That is an expected answer: warn, and let initialization
 *    continue against the hosted store.
 *  - LocalConfigStore WIPES the on-disk SQLite db. A failure there means the
 *    requested fresh start did not happen (root-owned db from a prior `sudo
 *    init`, a read-only or NFS home, the immutable bit), so it must abort and
 *    exit non-zero — never warn and then report a successful init over a db that
 *    still holds every old row.
 *
 * Treating both as a warning made the second case silent: the db survived
 * intact while the command printed "✓ Synced" and exited 0.
 */

const LOCAL_OPT_IN_ENV = "HASNA_INSTRUCTIONS_LOCAL";
const DB_PATH_ENV = "HASNA_INSTRUCTIONS_DB_PATH";

/** Every name that can select a hosted transport, for a scrubbed probe. */
const AUTHORITY_SCRUB = [
  "HASNA_INSTRUCTIONS_API_URL",
  "HASNA_INSTRUCTIONS_API_KEY",
  "INSTRUCTIONS_API_URL",
  "INSTRUCTIONS_API_KEY",
  "HASNA_INSTRUCTIONS_API_KEY_OVERRIDE",
  "HASNA_INSTRUCTIONS_API_KEY_REF",
  "HASNA_PROFILE",
  "HASNA_CONFIGS_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_DATA_HOME",
  "HASNA_STATE_HOME",
  "HASNA_CACHE_HOME",
];

/** True when the process can be blocked by a file mode. Root cannot. */
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

function runInit(home: string, dbPath: string) {
  const childEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of AUTHORITY_SCRUB) delete childEnv[key];
  return spawnSync("bun", ["src/cli/index.tsx", "init", "--force"], {
    cwd: join(import.meta.dir, "../.."),
    encoding: "utf8",
    env: { ...childEnv, HOME: home, USER: "tester", [LOCAL_OPT_IN_ENV]: "1", [DB_PATH_ENV]: dbPath, NO_COLOR: "1", FORCE_COLOR: "0" },
  });
}

describe("init --force reset failure", () => {
  test.skipIf(isRoot)("a local reset that really failed aborts instead of reporting success", () => {
    const home = makeTempRoot("init-force-");
    const storeDir = join(home, "store");
    mkdirSync(storeDir, { recursive: true });
    const dbPath = join(storeDir, "instructions.db");

    // A first init creates the db the force-reset is supposed to discard.
    const first = spawnSync("bun", ["src/cli/index.tsx", "init"], {
      cwd: join(import.meta.dir, "../.."),
      encoding: "utf8",
      env: { ...(process.env as Record<string, string>), HOME: home, USER: "tester", [LOCAL_OPT_IN_ENV]: "1", [DB_PATH_ENV]: dbPath, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    expect(first.status).toBe(0);
    expect(existsSync(dbPath)).toBe(true);
    const before = statSync(dbPath).ino;

    // The db cannot be unlinked: the directory is read-only. It stays readable,
    // so everything after the reset still succeeds — the run looks green.
    chmodSync(storeDir, 0o500);
    try {
      const forced = runInit(home, dbPath);
      expect(forced.status).not.toBe(0);
      expect(forced.stderr).toContain("permission denied");
      // The failed reset was a real failure, not an incidental one: the old db
      // is still there, so reporting success would have been a lie.
      expect(existsSync(dbPath)).toBe(true);
      expect(statSync(dbPath).ino).toBe(before);
    } finally {
      chmodSync(storeDir, 0o700);
    }
  });

  test("the cloud store's refusal stays a warning and initialization continues", () => {
    const home = makeTempRoot("init-force-cloud-");
    const childEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
    for (const key of AUTHORITY_SCRUB) delete childEnv[key];
    // An unroutable endpoint: the refusal is the point, the sync failure that
    // follows it is incidental and must not be what aborts the run.
    const result = spawnSync("bun", ["src/cli/index.tsx", "init", "--force"], {
      cwd: join(import.meta.dir, "../.."),
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...childEnv,
        HOME: home,
        USER: "tester",
        HASNA_INSTRUCTIONS_API_URL: "http://127.0.0.1:1",
        HASNA_INSTRUCTIONS_API_KEY: "not-a-real-key",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      },
    });
    expect(result.stderr).toContain("cannot wipe the shared hosted store");
    // The warning did not abort: initialization reached the sync step.
    expect(result.stdout).toContain("initializing");
  });
});
