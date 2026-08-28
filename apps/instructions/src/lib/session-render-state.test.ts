// P5 XDG state migration (lane-session-render-snapshots).
//
// Session-render snapshot-dir resolution contracts: the legacy per-target-home
// `~/.hasna/session-render-snapshots` default stays the effective snapshot dir
// until the instructions state dir (~/.local/state/hasna/instructions on Linux)
// is physically migrated (holds at least one snapshot file) or the operator
// sets the state-kind override HASNA_STATE_HOME; a machine that only redirects
// another kind (HASNA_CONFIG_HOME / HASNA_DATA_HOME / HASNA_CACHE_HOME) must
// NOT move the snapshot store. All paths are redirected to a temporary
// HOME/override — nothing touches the real store or the real state dir.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  adoptResolverSnapshotDir,
  getSessionRenderSnapshotDir,
  legacySnapshotDir,
  resolverSnapshotDir,
  sessionRenderSnapshotWorkspaceRoot,
} from "./session-render-state.js";

// HOME is mutated too: restoring it in afterEach is load-bearing because bun
// runs every file's tests in one process, and a leaked HOME would redirect the
// @hasna/paths state dir for the sibling session-apply/project-context suites.
const HOME_ENV_KEYS = [
  "HOME",
  "HASNA_STATE_HOME",
  "HASNA_CONFIG_HOME",
  "HASNA_DATA_HOME",
  "HASNA_CACHE_HOME",
] as const;
const SAVED_HOME_ENV: Record<string, string | undefined> = {};

let tempHome: string;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "srs-state-test-"));
  for (const k of HOME_ENV_KEYS) SAVED_HOME_ENV[k] = process.env[k];
  for (const k of HOME_ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of HOME_ENV_KEYS) {
    if (SAVED_HOME_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_HOME_ENV[k];
  }
});

describe("snapshot dir resolution precedence", () => {
  it("defaults to the legacy per-target-home dir when no override is set and no store is migrated", () => {
    process.env["HOME"] = tempHome;
    expect(legacySnapshotDir(tempHome)).toBe(join(tempHome, ".hasna", "session-render-snapshots"));
    expect(getSessionRenderSnapshotDir(tempHome)).toBe(join(tempHome, ".hasna", "session-render-snapshots"));
    expect(sessionRenderSnapshotWorkspaceRoot(tempHome)).toBe(tempHome);
  });

  it("resolves the instructions state dir through @hasna/paths (XDG state layout)", () => {
    process.env["HOME"] = tempHome;
    expect(resolverSnapshotDir()).toBe(join(tempHome, ".local", "state", "hasna", "instructions"));
  });

  it("adopts the resolver state dir only for the state-kind override or a migrated store", () => {
    const base = mkdtempSync(join(tmpdir(), "srs-resolver-"));
    const resolved = join(base, "state", "hasna", "instructions");
    expect(adoptResolverSnapshotDir(resolved, {})).toBe(false);
    // Non-state HASNA_*_HOME kinds alone must NOT move the snapshot store.
    expect(adoptResolverSnapshotDir(resolved, { HASNA_CONFIG_HOME: base })).toBe(false);
    expect(adoptResolverSnapshotDir(resolved, { HASNA_DATA_HOME: base })).toBe(false);
    expect(adoptResolverSnapshotDir(resolved, { HASNA_CACHE_HOME: base })).toBe(false);
    // State-kind override adopts even before a store exists.
    expect(adoptResolverSnapshotDir(resolved, { HASNA_STATE_HOME: base })).toBe(true);
    // An EMPTY pre-created dir does NOT adopt — the legacy store must never
    // become invisible merely because a directory exists.
    mkdirSync(resolved, { recursive: true });
    expect(adoptResolverSnapshotDir(resolved, {})).toBe(false);
    // A migrated store (a snapshot file present) adopts without any override.
    writeFileSync(join(resolved, "20260828T000000Z-test.json"), "{}");
    expect(adoptResolverSnapshotDir(resolved, {})).toBe(true);
  });

  it("uses the resolver state dir and its parent workspace root once the store is migrated there", () => {
    process.env["HOME"] = tempHome;
    const resolved = join(tempHome, ".local", "state", "hasna", "instructions");
    mkdirSync(resolved, { recursive: true });
    writeFileSync(join(resolved, "20260828T000000Z-test.json"), "{}");
    expect(getSessionRenderSnapshotDir(tempHome)).toBe(resolved);
    // The snapshot write anchors to the state dir's parent, which contains it,
    // so the managed-file containment guards accept the path for any target
    // home (including a nested project root).
    expect(sessionRenderSnapshotWorkspaceRoot(tempHome)).toBe(join(tempHome, ".local", "state", "hasna"));
  });
});
