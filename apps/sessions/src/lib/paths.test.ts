import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import {
  adoptResolverDataRoot,
  getEffectiveSessionsDir,
  getLegacySessionsDir,
  getResolverSessionsDir,
  getSessionsDbPath,
  getSessionsDir,
} from "./paths.js";

describe("sessions package state paths", () => {
  let tempRoot: string;
  let originalHome: string | undefined;
  let originalUserProfile: string | undefined;
  let originalSessionsDir: string | undefined;
  let originalSessionsDbPath: string | undefined;
  let originalLegacyDbPath: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "sessions-paths-"));
    originalHome = process.env.HOME;
    originalUserProfile = process.env.USERPROFILE;
    originalSessionsDir = process.env.HASNA_SESSIONS_DIR;
    originalSessionsDbPath = process.env.HASNA_SESSIONS_DB_PATH;
    originalLegacyDbPath = process.env.SESSIONS_DB_PATH;
    process.env.HOME = join(tempRoot, "home");
    delete process.env.USERPROFILE;
    delete process.env.HASNA_SESSIONS_DIR;
    delete process.env.HASNA_SESSIONS_DB_PATH;
    delete process.env.SESSIONS_DB_PATH;
  });

  afterEach(() => {
    restoreEnv("HOME", originalHome);
    restoreEnv("USERPROFILE", originalUserProfile);
    restoreEnv("HASNA_SESSIONS_DIR", originalSessionsDir);
    restoreEnv("HASNA_SESSIONS_DB_PATH", originalSessionsDbPath);
    restoreEnv("SESSIONS_DB_PATH", originalLegacyDbPath);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("copies legacy sessions.db into ~/.hasna/sessions", () => {
    const home = process.env.HOME!;
    const legacyDb = join(home, ".sessions", "sessions.db");
    const newDir = join(home, ".hasna", "sessions");
    const newDb = join(newDir, "sessions.db");
    mkdirSync(join(home, ".sessions"), { recursive: true });
    writeFileSync(legacyDb, "legacy-db");

    expect(getSessionsDir()).toBe(newDir);
    expect(getSessionsDbPath()).toBe(newDb);
    expect(readFileSync(newDb, "utf8")).toBe("legacy-db");
    expect(existsSync(legacyDb)).toBe(true);
  });

  test("does not overwrite an existing ~/.hasna/sessions database", () => {
    const home = process.env.HOME!;
    const legacyDb = join(home, ".sessions", "sessions.db");
    const newDb = join(home, ".hasna", "sessions", "sessions.db");
    mkdirSync(join(home, ".sessions"), { recursive: true });
    mkdirSync(join(home, ".hasna", "sessions"), { recursive: true });
    writeFileSync(legacyDb, "legacy-db");
    writeFileSync(newDb, "new-db");

    expect(getSessionsDbPath()).toBe(newDb);
    expect(readFileSync(newDb, "utf8")).toBe("new-db");
  });
});

