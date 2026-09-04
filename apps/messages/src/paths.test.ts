import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/contracts/paths";

import { defaultSqlitePath } from "./server/sqlite-store.js";
import { getDataRoot, getExactDataRoot, getHomeDir, getLegacyDataRoot, getResolverDataRoot } from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_MESSAGES_HOME",
  "HASNA_MESSAGES_SQLITE_PATH",
] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let tempHome: string | null = null;
const cleanups: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved = {};
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (tempHome !== null) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
});

function isolateHome(): string {
  if (tempHome !== null) throw new Error("isolateHome called twice without afterEach");
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  tempHome = mkdtempSync(join(tmpdir(), "messages-paths-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

describe("paths resolver wiring (single resolver in @hasna/contracts, ruling #1668)", () => {
  test("home resolves HOME first", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test("the resolver data root is the contracts resolver root for this machine", () => {
    const home = isolateHome();
    expect(getResolverDataRoot()).toBe(dataDir({ app: "messages", home, env: process.env }));
  });

  test("on macOS the resolver (and therefore the effective) root is ~/.hasna/messages", () => {
    const home = isolateHome();
    const mac = dataDir({ app: "messages", home, platform: "darwin", env: process.env });
    expect(mac).toBe(join(home, ".hasna", "messages"));
    expect(getResolverDataRoot()).toBe(mac);
    expect(getDataRoot()).toBe(mac);
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "messages"));
  });

  test("on Linux the resolver root is the XDG data root", () => {
    const home = isolateHome();
    expect(dataDir({ app: "messages", home, platform: "linux", env: process.env })).toBe(
      join(home, ".local", "share", "hasna", "messages"),
    );
  });

  test("the effective root is the resolver root; the default store path agrees", () => {
    const home = isolateHome();
    const root = dataDir({ app: "messages", home, env: process.env });
    expect(getDataRoot()).toBe(root);
    expect(defaultSqlitePath()).toBe(join(root, "messages.db"));
  });

  test("HASNA_DATA_HOME kind override moves the data root (app segment kept)", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "messages-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(getDataRoot()).toBe(join(base, "messages"));
    expect(defaultSqlitePath()).toBe(join(base, "messages", "messages.db"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "messages-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(getDataRoot()).toBe(dataDir({ app: "messages", home, env: process.env }));
  });

  test("HASNA_MESSAGES_HOME exact override wins over the kind override and the resolver root", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "messages-hasna-home-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "messages-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would move the resolver root, but the override must win
    process.env.HASNA_MESSAGES_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getDataRoot()).toBe(override);
    expect(defaultSqlitePath()).toBe(join(override, "messages.db"));
  });

  test("exact data-root overrides are resolved to absolute paths", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "messages-abs-")); cleanups.push(base);
    const raw = join(base, "..", "messages-abs-rel");
    process.env.HASNA_MESSAGES_HOME = raw;
    expect(getExactDataRoot()).toBe(resolve(raw));
    expect(getExactDataRoot()?.startsWith("/")).toBe(true);
  });

  test("HASNA_MESSAGES_SQLITE_PATH file override wins over the effective data root", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "messages-sqlite-path-")); cleanups.push(override);
    const file = join(override, "custom.db");
    process.env.HASNA_MESSAGES_SQLITE_PATH = file;
    expect(defaultSqlitePath()).toBe(file);
  });
});