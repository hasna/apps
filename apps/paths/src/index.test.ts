/**
 * Tests for the @hasna/paths resolver.
 *
 * The resolver is pure and injectable (home/platform/env), so every default
 * and override is asserted deterministically against a fixed fake home
 * rather than the machine's real environment. One live smoke test at the
 * bottom exercises the real process.env/process.platform path.
 */

import { describe, test, expect } from "bun:test";
import {
  baseDir,
  cacheDir,
  configDir,
  dataDir,
  dirs,
  resolvePath,
  stateDir,
  PATH_KINDS,
  type PathKind,
  type PathsOptions,
} from "./index";

function opts(partial: Partial<PathsOptions> = {}): PathsOptions {
  return { app: "todos", platform: "linux", home: "/home/user", ...partial };
}

const MAC: Partial<PathsOptions> = { platform: "darwin", home: "/Users/user" };

describe("Linux / XDG defaults", () => {
  test("config, data, state, cache resolve under the XDG hasna roots", () => {
    expect(configDir(opts())).toBe("/home/user/.config/hasna/todos");
    expect(dataDir(opts())).toBe("/home/user/.local/share/hasna/todos");
    expect(stateDir(opts())).toBe("/home/user/.local/state/hasna/todos");
    expect(cacheDir(opts())).toBe("/home/user/.cache/hasna/todos");
  });

  test("resolvePath is per-kind and per-app", () => {
    expect(resolvePath("config", opts())).toBe(configDir(opts()));
    expect(dataDir(opts({ app: "mailery" }))).toBe("/home/user/.local/share/hasna/mailery");
    expect(dataDir(opts({ app: "mailery" }))).not.toBe(dataDir(opts()));
  });

  test("dirs() returns all four kinds in stable order", () => {
    const all = dirs(opts());
    expect(Object.keys(all)).toEqual([...PATH_KINDS]);
    expect(all).toEqual({
      config: "/home/user/.config/hasna/todos",
      data: "/home/user/.local/share/hasna/todos",
      state: "/home/user/.local/state/hasna/todos",
      cache: "/home/user/.cache/hasna/todos",
    });
  });

  test("baseDir returns the hasna root without the app segment", () => {
    expect(baseDir("config", opts())).toBe("/home/user/.config/hasna");
    expect(baseDir("data", opts())).toBe("/home/user/.local/share/hasna");
    expect(baseDir("state", opts())).toBe("/home/user/.local/state/hasna");
    expect(baseDir("cache", opts())).toBe("/home/user/.cache/hasna");
  });
});

describe("macOS defaults", () => {
  test("config and data share Application Support; cache and state map to their dirs", () => {
    expect(configDir(opts(MAC))).toBe("/Users/user/Library/Application Support/Hasna/todos");
    expect(dataDir(opts(MAC))).toBe("/Users/user/Library/Application Support/Hasna/todos");
    expect(cacheDir(opts(MAC))).toBe("/Users/user/Library/Caches/Hasna/todos");
    expect(stateDir(opts(MAC))).toBe("/Users/user/Library/Logs/Hasna/todos");
  });

  test("macOS baseDir omits the app segment", () => {
    expect(baseDir("data", opts(MAC))).toBe("/Users/user/Library/Application Support/Hasna");
    expect(baseDir("cache", opts(MAC))).toBe("/Users/user/Library/Caches/Hasna");
    expect(baseDir("state", opts(MAC))).toBe("/Users/user/Library/Logs/Hasna");
  });
});

describe("HASNA_*_HOME env overrides", () => {
  test("each kind honors its override, app appended", () => {
    expect(dataDir(opts({ env: { HASNA_DATA_HOME: "/mnt/data" } }))).toBe("/mnt/data/todos");
    expect(configDir(opts({ env: { HASNA_CONFIG_HOME: "/mnt/cfg" } }))).toBe("/mnt/cfg/todos");
    expect(stateDir(opts({ env: { HASNA_STATE_HOME: "/mnt/state" } }))).toBe("/mnt/state/todos");
    expect(cacheDir(opts({ env: { HASNA_CACHE_HOME: "/mnt/cache" } }))).toBe("/mnt/cache/todos");
  });

  test("an override replaces the whole default root for that kind only", () => {
    const all = dirs(opts({ env: { HASNA_DATA_HOME: "/mnt/data" } }));
    expect(all.data).toBe("/mnt/data/todos");
    expect(all.config).toBe("/home/user/.config/hasna/todos");
    expect(all.state).toBe("/home/user/.local/state/hasna/todos");
    expect(all.cache).toBe("/home/user/.cache/hasna/todos");
  });

  test("overrides win on macOS too", () => {
    expect(cacheDir(opts({ ...MAC, env: { HASNA_CACHE_HOME: "/mnt/cache" } }))).toBe(
      "/mnt/cache/todos",
    );
    expect(configDir(opts({ ...MAC, env: { HASNA_CONFIG_HOME: "/mnt/cfg" } }))).toBe(
      "/mnt/cfg/todos",
    );
  });

  test("an empty-string override is treated as unset and falls back to the default", () => {
    expect(dataDir(opts({ env: { HASNA_DATA_HOME: "" } }))).toBe(
      "/home/user/.local/share/hasna/todos",
    );
    expect(configDir(opts({ env: { HASNA_CONFIG_HOME: "" } }))).toBe(
      "/home/user/.config/hasna/todos",
    );
  });

  test("an override that is not a string is ignored", () => {
    const env = { HASNA_DATA_HOME: 42 } as unknown as Record<string, string | undefined>;
    expect(dataDir(opts({ env }))).toBe("/home/user/.local/share/hasna/todos");
  });

  test("baseDir honors the override", () => {
    expect(baseDir("data", opts({ env: { HASNA_DATA_HOME: "/mnt/data" } }))).toBe("/mnt/data");
  });
});

