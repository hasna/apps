import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_DATA_DIR,
  adoptResolverHome,
  eventsDataDir,
  exactReleasesHome,
  ledgerDbPath,
  outboxPath,
  resolverHome,
  resolveDataDir,
} from "./config.js";

const HOME_ENV_KEYS = [
  "HASNA_RELEASES_HOME",
  "RELEASES_HOME",
  "RELEASES_DATA_DIR",
  "HASNA_DATA_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_STATE_HOME",
  "HASNA_CACHE_HOME",
] as const;
const SAVED_HOME_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of HOME_ENV_KEYS) SAVED_HOME_ENV[k] = process.env[k];
});

afterEach(() => {
  for (const k of HOME_ENV_KEYS) {
    if (SAVED_HOME_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_HOME_ENV[k];
  }
});

describe("releases data-dir resolution — legacy default must never become invisible (P4 resolver regression)", () => {
  it("keeps the legacy ~/.hasna/releases default until the XDG store exists or an override is set", () => {
    expect(DEFAULT_DATA_DIR).toBe(join(homedir(), ".hasna", "releases"));
    // No HASNA_*_HOME overrides and no store migrated to the resolver home:
    // the effective data dir MUST stay on the legacy layout.
    expect(adoptResolverHome(resolverHome(), {})).toBe(false);
  });

  it("honors the HASNA_RELEASES_HOME exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "releases-home-"));
    try {
      process.env["HASNA_RELEASES_HOME"] = join(base, "custom-home");
      expect(exactReleasesHome()).toBe(join(base, "custom-home"));
      expect(resolveDataDir()).toBe(join(base, "custom-home"));
      expect(ledgerDbPath()).toBe(join(base, "custom-home", "releases.db"));
      expect(outboxPath()).toBe(join(base, "custom-home", "outbox.jsonl"));
      expect(eventsDataDir()).toBe(join(base, "custom-home", "events"));
    } finally {
      delete process.env["HASNA_RELEASES_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the RELEASES_HOME fallback override", () => {
    const base = mkdtempSync(join(tmpdir(), "releases-home-"));
    try {
      process.env["RELEASES_HOME"] = join(base, "alias-home");
      expect(resolveDataDir()).toBe(join(base, "alias-home"));
      expect(ledgerDbPath()).toBe(join(base, "alias-home", "releases.db"));
    } finally {
      delete process.env["RELEASES_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the legacy RELEASES_DATA_DIR override (backward compat)", () => {
    const base = mkdtempSync(join(tmpdir(), "releases-home-"));
    try {
      process.env["RELEASES_DATA_DIR"] = join(base, "legacy-env-dir");
      expect(resolveDataDir()).toBe(join(base, "legacy-env-dir"));
      expect(ledgerDbPath()).toBe(join(base, "legacy-env-dir", "releases.db"));
    } finally {
      delete process.env["RELEASES_DATA_DIR"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "releases-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      expect(resolverHome()).toBe(join(base, "releases"));
      expect(resolveDataDir()).toBe(join(base, "releases"));
      expect(ledgerDbPath()).toBe(join(base, "releases", "releases.db"));
      expect(outboxPath()).toBe(join(base, "releases", "outbox.jsonl"));
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("an explicit dataDir argument wins over every override", () => {
    const base = mkdtempSync(join(tmpdir(), "releases-home-"));
    const explicit = join(base, "explicit");
    try {
      process.env["HASNA_RELEASES_HOME"] = join(base, "env-home");
      expect(resolveDataDir(explicit)).toBe(explicit);
      expect(ledgerDbPath(explicit)).toBe(join(explicit, "releases.db"));
    } finally {
      delete process.env["HASNA_RELEASES_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adoptResolverHome is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "releases-home-"));
    const resolved = join(base, "releases");
    try {
      // No override, no store -> legacy default stays.
      expect(adoptResolverHome(resolved, {})).toBe(false);
      // Non-data HASNA_*_HOME kinds alone must NOT move the data home.
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(false);
      expect(adoptResolverHome(resolved, { HASNA_CONFIG_HOME: base })).toBe(false);
      expect(adoptResolverHome(resolved, { HASNA_STATE_HOME: base })).toBe(false);
      // Data-kind override adopts even before a store exists.
      expect(adoptResolverHome(resolved, { HASNA_DATA_HOME: base })).toBe(true);
      // A migrated store at the resolver home adopts without any override.
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, "releases.db"), "");
      expect(adoptResolverHome(resolved, {})).toBe(true);
      expect(adoptResolverHome(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
