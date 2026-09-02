import { describe, expect, test } from "bun:test";
import { baseDir, dirs, PATH_KINDS, resolvePath, type PathsOptions } from "./index";

function options(env: Record<string, string | undefined>, platform: NodeJS.Platform = "linux"): PathsOptions {
  return { app: "todos", home: "/home/user", platform, env };
}

describe("standard XDG roots", () => {
  for (const platform of ["linux", "darwin", "freebsd"] as const) {
    for (const kind of PATH_KINDS) {
      const xdg = `XDG_${kind.toUpperCase()}_HOME`;
      const hasna = `HASNA_${kind.toUpperCase()}_HOME`;
      test(`${platform}: ${xdg} supplies the parent of the hasna namespace`, () => {
        const opts = options({ [xdg]: `/srv/${kind}` }, platform);
        expect(baseDir(kind, opts)).toBe(`/srv/${kind}/hasna`);
        expect(resolvePath(kind, opts)).toBe(`/srv/${kind}/hasna/todos`);
        expect(resolvePath(kind, { ...opts, internal: true })).toBe(`/srv/${kind}/hasna/internal/todos`);
        expect(dirs(opts)[kind]).toBe(`/srv/${kind}/hasna/todos`);
      });
      test(`${platform}: ${hasna} wins over ${xdg}; empty remains unset`, () => {
        expect(baseDir(kind, options({ [hasna]: "/hasna-root", [xdg]: "/xdg-root" }, platform)))
          .toBe("/hasna-root");
        expect(baseDir(kind, options({ [hasna]: "", [xdg]: "/xdg-root" }, platform)))
          .toBe("/xdg-root/hasna");
      });
      test(`${platform}: empty and relative ${xdg} fall back to the platform default`, () => {
        const fallback = baseDir(kind, options({}, platform));
        for (const value of ["", "relative", "../relative", "~/.config", " ", " /padded", "/nul\0path"]) {
          expect(baseDir(kind, options({ [xdg]: value }, platform))).toBe(fallback);
        }
      });
      test(`${platform}: invalid ${hasna} fails closed without exposing its value`, () => {
        for (const value of ["relative-private-root", "../private-root", "~/.config", " ", "\t", " /private-root", "/private-root ", "/nul\0path", "/line\npath"]) {
          const opts = options({ [hasna]: value, [xdg]: "/otherwise-valid" }, platform);
          expect(() => baseDir(kind, opts)).toThrow(`paths: ${hasna} must be an absolute path without surrounding whitespace or control characters`);
          expect(() => resolvePath(kind, opts)).toThrow(TypeError);
        }
      });
    }
  }

  test("per-kind overrides remain independent and path spaces are not trimmed", () => {
    const opts = options({ XDG_CONFIG_HOME: "/custom config", XDG_DATA_HOME: "/data ", HASNA_CACHE_HOME: "/cache root" });
    expect(dirs(opts)).toEqual({ config: "/custom config/hasna/todos", data: "/data /hasna/todos", state: "/home/user/.local/state/hasna/todos", cache: "/cache root/todos" });
  });
});
