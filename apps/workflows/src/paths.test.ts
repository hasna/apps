import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP,
  STORE_DB_FILE,
  adoptResolverDataDir,
  getEffectiveDataDir,
  getHomeDir,
  getLegacyDataDir,
  getResolverDataDir,
} from "./paths.js";

function withTempHome(fn: (home: string) => void): void {
  const home = mkdtempSync(join(tmpdir(), "workflows-paths-"));
  try {
    fn(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const envOf = (home: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  HOME: home,
  ...extra,
});

describe("workflows paths resolver", () => {
  test("APP is the workflows slug", () => {
    expect(APP).toBe("workflows");
  });

  test("getHomeDir resolves HOME, then USERPROFILE, then os.homedir", () => {
    expect(getHomeDir({ HOME: "/home/u" })).toBe("/home/u");
    expect(getHomeDir({ USERPROFILE: "C:\\Users\\u" })).toBe("C:\\Users\\u");
    expect(getHomeDir({})).toBeTruthy();
  });

  test("getLegacyDataDir resolves to ~/.hasna/workflows", () => {
    withTempHome((home) => {
      expect(getLegacyDataDir(envOf(home))).toBe(join(home, ".hasna", "workflows"));
    });
  });

  test("getResolverDataDir resolves the XDG data home on linux", () => {
    withTempHome((home) => {
      expect(getResolverDataDir(envOf(home))).toBe(join(home, ".local", "share", "hasna", "workflows"));
    });
  });

  test("getResolverDataDir honors HASNA_DATA_HOME as the data-kind override", () => {
    withTempHome((home) => {
      expect(getResolverDataDir(envOf(home, { HASNA_DATA_HOME: "/srv/data" }))).toBe(
        join("/srv/data", "workflows"),
      );
    });
  });

  test("adoptResolverDataDir is false with no HASNA_DATA_HOME and no migrated store", () => {
    withTempHome((home) => {
      const resolved = getResolverDataDir(envOf(home));
      expect(adoptResolverDataDir(resolved, envOf(home))).toBe(false);
    });
  });

  test("adoptResolverDataDir is true when HASNA_DATA_HOME is set", () => {
    withTempHome((home) => {
      const env = envOf(home, { HASNA_DATA_HOME: "/srv/data" });
      expect(adoptResolverDataDir(getResolverDataDir(env), env)).toBe(true);
    });
  });

  test("adoptResolverDataDir is true when the store has been migrated to the resolver home", () => {
    withTempHome((home) => {
      const env = envOf(home);
      const resolved = getResolverDataDir(env);
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, STORE_DB_FILE), "sqlite-marker");
      expect(adoptResolverDataDir(resolved, env)).toBe(true);
    });
  });

  test("getEffectiveDataDir stays on the legacy home until adopted", () => {
    withTempHome((home) => {
      expect(getEffectiveDataDir(envOf(home))).toBe(getLegacyDataDir(envOf(home)));
    });
  });

  test("getEffectiveDataDir moves to the resolver home once HASNA_DATA_HOME is set", () => {
    withTempHome((home) => {
      const env = envOf(home, { HASNA_DATA_HOME: "/srv/data" });
      expect(getEffectiveDataDir(env)).toBe(join("/srv/data", "workflows"));
    });
  });

  test("getEffectiveDataDir moves to the resolver home once the store is migrated there", () => {
    withTempHome((home) => {
      const env = envOf(home);
      const resolved = getResolverDataDir(env);
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, STORE_DB_FILE), "sqlite-marker");
      expect(getEffectiveDataDir(env)).toBe(resolved);
    });
  });
});
