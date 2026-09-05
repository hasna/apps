/**
 * Single paths resolver (rulling hasna/apps#1668) — the one implementation
 * every app resolves its local roots through. These tests pin the ruled
 * placement: `~/.hasna/<app>/` on macOS for every kind, XDG on other
 * platforms, kind-level `HASNA_<KIND>_HOME` overrides first.
 */
import { describe, expect, test } from "bun:test";
import {
  PATH_KIND_ENV,
  baseDir,
  cacheDir,
  configDir,
  dataDir,
  effectiveHome,
  kindEnv,
  resolveDir,
  stateDir,
} from "../src/paths";

const HOME = "/home/tester";
const env = (extra: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  HOME,
  ...extra,
});

describe("contracts paths resolver", () => {
  test("macOS: every kind resolves under ~/.hasna/<app>", () => {
    const opts = { app: "emails", platform: "darwin", home: HOME, env: env() };
    expect(dataDir(opts)).toBe(`${HOME}/.hasna/emails`);
    expect(configDir(opts)).toBe(`${HOME}/.hasna/emails`);
    expect(stateDir(opts)).toBe(`${HOME}/.hasna/emails`);
    expect(cacheDir(opts)).toBe(`${HOME}/.hasna/emails`);
  });

  test("macOS: internal nesting", () => {
    expect(dataDir({ app: "emails", internal: true, platform: "darwin", home: HOME, env: env() })).toBe(
      `${HOME}/.hasna/internal/emails`,
    );
  });

  test("linux: XDG placement per kind", () => {
    const opts = { app: "emails", platform: "linux", home: HOME, env: env() };
    expect(configDir(opts)).toBe(`${HOME}/.config/hasna/emails`);
    expect(dataDir(opts)).toBe(`${HOME}/.local/share/hasna/emails`);
    expect(stateDir(opts)).toBe(`${HOME}/.local/state/hasna/emails`);
    expect(cacheDir(opts)).toBe(`${HOME}/.cache/hasna/emails`);
  });

  test("kind-level overrides win on every platform, keeping the app segment", () => {
    const opts = {
      app: "emails",
      platform: "darwin",
      home: HOME,
      env: env({ HASNA_DATA_HOME: "/data/home", HASNA_CACHE_HOME: "/cache/home" }),
    };
    expect(dataDir(opts)).toBe("/data/home/emails");
    expect(cacheDir(opts)).toBe("/cache/home/emails");
    expect(configDir(opts)).toBe(`${HOME}/.hasna/emails`); // unset kinds keep the platform layout
  });

  test("empty-string kind override is ignored (parity with @hasna/paths)", () => {
    const opts = { app: "emails", platform: "linux", home: HOME, env: env({ HASNA_DATA_HOME: "" }) };
    expect(dataDir(opts)).toBe(`${HOME}/.local/share/hasna/emails`);
  });

  test("the passed env drives both override lookup and home", () => {
    const opts = { app: "emails", platform: "darwin", env: env({ HOME: "/custom" }) };
    expect(dataDir(opts)).toBe("/custom/.hasna/emails");
  });

  test("resolveDir/baseDir expose the seam", () => {
    expect(baseDir("data", { app: "x", platform: "darwin", home: HOME, env: env() })).toBe(`${HOME}/.hasna`);
    expect(resolveDir("data", { app: "x", platform: "linux", home: HOME, env: env() })).toBe(
      `${HOME}/.local/share/hasna/x`,
    );
  });

  test("kindEnv maps kinds to HASNA_<KIND>_HOME", () => {
    expect(kindEnv("config")).toBe("HASNA_CONFIG_HOME");
    expect(kindEnv("data")).toBe("HASNA_DATA_HOME");
    expect(kindEnv("state")).toBe("HASNA_STATE_HOME");
    expect(kindEnv("cache")).toBe("HASNA_CACHE_HOME");
    expect(PATH_KIND_ENV.data).toBe("HASNA_DATA_HOME");
  });

  test("invalid kind or app slug throws TypeError", () => {
    expect(() => kindEnv("bogus" as never)).toThrow(TypeError);
    expect(() => dataDir({ app: "", platform: "darwin", home: HOME, env: env() })).toThrow(TypeError);
    expect(() => dataDir({ app: "Emails", platform: "darwin", home: HOME, env: env() })).toThrow(TypeError);
    expect(() => dataDir({ app: "emails_x", platform: "darwin", home: HOME, env: env() })).toThrow(TypeError);
  });

  test("effectiveHome: $HOME first, then $USERPROFILE", () => {
    expect(effectiveHome(env())).toBe(HOME);
    expect(effectiveHome(env({ HOME: undefined, USERPROFILE: "/win/users/t" }))).toBe("/win/users/t");
  });
});