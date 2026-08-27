import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  adoptResolverDataDir,
  ensureDataDir,
  getClipboardHistoryPath,
  getClipboardKeyPath,
  getDataDir,
  getDbPath,
  getExactDataDir,
  getFlipLedgerPath,
  getFreezePath,
  getHomeDir,
  getLegacyDataDir,
  getManifestPath,
  getNotificationsPath,
  getResolverDataDir,
  getRolloutRecordsPath,
  getRosterConfigPath,
  getRosterHeartbeatPath,
  getRosterRecordsPath,
} from "./paths.js";

const ENV_KEYS = [
  "HOME",
  "USERPROFILE",
  "HASNA_MACHINES_HOME",
  "MACHINES_HOME",
  "HASNA_MACHINES_DIR",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
  "HASNA_MACHINES_DB_PATH",
] as const;

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
let tempHome: string | null = null;
const cleanups: string[] = [];

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (key in saved) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  if (tempHome) {
    rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Point $HOME at a fresh temp dir and clear every path-affecting override. */
function isolateHome(): string {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  const home = mkdtempSync(join(tmpdir(), "machines-data-root-"));
  tempHome = home;
  process.env.HOME = home;
  delete process.env.USERPROFILE;
  delete process.env.HASNA_MACHINES_HOME;
  delete process.env.MACHINES_HOME;
  delete process.env.HASNA_MACHINES_DIR;
  delete process.env.HASNA_DATA_HOME;
  delete process.env.HASNA_CACHE_HOME;
  delete process.env.HASNA_MACHINES_DB_PATH;
  return home;
}

describe("resolver (XDG) adoption — the legacy home must never become invisible", () => {
  test("resolver data dir follows @hasna/paths under a fake HOME", () => {
    const home = isolateHome();
    expect(getResolverDataDir()).toBe(join(home, ".local", "share", "hasna", "machines"));
    expect(getLegacyDataDir()).toBe(join(home, ".hasna", "machines"));
    expect(getHomeDir()).toBe(home);
  });

  test("legacy ~/.hasna/machines stays the effective dir until adopted", () => {
    const home = isolateHome();
    expect(adoptResolverDataDir(getResolverDataDir())).toBe(false);
    expect(getDataDir()).toBe(join(home, ".hasna", "machines"));
    expect(getDbPath()).toBe(join(home, ".hasna", "machines", "machines.db"));
    expect(getManifestPath()).toBe(join(home, ".hasna", "machines", "machines.json"));
  });

  test("HASNA_DATA_HOME adopts the resolver (XDG) data dir", () => {
    isolateHome();
    const base = mkdtempSync(join(tmpdir(), "machines-data-home-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base;
    expect(adoptResolverDataDir(getResolverDataDir())).toBe(true);
    expect(getDataDir()).toBe(join(base, "machines"));
    expect(getDbPath()).toBe(join(base, "machines", "machines.db"));
  });

  test("an existing store at the resolver data dir adopts it even without HASNA_DATA_HOME", () => {
    const home = isolateHome();
    const xdg = join(home, ".local", "share", "hasna", "machines");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "machines.db"), "existing-migrated-store");
    expect(adoptResolverDataDir(getResolverDataDir())).toBe(true);
    expect(getDataDir()).toBe(xdg);
  });

  test("a non-data kind override (HASNA_CACHE_HOME) must NOT move the data dir", () => {
    const home = isolateHome();
    const cache = mkdtempSync(join(tmpdir(), "machines-cache-home-")); cleanups.push(cache);
    process.env.HASNA_CACHE_HOME = cache;
    expect(adoptResolverDataDir(getResolverDataDir())).toBe(false);
    expect(getDataDir()).toBe(join(home, ".hasna", "machines"));
  });

  test("exact-app overrides win over both roots, in priority order", () => {
    isolateHome();
    const override = mkdtempSync(join(tmpdir(), "machines-exact-")); cleanups.push(override);
    const base = mkdtempSync(join(tmpdir(), "machines-data-home2-")); cleanups.push(base);
    process.env.HASNA_DATA_HOME = base; // would adopt the XDG root, but the override must win
    process.env.HASNA_MACHINES_HOME = override;
    expect(getExactDataDir()).toBe(override);
    expect(getDataDir()).toBe(override);
    expect(getDbPath()).toBe(join(override, "machines.db"));
  });

  test("the legacy HASNA_MACHINES_DIR override still wins over the default", () => {
    const home = isolateHome();
    const legacyOverride = mkdtempSync(join(tmpdir(), "machines-dir-")); cleanups.push(legacyOverride);
    process.env.HASNA_MACHINES_DIR = legacyOverride;
    expect(getExactDataDir()).toBe(legacyOverride);
    expect(getDataDir()).toBe(legacyOverride);
  });

  test("an empty exact-app override is treated as unset", () => {
    const home = isolateHome();
    process.env.HASNA_MACHINES_HOME = "";
    expect(getExactDataDir()).toBeUndefined();
    expect(getDataDir()).toBe(join(home, ".hasna", "machines"));
  });

  test("default run never creates the resolver (XDG) data dir", () => {
    const home = isolateHome();
    // getDataDir() is a pure resolver: it must not create either home.
    getDataDir();
    expect(existsSync(join(home, ".hasna", "machines"))).toBe(false);
    expect(existsSync(join(home, ".local", "share", "hasna", "machines"))).toBe(false);
  });

  test("ensureDataDir provisions only the effective data dir", () => {
    const home = isolateHome();
    const created = ensureDataDir();
    expect(created).toBe(join(home, ".hasna", "machines"));
    expect(existsSync(created)).toBe(true);
    expect(existsSync(join(home, ".local", "share", "hasna", "machines"))).toBe(false);
  });

  test("every sub-path resolves under the effective data dir", () => {
    const home = isolateHome();
    const root = getDataDir();
    expect(getDbPath()).toBe(join(root, "machines.db"));
    expect(getManifestPath()).toBe(join(root, "machines.json"));
    expect(getNotificationsPath()).toBe(join(root, "notifications.json"));
    expect(getFreezePath()).toBe(join(root, "freeze.json"));
    expect(getRolloutRecordsPath()).toBe(join(root, "rollout-records.jsonl"));
    expect(getRosterConfigPath()).toBe(join(root, "roster.json"));
    expect(getRosterRecordsPath()).toBe(join(root, "roster-records.jsonl"));
    expect(getRosterHeartbeatPath()).toBe(join(root, "roster-heartbeat.json"));
    expect(getClipboardKeyPath()).toBe(join(root, "clipboard.key"));
    expect(getClipboardHistoryPath()).toBe(join(root, "clipboard-history.json"));
    expect(getFlipLedgerPath()).toBe(join(root, "flip-ledger.jsonl"));
  });

  test("the per-file HASNA_MACHINES_DB_PATH override stays layered on top", () => {
    const home = isolateHome();
    process.env.HASNA_MACHINES_DB_PATH = join(home, "custom", "machines.db");
    expect(getDbPath()).toBe(join(home, "custom", "machines.db"));
    expect(getDataDir()).toBe(join(home, ".hasna", "machines"));
  });
});
