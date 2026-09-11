/**
 * Root resolution.
 *
 * The four-kind split (`HASNA_{CONFIG,DATA,STATE,CACHE}_HOME`) and the
 * darwin/linux branch are copied per package on purpose — `@hasna/paths` was
 * deleted and the shape IS the contract. These tests pin the shape, because a
 * store that resolves its payloads into `cache/` is a store that is droppable
 * by definition, and a store that resolves into the wrong home is a store whose
 * bytes the operator cannot find.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createSandbox, type Sandbox } from "./testing/sandbox.js";
import { cacheDir, configDir, dataDir, resolveTrashRoots, stateDir } from "./paths.js";

let sandbox: Sandbox;

beforeEach(() => {
  sandbox = createSandbox();
});

afterEach(() => {
  sandbox.cleanup();
});

describe("the four path kinds — darwin/linux split", () => {
  const home = "/home/u";

  test("linux resolves to the XDG-style hidden roots", () => {
    const base = { app: "trash", home, platform: "linux" };
    expect(configDir(base)).toBe("/home/u/.config/hasna/trash");
    expect(dataDir(base)).toBe("/home/u/.local/share/hasna/trash");
    expect(stateDir(base)).toBe("/home/u/.local/state/hasna/trash");
    expect(cacheDir(base)).toBe("/home/u/.cache/hasna/trash");
  });

  test("darwin resolves to Library — Logs for state, Caches for cache", () => {
    const base = { app: "trash", home, platform: "darwin" };
    expect(configDir(base)).toBe("/home/u/Library/Application Support/Hasna/trash");
    expect(dataDir(base)).toBe("/home/u/Library/Application Support/Hasna/trash");
    expect(stateDir(base)).toBe("/home/u/Library/Logs/Hasna/trash");
    expect(cacheDir(base)).toBe("/home/u/Library/Caches/Hasna/trash");
  });

  test("an env override wins over both branches", () => {
    const base = { app: "trash", home, platform: "darwin", env: { HASNA_STATE_HOME: "/srv/state" } };
    expect(stateDir(base)).toBe("/srv/state/trash");
  });

  test("an app slug must be kebab-case", () => {
    expect(() => configDir({ app: "Trash App", home })).toThrow(/invalid app slug/);
  });
});

describe("resolveTrashRoots — the store layout", () => {
  test("payloads are DATA and the index is STATE (never cache)", () => {
    const roots = resolveTrashRoots({
      HOME: "/home/u",
      HASNA_DATA_HOME: "/d",
      HASNA_STATE_HOME: "/s",
      HASNA_CONFIG_HOME: "/c",
    });
    expect(roots.files).toBe("/d/trash/files");
    expect(roots.info).toBe("/s/trash/info");
    expect(roots.state).toBe("/s/trash");
    expect(roots.config).toBe("/c/trash/config.json");
    expect(roots.lock).toBe("/s/trash/.lock");
    expect(roots.intents).toBe("/s/trash/intents");
    expect(roots.refusals).toBe("/s/trash/refusals");
    expect(roots.legacy).toBe(false);
  });

  test("an unset override falls back to the platform default under $HOME", () => {
    const roots = resolveTrashRoots({ HOME: sandbox.path("home") });
    const home = sandbox.path("home");
    expect(roots.files.startsWith(`${home}/`)).toBe(true);
    expect(roots.info.startsWith(`${home}/`)).toBe(true);
    // The index is state, and must not land under the droppable cache root.
    expect(roots.info).not.toContain("/cache/");
    expect(roots.files).not.toContain("/cache/");
  });

  test("--spool collapses every root under ONE directory (the guard's contract)", () => {
    const spool = sandbox.path("spool");
    const roots = resolveTrashRoots({ HOME: sandbox.path("home") }, { root: spool });
    expect(roots.state).toBe(spool);
    expect(roots.files).toBe(`${spool}/files`);
    expect(roots.info).toBe(`${spool}/info`);
    expect(roots.intents).toBe(`${spool}/intents`);
    expect(roots.refusals).toBe(`${spool}/refusals`);
    expect(roots.lock).toBe(`${spool}/.lock`);
    expect(roots.config).toBe(`${spool}/config.json`);
    // Nothing outside the spool: a rewritten command cannot reach the real home.
    for (const value of Object.values(roots)) {
      if (typeof value === "string" && value.startsWith("/")) expect(value.startsWith(spool)).toBe(true);
    }
  });

  test("a live legacy home is adopted, and an override suppresses that adoption", () => {
    const home = sandbox.path("home");
    sandbox.file("home/.hasna/trash/files/kept.bin", "bytes");
    sandbox.file("home/.hasna/trash/info/.keep", "");

    const adopted = resolveTrashRoots({ HOME: home });
    expect(adopted.legacy).toBe(true);
    expect(adopted.files).toBe(`${home}/.hasna/trash/files`);
    expect(adopted.info).toBe(`${home}/.hasna/trash/info`);

    const overridden = resolveTrashRoots({ HOME: home, HASNA_DATA_HOME: sandbox.path("d"), HASNA_STATE_HOME: sandbox.path("s") });
    expect(overridden.legacy).toBe(false);
    expect(overridden.files).toBe(`${sandbox.path("d")}/trash/files`);
    expect(overridden.info).toBe(`${sandbox.path("s")}/trash/info`);
  });

  test("a legacy home with no store in it is not adopted", () => {
    const home = sandbox.path("home");
    sandbox.file("home/notes.txt", "not a trash store");
    expect(resolveTrashRoots({ HOME: home }).legacy).toBe(false);
  });

  test("empty and whitespace-only overrides are ignored, not adopted", () => {
    const roots = resolveTrashRoots(
      { HOME: sandbox.path("home"), HASNA_DATA_HOME: "", HASNA_STATE_HOME: "   " },
      { root: "", files: "  " },
    );
    expect(roots.state).toBe(`${sandbox.path("home")}/.local/state/hasna/trash`);
    expect(roots.files).toBe(`${sandbox.path("home")}/.local/share/hasna/trash/files`);
  });

  test("every resolved root is ABSOLUTE — a relative root lands in an arbitrary cwd", () => {
    // `HASNA_STATE_HOME=` (set-but-empty in a script) and `HASNA_STATE_HOME="  "`
    // must both fall through to the platform default. Treating the whitespace
    // one as a real override produced the relative base `"   /trash"`, i.e. a
    // store under whatever directory the process was standing in.
    for (const env of [
      { HOME: sandbox.path("home") },
      { HOME: sandbox.path("home"), HASNA_STATE_HOME: "" },
      { HOME: sandbox.path("home"), HASNA_STATE_HOME: "   " },
      { HOME: sandbox.path("home"), HASNA_DATA_HOME: "\t", HASNA_CONFIG_HOME: " " },
      { HOME: "relative-home", HASNA_STATE_HOME: "relative/state" },
    ]) {
      const roots = resolveTrashRoots(env);
      for (const [key, value] of Object.entries(roots)) {
        if (typeof value !== "string" || key === "legacy") continue;
        expect({ key, absolute: value.startsWith("/") }).toEqual({ key, absolute: true });
      }
    }
  });

  test("an override is resolved, never taken verbatim", () => {
    const roots = resolveTrashRoots({ HOME: sandbox.path("home"), HASNA_STATE_HOME: `${sandbox.path("s")}/../s` });
    expect(roots.state).toBe(`${sandbox.path("s")}/trash`);
  });
});
