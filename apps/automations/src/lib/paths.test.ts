import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  automationsDataDir,
  automationsDbPath,
  daemonLogPath,
  daemonPidFilePath,
  ensureAutomationsDataDir,
} from "./paths.js";

const originalPrimaryDir = process.env.HASNA_AUTOMATIONS_DIR;
const originalLegacyDir = process.env.AUTOMATIONS_DATA_DIR;
let scratchDir = "";

beforeEach(() => {
  scratchDir = mkdtempSync(join(tmpdir(), "automations-paths-"));
  delete process.env.HASNA_AUTOMATIONS_DIR;
  delete process.env.AUTOMATIONS_DATA_DIR;
});

afterEach(() => {
  if (originalPrimaryDir === undefined) delete process.env.HASNA_AUTOMATIONS_DIR;
  else process.env.HASNA_AUTOMATIONS_DIR = originalPrimaryDir;
  if (originalLegacyDir === undefined) delete process.env.AUTOMATIONS_DATA_DIR;
  else process.env.AUTOMATIONS_DATA_DIR = originalLegacyDir;
  rmSync(scratchDir, { recursive: true, force: true });
});

describe("automations data paths", () => {
  test("uses the package-specific environment variable before the legacy alias", () => {
    const primary = join(scratchDir, "primary");
    const legacy = join(scratchDir, "legacy");
    process.env.HASNA_AUTOMATIONS_DIR = primary;
    process.env.AUTOMATIONS_DATA_DIR = legacy;

    expect(automationsDataDir()).toBe(primary);
  });

  test("falls back from an empty primary value to the legacy alias", () => {
    const legacy = join(scratchDir, "legacy");
    process.env.HASNA_AUTOMATIONS_DIR = "";
    process.env.AUTOMATIONS_DATA_DIR = legacy;

    expect(automationsDataDir()).toBe(legacy);
  });

  test("uses the documented home-relative default when no override is set", () => {
    expect(automationsDataDir()).toBe(join(homedir(), ".hasna", "automations"));
  });

  test("creates a private data directory recursively", () => {
    const nested = join(scratchDir, "nested", "automations");
    process.env.HASNA_AUTOMATIONS_DIR = nested;

    expect(ensureAutomationsDataDir()).toBe(nested);
    expect(statSync(nested).isDirectory()).toBe(true);
    expect(statSync(nested).mode & 0o777).toBe(0o700);
  });

  test("derives every owned file from the same resolved directory", () => {
    const dataDir = join(scratchDir, "data");
    process.env.HASNA_AUTOMATIONS_DIR = dataDir;

    expect(automationsDbPath()).toBe(join(dataDir, "automations.db"));
    expect(daemonPidFilePath()).toBe(join(dataDir, "daemon.pid"));
    expect(daemonLogPath()).toBe(join(dataDir, "daemon.log"));
  });
});
