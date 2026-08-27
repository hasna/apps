import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  adoptResolverHome,
  exactEventsHome,
  getEventsHome,
  HASNA_EVENTS_DIR_ENV,
  HASNA_EVENTS_HOME_ENV,
  legacyHomeDir,
  resolverHome,
} from "./app-home.js";

const ENV_KEYS = [HASNA_EVENTS_DIR_ENV, HASNA_EVENTS_HOME_ENV, "HASNA_DATA_HOME", "HASNA_CACHE_HOME"] as const;
const ORIGINAL_ENV: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) ORIGINAL_ENV[key] = process.env[key];
const TEMP_DIRS: string[] = [];

function resetEnv(): void {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
}

beforeEach(resetEnv);

afterEach(() => {
  resetEnv();
  for (const dir of TEMP_DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hasna-events-app-home-"));
  TEMP_DIRS.push(dir);
  return dir;
}

describe("app-home resolution", () => {
  test("legacy ~/.hasna/events is the default when no override and no resolver adoption", () => {
    const home = getEventsHome();
    expect(home).toBe(legacyHomeDir());
    expect(home).toContain(".hasna");
    expect(home.endsWith("events")).toBe(true);
  });

  test("HASNA_EVENTS_DIR exact override wins unconditionally", () => {
    const dir = makeTempDir();
    process.env[HASNA_EVENTS_DIR_ENV] = dir;
    expect(getEventsHome()).toBe(dir);
  });

  test("HASNA_EVENTS_HOME fallback applies when only the legacy fallback is set", () => {
    const dir = makeTempDir();
    process.env[HASNA_EVENTS_HOME_ENV] = dir;
    expect(getEventsHome()).toBe(dir);
  });

  test("HASNA_EVENTS_DIR wins over HASNA_EVENTS_HOME", () => {
    const dirA = makeTempDir();
    const dirB = makeTempDir();
    process.env[HASNA_EVENTS_HOME_ENV] = dirB;
    process.env[HASNA_EVENTS_DIR_ENV] = dirA;
    expect(getEventsHome()).toBe(dirA);
  });

  test("empty exact-app overrides are treated as unset", () => {
    process.env[HASNA_EVENTS_DIR_ENV] = "";
    process.env[HASNA_EVENTS_HOME_ENV] = "   ";
    expect(exactEventsHome()).toBeUndefined();
    expect(getEventsHome()).toBe(legacyHomeDir());
  });

  test("resolver home is adopted when HASNA_DATA_HOME is set", () => {
    const dataHome = makeTempDir();
    process.env.HASNA_DATA_HOME = dataHome;
    const resolved = resolverHome();
    expect(resolved).toBe(join(dataHome, "events"));
    expect(adoptResolverHome(resolved)).toBe(true);
    expect(getEventsHome()).toBe(resolved);
  });

  test("resolver home is adopted when the store was migrated there (events.json exists)", () => {
    const dataHome = makeTempDir();
    const storeDir = join(dataHome, "events");
    mkdirSync(storeDir, { recursive: true });
    writeFileSync(join(storeDir, "events.json"), "[]\n");
    process.env.HASNA_DATA_HOME = dataHome;
    const resolved = resolverHome();
    expect(resolved).toBe(storeDir);
    // The file-existence adoption gate holds independently of the env override.
    expect(adoptResolverHome(storeDir, {})).toBe(true);
    expect(getEventsHome()).toBe(resolved);
  });

  test("legacy home stays effective when only a non-data kind is redirected", () => {
    const dataHome = makeTempDir();
    const storeDir = join(dataHome, "events");
    // A machine that redirects only a non-data kind (e.g. cache) must not have
    // its data home moved: with no HASNA_DATA_HOME and no store at the resolver
    // data home, adoption is refused.
    expect(adoptResolverHome(storeDir, { HASNA_CACHE_HOME: makeTempDir() })).toBe(false);
    expect(getEventsHome()).toBe(legacyHomeDir());
  });

  test("resolver home resolves under the XDG data root for the events app", () => {
    const dataHome = makeTempDir();
    process.env.HASNA_DATA_HOME = dataHome;
    expect(resolverHome()).toBe(join(dataHome, "events"));
  });
});
