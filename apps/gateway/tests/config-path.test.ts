import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalGatewayConfigPath,
  resolveDefaultConfigPath,
  migrateLegacyConfigFile,
  GATEWAY_CONFIG_FILENAME,
} from "../src/config-path";

let fakeHome: string;
let fakeCwd: string;
let previousHome: string | undefined;
let previousUserProfile: string | undefined;

function legacyPath(): string {
  return join(fakeCwd, GATEWAY_CONFIG_FILENAME);
}

function canonicalPath(): string {
  return canonicalGatewayConfigPath(fakeHome);
}

beforeEach(() => {
  fakeHome = mkdtempSync(join(tmpdir(), "ok-gateway-home-"));
  fakeCwd = mkdtempSync(join(tmpdir(), "ok-gateway-cwd-"));
  previousHome = process.env.HOME;
  previousUserProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = previousUserProfile;
  rmSync(fakeHome, { recursive: true, force: true });
  rmSync(fakeCwd, { recursive: true, force: true });
});

describe("canonical gateway config path", () => {
  test("default config path resolves to ~/.hasna/gateway/gateway.config.json under a fake HOME", () => {
    expect(canonicalPath()).toBe(join(fakeHome, ".hasna", "gateway", "gateway.config.json"));
  });

  test("resolveDefaultConfigPath returns the canonical path when nothing exists anywhere", () => {
    const resolved = resolveDefaultConfigPath({ cwd: fakeCwd, home: fakeHome });
    expect(resolved).toBe(canonicalPath());
  });

  test("GATEWAY_CONFIG_PATH env override still wins over the canonical default", () => {
    const override = join(fakeCwd, "custom-config.json");
    writeFileSync(override, '{ "providers": [] }\n');
    writeFileSync(legacyPath(), '{ "providers": [] }\n');
    const resolved = resolveDefaultConfigPath({
      cwd: fakeCwd,
      home: fakeHome,
      env: { GATEWAY_CONFIG_PATH: override },
    });
    expect(resolved).toBe(override);
    // The override wins without touching the canonical location.
    expect(existsSync(canonicalPath())).toBe(false);
  });
});

describe("legacy config migration", () => {
  test("migrateLegacyConfigFile dry-run reports but copies nothing", () => {
    const legacy = legacyPath();
    writeFileSync(legacy, '{ "providers": [] }\n');
    const result = migrateLegacyConfigFile({ cwd: fakeCwd, home: fakeHome, dryRun: true });
    expect(result.migrated).toBe(true);
    expect(result.to).toBe(canonicalPath());
    expect(existsSync(canonicalPath())).toBe(false);
    expect(existsSync(legacy)).toBe(true);
  });

  test("first default resolution copies the legacy cwd config into the canonical location and leaves the legacy file in place", () => {
    const legacy = legacyPath();
    writeFileSync(legacy, '{ "providers": [], "models": [] }\n');
    const resolved = resolveDefaultConfigPath({ cwd: fakeCwd, home: fakeHome });
    expect(resolved).toBe(canonicalPath());
    expect(existsSync(canonicalPath())).toBe(true);
    expect(existsSync(legacy)).toBe(true);
    expect(readFileSync(canonicalPath(), "utf8")).toBe('{ "providers": [], "models": [] }\n');
  });

  test("migration is idempotent: a second resolution does not overwrite or re-copy", () => {
    const legacy = legacyPath();
    writeFileSync(legacy, '{ "providers": [] }\n');
    resolveDefaultConfigPath({ cwd: fakeCwd, home: fakeHome });
    const canonicalContent = readFileSync(canonicalPath(), "utf8");
    writeFileSync(legacy, '{ "providers": [], "changed": true }\n');
    const resolved = resolveDefaultConfigPath({ cwd: fakeCwd, home: fakeHome });
    expect(resolved).toBe(canonicalPath());
    expect(readFileSync(canonicalPath(), "utf8")).toBe(canonicalContent);
  });

  test("existing canonical data is never overwritten by the legacy file", () => {
    mkdirSync(join(fakeHome, ".hasna", "gateway"), { recursive: true });
    writeFileSync(canonicalPath(), '{ "providers": [], "models": [] }\n');
    writeFileSync(legacyPath(), '{ "providers": [], "malicious": true }\n');
    const result = migrateLegacyConfigFile({ cwd: fakeCwd, home: fakeHome });
    expect(result.migrated).toBe(false);
    expect(readFileSync(canonicalPath(), "utf8")).toBe('{ "providers": [], "models": [] }\n');
  });

  test("no legacy config present means no migration and the canonical path is still the default", () => {
    const result = migrateLegacyConfigFile({ cwd: fakeCwd, home: fakeHome });
    expect(result.migrated).toBe(false);
    expect(result.reason).toContain("no legacy config");
    expect(resolveDefaultConfigPath({ cwd: fakeCwd, home: fakeHome })).toBe(canonicalPath());
  });
});
