import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

// Isolate the resolver to a throwaway HOME so the assertions never depend on
// whether this machine already has a migrated store under the real home.
const testHome = join(tmpdir(), `skills-home-test-${Date.now()}`);
mkdirSync(join(testHome, ".hasna", "skills"), { recursive: true });
const savedHome = process.env.HOME;
process.env.HOME = testHome;

const {
  DATA_DIR_ENV,
  HASNA_SKILLS_HOME_ENV,
  SKILLS_HOME_ENV,
  adoptResolverDataRoot,
  exactDataRoot,
  getDataRoot,
  hasExactOverride,
  hasOperatorOverride,
  legacyDataRoot,
  resolverDataRoot,
  skillsDataRootForHome,
} = await import("./app-home.js");
const { getDataDir, getDataDirReadOnly } = await import("./config.js");

const OVERRIDE_ENV_KEYS = [
  DATA_DIR_ENV,
  HASNA_SKILLS_HOME_ENV,
  SKILLS_HOME_ENV,
  "HASNA_DATA_HOME",
] as const;
const SAVED_ENV: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of OVERRIDE_ENV_KEYS) SAVED_ENV[k] = process.env[k];
});

afterAll(() => {
  process.env.HOME = savedHome;
  for (const k of Object.keys(SAVED_ENV)) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
  rmSync(testHome, { recursive: true, force: true });
});

// Reset all overrides between tests so the isolated default is deterministic.
beforeEach(() => {
  for (const k of OVERRIDE_ENV_KEYS) delete process.env[k];
  // Remove any resolver-home store a prior test may have planted.
  rmSync(resolverDataRoot(), { recursive: true, force: true });
});

