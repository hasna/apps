import { describe, expect, test } from "bun:test";
import {
  APP_HOME_ENV_KEYS,
  APP_HOME_SCOPES,
  APP_HOME_SLUG_PATTERN,
  AppHomeUnresolvableError,
  appPaths,
  appScopeForPackageName,
  resolveAppHome,
  scopeHomeDirName,
} from "./app-home.js";
import { credentialDiskSources, resolveCredential } from "./credentials.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("the one app home resolver", () => {
  test("public scope: ~/.hasna/<app> with config/, state/, cache/ and data at the root", () => {
    const home = resolveAppHome("todos", { HOME: "/Users/u" })!;
    expect(home).toEqual({
      name: "todos",
      scope: "public",
      root: "/Users/u/.hasna",
      home: "/Users/u/.hasna/todos",
      config: "/Users/u/.hasna/todos/config",
      credentials: "/Users/u/.hasna/todos/config/credentials",
      data: "/Users/u/.hasna/todos",
      state: "/Users/u/.hasna/todos/state",
      cache: "/Users/u/.hasna/todos/cache",
      localDb: "/Users/u/.hasna/todos/todos.db",
      sources: { root: "HOME", config: "home", data: "home", state: "home", cache: "home" },
    });
    expect(Object.isFrozen(home)).toBe(true);
    expect(appPaths("todos", { HOME: "/Users/u" })).toEqual(home);
  });

  test("internal scope: ~/.hasna-internal/<app>, never a grouping container", () => {
    const home = resolveAppHome("identities", { HOME: "/Users/u" }, { scope: "internal" })!;
    expect(home.root).toBe("/Users/u/.hasna-internal");
    expect(home.home).toBe("/Users/u/.hasna-internal/identities");
    expect(home.credentials).toBe("/Users/u/.hasna-internal/identities/config/credentials");
    expect(home.localDb).toBe("/Users/u/.hasna-internal/identities/identities.db");
    expect(APP_HOME_SCOPES).toEqual(["public", "internal"]);
    expect(scopeHomeDirName("public")).toBe(".hasna");
    expect(scopeHomeDirName("internal")).toBe(".hasna-internal");
    expect(appScopeForPackageName("@hasna/todos")).toBe("public");
    expect(appScopeForPackageName("@hasna-internal/identities")).toBe("internal");
    expect(appScopeForPackageName("@hasnaxyz/legacy")).toBeNull();
  });

  test("HASNA_HOME replaces the scope root; HASNA_{CONFIG,DATA,STATE,CACHE}_HOME replace one layer each", () => {
    expect(APP_HOME_ENV_KEYS).toEqual(["HASNA_HOME", "HASNA_CONFIG_HOME", "HASNA_DATA_HOME", "HASNA_STATE_HOME", "HASNA_CACHE_HOME"]);
    const env = {
      HOME: "/Users/u",
      HASNA_HOME: "/srv/hasna",
      HASNA_CONFIG_HOME: "/etc/hasna",
      HASNA_DATA_HOME: "/var/lib/hasna",
      HASNA_STATE_HOME: "/var/state/hasna",
      HASNA_CACHE_HOME: "/var/cache/hasna",
    };
    const home = resolveAppHome("todos", env)!;
    expect(home.root).toBe("/srv/hasna");
    expect(home.home).toBe("/srv/hasna/todos");
    expect(home.config).toBe("/etc/hasna/todos");
    expect(home.credentials).toBe("/etc/hasna/todos/credentials");
    expect(home.data).toBe("/var/lib/hasna/todos");
    expect(home.localDb).toBe("/var/lib/hasna/todos/todos.db");
    expect(home.state).toBe("/var/state/hasna/todos");
    expect(home.cache).toBe("/var/cache/hasna/todos");
    expect(home.sources).toEqual({
      root: "HASNA_HOME",
      config: "HASNA_CONFIG_HOME",
      data: "HASNA_DATA_HOME",
      state: "HASNA_STATE_HOME",
      cache: "HASNA_CACHE_HOME",
    });
    // The same single override applies to the internal scope root.
    expect(resolveAppHome("identities", { HOME: "/Users/u", HASNA_HOME: "/srv/hasna" }, { scope: "internal" })!.home).toBe("/srv/hasna/identities");
    // HASNA_HOME alone anchors a root; HOME is not required.
    expect(resolveAppHome("todos", { HASNA_HOME: "/srv/hasna" })!.home).toBe("/srv/hasna/todos");
  });

  test("overrides are absolute-only and non-blank; XDG and Application Support are never consulted", () => {
    const base = resolveAppHome("todos", { HOME: "/Users/u" })!;
    expect(resolveAppHome("todos", { HOME: "/Users/u", HASNA_HOME: "relative/dir", HASNA_CONFIG_HOME: "  " })).toEqual(base);
    expect(
      resolveAppHome("todos", {
        HOME: "/Users/u",
        XDG_CONFIG_HOME: "/xdg/config",
        XDG_DATA_HOME: "/xdg/data",
        XDG_STATE_HOME: "/xdg/state",
        XDG_CACHE_HOME: "/xdg/cache",
      }),
    ).toEqual(base);
    expect(JSON.stringify(base)).not.toContain("Application Support");
    expect(JSON.stringify(base)).not.toContain("xdg");
  });

  test("no HOME and no HASNA_HOME resolves nothing; appPaths refuses instead of inventing a root", () => {
    expect(resolveAppHome("todos", {})).toBeNull();
    expect(resolveAppHome("todos", { HOME: "   " })).toBeNull();
    expect(() => appPaths("todos", {})).toThrow(AppHomeUnresolvableError);
    expect(() => appPaths("todos", {})).toThrow(/HASNA_HOME/);
  });

  test("an unsafe app name never composes a path", () => {
    for (const name of ["../elsewhere", "Todos", "to dos", "todos/x", "", "-todos", "todos-"]) {
      expect(APP_HOME_SLUG_PATTERN.test(name)).toBe(false);
      expect(() => resolveAppHome(name, { HOME: "/Users/u" })).toThrow(AppHomeUnresolvableError);
    }
    expect(APP_HOME_SLUG_PATTERN.test("my-app2")).toBe(true);
  });

  test("the credential disk tier reads the SAME path this resolver names, for both scopes", () => {
    const env = { HOME: "/Users/u", HASNA_CONFIG_HOME: "/etc/hasna" };
    expect(credentialDiskSources("todos", env)).toEqual([resolveAppHome("todos", env)!.credentials]);
    const internal = { HOME: "/Users/u" };
    expect(credentialDiskSources("identities", internal, "internal")).toEqual([
      "/Users/u/.hasna-internal/identities/config/credentials",
    ]);
    expect(credentialDiskSources("identities", internal)).toEqual(["/Users/u/.hasna/identities/config/credentials"]);
  });

  test("an internal-scope credential resolves from ~/.hasna-internal and never from ~/.hasna", () => {
    const root = mkdtempSync(join(tmpdir(), "contracts-app-home-"));
    try {
      const file = join(root, ".hasna-internal", "identities", "config", "credentials");
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, "HASNA_IDENTITIES_API_KEY=internal-key\n", { mode: 0o600 });
      const env = { HOME: root };
      expect(resolveCredential("identities", env, { scope: "internal" })).toMatchObject({ tier: "disk", source: file });
      expect(resolveCredential("identities", env)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