describe("internal apps", () => {
  test("internal apps resolve under hasna/internal/<app> on Linux", () => {
    const i = { internal: true as const };
    expect(configDir(opts(i))).toBe("/home/user/.config/hasna/internal/todos");
    expect(dataDir(opts(i))).toBe("/home/user/.local/share/hasna/internal/todos");
    expect(stateDir(opts(i))).toBe("/home/user/.local/state/hasna/internal/todos");
    expect(cacheDir(opts(i))).toBe("/home/user/.cache/hasna/internal/todos");
  });

  test("internal apps resolve under hasna/internal/<app> on macOS", () => {
    const i = { internal: true as const };
    expect(dataDir(opts({ ...MAC, ...i }))).toBe(
      "/Users/user/Library/Application Support/Hasna/internal/todos",
    );
    expect(cacheDir(opts({ ...MAC, ...i }))).toBe(
      "/Users/user/Library/Caches/Hasna/internal/todos",
    );
  });

  test("internal composition still honors env overrides", () => {
    expect(
      dataDir(opts({ internal: true, env: { HASNA_DATA_HOME: "/mnt/data" } })),
    ).toBe("/mnt/data/internal/todos");
  });

  test("internal and public apps never collide", () => {
    expect(dataDir(opts({ internal: true }))).not.toBe(dataDir(opts()));
  });
});

describe("validation", () => {
  test("a missing app throws", () => {
    expect(() => resolvePath("data", opts({ app: "" }))).toThrow();
    expect(() => resolvePath("data", opts({ app: undefined as unknown as string }))).toThrow();
  });

  test("an app that could escape the root is rejected", () => {
    expect(() => dataDir(opts({ app: ".." }))).toThrow();
    expect(() => dataDir(opts({ app: "../evil" }))).toThrow();
    expect(() => dataDir(opts({ app: "a/b" }))).toThrow();
    expect(() => dataDir(opts({ app: "a\\b" }))).toThrow();
  });

  test("uppercase and non-slug app names are rejected", () => {
    expect(() => dataDir(opts({ app: "ToDos" }))).toThrow();
    expect(() => dataDir(opts({ app: "todos_app" }))).toThrow();
  });

  test("valid slugs resolve", () => {
    expect(dataDir(opts({ app: "hasna-cli" }))).toBe("/home/user/.local/share/hasna/hasna-cli");
    expect(dataDir(opts({ app: "a" }))).toBe("/home/user/.local/share/hasna/a");
  });
});

describe("invalid kind fails closed", () => {
  test("baseDir with an unknown kind throws a clear TypeError instead of returning undefined", () => {
    expect(() => baseDir("logs" as PathKind, opts())).toThrow(/invalid path kind "logs"/);
    expect(() => baseDir("" as PathKind, opts())).toThrow(/invalid path kind/);
  });

  test("resolvePath with an unknown kind throws the same clear error", () => {
    expect(() => resolvePath("logs" as PathKind, opts())).toThrow(/invalid path kind "logs"/);
    expect(() => resolvePath("DATA" as PathKind, opts())).toThrow(/invalid path kind "DATA"/);
  });

  test("the four real kinds still resolve (positive control)", () => {
    expect(configDir(opts())).toBe("/home/user/.config/hasna/todos");
    expect(dataDir(opts())).toBe("/home/user/.local/share/hasna/todos");
    expect(stateDir(opts())).toBe("/home/user/.local/state/hasna/todos");
    expect(cacheDir(opts())).toBe("/home/user/.cache/hasna/todos");
    expect(Object.keys(dirs(opts()))).toEqual([...PATH_KINDS]);
  });
});

describe("live environment smoke", () => {
  test("resolvePath against the real process produces an absolute path under the detected platform", () => {
    const p = resolvePath("data", { app: "todos" });
    expect(p.startsWith("/")).toBe(true);
    // The resolved path must always end with the app segment.
    expect(p.endsWith("/todos")).toBe(true);
  });
});