describe("skills app-home resolution — legacy default must never become invisible", () => {
  it("keeps the legacy the skills data root default until the XDG store exists or an override is set", () => {
    expect(legacyDataRoot()).toBe(join(testHome, ".hasna", "skills"));
    // No overrides and no store migrated to the resolver home:
    // the effective home MUST stay on the legacy layout.
    expect(getDataRoot()).toBe(legacyDataRoot());
    // getDataDir / getDataDirReadOnly route through the same resolver.
    expect(getDataDirReadOnly()).toBe(legacyDataRoot());
    expect(getDataDir()).toBe(legacyDataRoot());
  });

  it("honors the HASNA_SKILLS_DIR exact-app override", () => {
    const base = mkdtempSync(join(tmpdir(), "skills-home-"));
    try {
      process.env[DATA_DIR_ENV] = join(base, "custom-dir");
      expect(exactDataRoot()).toBe(join(base, "custom-dir"));
      expect(getDataRoot()).toBe(join(base, "custom-dir"));
      expect(hasExactOverride()).toBe(true);
      expect(hasOperatorOverride()).toBe(true);
      expect(getDataDir()).toBe(join(base, "custom-dir"));
    } finally {
      delete process.env[DATA_DIR_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the HASNA_SKILLS_HOME alias override", () => {
    const base = mkdtempSync(join(tmpdir(), "skills-home-"));
    try {
      process.env[HASNA_SKILLS_HOME_ENV] = join(base, "alias-home");
      expect(exactDataRoot()).toBe(join(base, "alias-home"));
      expect(getDataRoot()).toBe(join(base, "alias-home"));
      expect(hasExactOverride()).toBe(true);
      expect(hasOperatorOverride()).toBe(true);
    } finally {
      delete process.env[HASNA_SKILLS_HOME_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("honors the SKILLS_HOME alias override", () => {
    const base = mkdtempSync(join(tmpdir(), "skills-home-"));
    try {
      process.env[SKILLS_HOME_ENV] = join(base, "bare-alias");
      expect(exactDataRoot()).toBe(join(base, "bare-alias"));
      expect(getDataRoot()).toBe(join(base, "bare-alias"));
      expect(hasExactOverride()).toBe(true);
    } finally {
      delete process.env[SKILLS_HOME_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home on the HASNA_DATA_HOME data-kind override", () => {
    const base = mkdtempSync(join(tmpdir(), "skills-home-"));
    try {
      process.env["HASNA_DATA_HOME"] = base;
      expect(resolverDataRoot()).toBe(join(base, "skills"));
      expect(getDataRoot()).toBe(join(base, "skills"));
      expect(hasOperatorOverride()).toBe(true);
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adoptResolverDataRoot is true only for the data-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "skills-home-"));
    const resolved = join(base, "skills");
    try {
      // No override, no store -> legacy default stays.
      expect(adoptResolverDataRoot(resolved, {})).toBe(false);
      // Non-data HASNA_*_HOME kinds alone must NOT move the data home.
      expect(adoptResolverDataRoot(resolved, { HASNA_CACHE_HOME: base })).toBe(false);
      expect(adoptResolverDataRoot(resolved, { HASNA_CONFIG_HOME: base })).toBe(false);
      // Data-kind override adopts even before a store exists.
      expect(adoptResolverDataRoot(resolved, { HASNA_DATA_HOME: base })).toBe(true);
      // A migrated config at the resolver home adopts without any override.
      mkdirSync(resolved, { recursive: true });
      writeFileSync(join(resolved, "config.json"), "{}");
      expect(adoptResolverDataRoot(resolved, {})).toBe(true);
      expect(adoptResolverDataRoot(resolved, { HASNA_CACHE_HOME: base })).toBe(true);
      // A migrated sqlite store alone also adopts.
      rmSync(join(resolved, "config.json"));
      writeFileSync(join(resolved, "server.db"), "");
      expect(adoptResolverDataRoot(resolved, {})).toBe(true);
      // An empty resolver home (no config.json / server.db) does not adopt.
      rmSync(join(resolved, "server.db"));
      expect(adoptResolverDataRoot(resolved, {})).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("adopts the resolver home once config.json or server.db exists there", () => {
    const resolved = resolverDataRoot();
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "server.db"), "");
    try {
      expect(adoptResolverDataRoot(resolved)).toBe(true);
      expect(getDataRoot()).toBe(resolved);
    } finally {
      rmSync(resolved, { recursive: true, force: true });
    }
  });

  it("skillsDataRootForHome mirrors the effective root for an explicit home", () => {
    // With no store at the explicit home's XDG root, the legacy path is used.
    expect(skillsDataRootForHome(testHome)).toBe(join(testHome, ".hasna", "skills"));
    // Once the store exists at the XDG root, that root is used.
    const xdg = join(testHome, ".local", "share", "hasna", "skills");
    mkdirSync(xdg, { recursive: true });
    writeFileSync(join(xdg, "server.db"), "");
    try {
      expect(skillsDataRootForHome(testHome)).toBe(xdg);
    } finally {
      rmSync(xdg, { recursive: true, force: true });
    }
  });

  it("skillsDataRootForHome applies the exact-app override for the process's own home", () => {
    // P1 regression: with HASNA_SKILLS_DIR set, sync-home snapshotting of the
    // live home must resolve the operator-selected corpus, not the legacy
    // the skills data root store (portable-snapshot-filter.homePathFor).
    const base = mkdtempSync(join(tmpdir(), "skills-home-"));
    try {
      process.env[DATA_DIR_ENV] = join(base, "exact-root");
      expect(skillsDataRootForHome(testHome)).toBe(join(base, "exact-root"));
    } finally {
      delete process.env[DATA_DIR_ENV];
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("skillsDataRootForHome never leaks process overrides into a staged home mirror", () => {
    // P1 regression: a staged homesRoot is a different machine's home tree;
    // the local HASNA_DATA_HOME must not redirect the snapshot to live local
    // data. The mirror resolves its own layout instead.
    const stagedHome = join(tmpdir(), `skills-staged-${Date.now()}`);
    mkdirSync(join(stagedHome, ".hasna", "skills"), { recursive: true });
    const liveData = join(tmpdir(), `skills-live-${Date.now()}`);
    try {
      process.env["HASNA_DATA_HOME"] = liveData;
      // The mirror has no migrated store -> its own legacy path, never the
      // live data root.
      expect(skillsDataRootForHome(stagedHome)).toBe(join(stagedHome, ".hasna", "skills"));
      // Once the mirror itself carries a migrated store at its XDG root, that
      // root wins — still not the live data root.
      const stagedXdg = join(stagedHome, ".local", "share", "hasna", "skills");
      mkdirSync(stagedXdg, { recursive: true });
      writeFileSync(join(stagedXdg, "server.db"), "");
      expect(skillsDataRootForHome(stagedHome)).toBe(stagedXdg);
      // The exact-app override is also process-local: a staged home must not
      // be redirected to it either.
      process.env[DATA_DIR_ENV] = join(liveData, "exact-root");
      expect(skillsDataRootForHome(stagedHome)).toBe(stagedXdg);
    } finally {
      delete process.env["HASNA_DATA_HOME"];
      delete process.env[DATA_DIR_ENV];
      rmSync(stagedHome, { recursive: true, force: true });
      rmSync(liveData, { recursive: true, force: true });
    }
  });
});
