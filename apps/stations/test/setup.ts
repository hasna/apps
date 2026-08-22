import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The product defaults to ~/.hasna/stations when no explicit route is set.
// That is correct for the CLI and unsafe for its own tests: a developer's live
// manifest or database can change assertions, and tests may write to them.
// Clear the higher-precedence path overrides once, before test imports, then
// pin the package-owned default root to disposable per-process storage. Tests
// remain free to set focused overrides after this preload runs.
export const TEST_PATH_ENV_VARS = [
  "HASNA_STATIONS_DB_PATH",
  "HASNA_STATIONS_MANIFEST_PATH",
  "HASNA_STATIONS_NOTIFICATIONS_PATH",
  "HASNA_STATIONS_FREEZE_PATH",
  "HASNA_STATIONS_ROLLOUT_RECORDS_PATH",
  "HASNA_STATIONS_ROSTER_CONFIG_PATH",
  "HASNA_STATIONS_ROSTER_RECORDS_PATH",
  "HASNA_STATIONS_ROSTER_HEARTBEAT_PATH",
  "HASNA_STATIONS_CLIPBOARD_KEY_PATH",
  "HASNA_STATIONS_CLIPBOARD_HISTORY_PATH",
] as const;

for (const key of TEST_PATH_ENV_VARS) delete process.env[key];

const testRoot = mkdtempSync(join(tmpdir(), "stations-test-store-"));
const testHome = join(testRoot, "home");
const testData = join(testHome, ".hasna", "stations");
mkdirSync(testData, { recursive: true });

// HOME is the fallback route. Keep it isolated too, so a focused path test
// that deletes HASNA_STATIONS_DIR cannot reconnect later tests to live state.
process.env.HOME = testHome;
process.env.USERPROFILE = testHome;
process.env.HASNA_STATIONS_DIR = testData;
process.env.HASNA_EVENTS_DIR = join(testHome, ".hasna", "events");

process.once("exit", () => {
  try {
    rmSync(testRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  } catch {
    // Cleanup is best-effort and must not change the test result.
  }
});
