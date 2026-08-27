import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  adoptResolverDataRoot,
  getDataRoot,
  getExactDataRoot,
  getHomeDir,
  getLegacyDataRoot,
  getResolverDataRoot,
} from "./paths.js";
import { getOrgAuditPath, getOrgDataDir, getOrgStorePath } from "./store.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_ORGS_HOME",
  "OPEN_ORGS_STORE",
  "OPEN_ORGS_AUDIT",
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
  tempHome = mkdtempSync(join(tmpdir(), "orgs-paths-"));
  process.env.HOME = tempHome;
  delete process.env.USERPROFILE;
  return tempHome;
}

describe("resolver (XDG) data-root resolution", () => {
  test("home resolves HOME first, then the OS user database", () => {
    const home = isolateHome();
    expect(getHomeDir()).toBe(home);
  });

  test("resolver data root follows @hasna/paths under a fake HOME", () => {
    const home = isolateHome();
    expect(getResolverDataRoot()).toBe(join(home, ".local", "share", "hasna", "orgs"));
    expect(getLegacyDataRoot()).toBe(join(home, ".hasna", "orgs"));
  });
});

describe("resolver (XDG) adoption — the legacy home must never become invisible", () => {
  test("legacy ~/.hasna/orgs stays the effective root until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(getLegacyDataRoot());
    expect(getOrgDataDir()).toBe(getLegacyDataRoot());
    // The default store/audit paths agree on the effective root.
    expect(getOrgStorePath()).toBe(join(home, ".hasna", "orgs", "orgs.json"));
    expect(getOrgAuditPath()).toBe(join(home, ".hasna", "orgs", "audit.jsonl"));
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data root", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "orgs-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(join(base, "orgs"));
    expect(getOrgStorePath()).toBe(join(base, "orgs", "orgs.json"));
  });

  test("an existing store at the resolver data root adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "orgs");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "orgs.json"), "existing-migrated-store");
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(true);
    expect(getDataRoot()).toBe(xdg);
    expect(getOrgStorePath()).toBe(join(xdg, "orgs.json"));
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data home", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "orgs-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataRoot(getResolverDataRoot())).toBe(false);
    expect(getDataRoot()).toBe(join(home, ".hasna", "orgs"));
  });

  test("HASNA_ORGS_HOME exact override wins over both roots", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "orgs-hasna-home-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "orgs-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env.HASNA_ORGS_HOME = override;
    expect(getExactDataRoot()).toBe(override);
    expect(getDataRoot()).toBe(override);
    expect(getOrgStorePath()).toBe(join(override, "orgs.json"));
  });

  test("exact data-root overrides are resolved to absolute paths", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "orgs-abs-")); cleanups.push(base);
    const raw = join(base, "..", "orgs-abs-rel");
    process.env.HASNA_ORGS_HOME = raw;
    expect(getExactDataRoot()).toBe(resolve(raw));
    expect(getExactDataRoot()?.startsWith("/")).toBe(true);
  });

  test("OPEN_ORGS_STORE/OPEN_ORGS_AUDIT file overrides win over the effective data root", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "orgs-store-")); cleanups.push(override);
    process.env.OPEN_ORGS_STORE = join(override, "custom.json");
    process.env.OPEN_ORGS_AUDIT = join(override, "custom-audit.jsonl");
    expect(getOrgStorePath()).toBe(join(override, "custom.json"));
    expect(getOrgAuditPath()).toBe(join(override, "custom-audit.jsonl"));
  });
});