describe("resolver (XDG) data-root resolution", () => {
  const ENV_KEYS = [
    "HOME",
    "USERPROFILE",
    "HASNA_DATA_HOME",
    "HASNA_CACHE_HOME",
    "HASNA_SESSIONS_DIR",
    "HASNA_SESSIONS_DB_PATH",
    "SESSIONS_DB_PATH",
  ] as const;
  let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  let tempRoot: string | null = null;
  const cleanups: string[] = [];

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    tempRoot = mkdtempSync(join(tmpdir(), "sessions-resolver-"));
    process.env.HOME = join(tempRoot, "home");
    delete process.env.USERPROFILE;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved = {};
    for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
    if (tempRoot !== null) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  function xdgRoot(): string {
    return join(process.env.HOME!, ".local", "share", "hasna", "sessions");
  }

  test("legacy ~/.hasna/sessions stays the effective root until adopted", () => {
    expect(adoptResolverDataRoot(getResolverSessionsDir())).toBe(false);
    expect(getEffectiveSessionsDir()).toBe(getLegacySessionsDir());
    expect(getSessionsDir()).toBe(join(process.env.HOME!, ".hasna", "sessions"));
    expect(getSessionsDbPath()).toBe(
      join(process.env.HOME!, ".hasna", "sessions", "sessions.db")
    );
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data root", () => {
    const base = mkdtempSync(join(tmpdir(), "sessions-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataRoot(getResolverSessionsDir())).toBe(true);
    expect(getEffectiveSessionsDir()).toBe(join(base, "sessions"));
    expect(getSessionsDir()).toBe(join(base, "sessions"));
    expect(getSessionsDbPath()).toBe(join(base, "sessions", "sessions.db"));
  });

  test("an existing store at the resolver data root adopts it even without HASNA_DATA_HOME", () => {
    const xdg = xdgRoot();
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "sessions.db"), "existing-migrated-store");
    expect(adoptResolverDataRoot(getResolverSessionsDir())).toBe(true);
    expect(getEffectiveSessionsDir()).toBe(xdg);
    expect(getSessionsDbPath()).toBe(join(xdg, "sessions.db"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const cache = mkdtempSync(join(tmpdir(), "sessions-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataRoot(getResolverSessionsDir())).toBe(false);
    expect(getEffectiveSessionsDir()).toBe(join(process.env.HOME!, ".hasna", "sessions"));
    expect(getSessionsDbPath()).toBe(
      join(process.env.HOME!, ".hasna", "sessions", "sessions.db")
    );
  });

  test("the app-specific HASNA_SESSIONS_DIR override keeps precedence above the resolver default", () => {
    const explicit = mkdtempSync(join(tmpdir(), "sessions-explicit-")); cleanups.push(explicit);
    process.env.HASNA_DATA_HOME = mkdtempSync(join(tmpdir(), "sessions-data-home-"));
    cleanups.push(process.env.HASNA_DATA_HOME!);
    process.env.HASNA_SESSIONS_DIR = explicit;
    expect(getSessionsDir()).toBe(explicit);
    expect(getSessionsDbPath()).toBe(join(explicit, "sessions.db"));
  });

  test("the app-specific HASNA_SESSIONS_DB_PATH override keeps precedence above the resolver default", () => {
    const explicit = join(mkdtempSync(join(tmpdir(), "sessions-db-explicit-")), "db", "custom.db");
    cleanups.push(dirname(dirname(explicit)));
    process.env.HASNA_DATA_HOME = mkdtempSync(join(tmpdir(), "sessions-data-home-"));
    cleanups.push(process.env.HASNA_DATA_HOME!);
    process.env.HASNA_SESSIONS_DB_PATH = explicit;
    expect(getSessionsDbPath()).toBe(explicit);
  });
});

describe("handoff handoffs dir follows the effective sessions data root", () => {
  const ENV_KEYS = ["HOME", "USERPROFILE", "HASNA_DATA_HOME", "HASNA_SESSIONS_DIR"] as const;
  let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  let tempRoot: string | null = null;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    tempRoot = mkdtempSync(join(tmpdir(), "sessions-handoff-"));
    process.env.HOME = join(tempRoot, "home");
    delete process.env.USERPROFILE;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    saved = {};
    if (tempRoot !== null) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  test("handoffs land under the legacy root until adopted, then under the resolver root", async () => {
    const { createExternalHandoffBundleV1 } = await import("./handoff.js");
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Legacy default: handoffs under ~/.hasna/sessions/handoffs
    const legacy = createExternalHandoffBundleV1({
      target: "codewith",
      cwd: tempRoot!,
      dryRun: true,
      env,
    });
    expect(legacy.handoffs_dir).toBe(join(tempRoot!, "home", ".hasna", "sessions", "handoffs"));

    // HASNA_DATA_HOME adopted: handoffs under $HASNA_DATA_HOME/sessions/handoffs
    const base = mkdtempSync(join(tmpdir(), "sessions-handoff-data-"));
    try {
      env.HASNA_DATA_HOME = base;
      const adopted = createExternalHandoffBundleV1({
        target: "codewith",
        cwd: tempRoot!,
        dryRun: true,
        env,
      });
      expect(adopted.handoffs_dir).toBe(join(base, "sessions", "handoffs"));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
