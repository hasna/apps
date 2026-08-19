import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
  configsManifestPath,
  configsPrelaunchAuditPath,
  rerootProfileDirOntoLocalHome,
} from "./configs-prelaunch-status.js";

// Regression for the macOS cloud-store launch defect (task 618beb78):
// a profile.dir recorded on a Linux server (/home/hasna/...) was joined
// verbatim on macOS, so the prelaunch audit tried to mkdir /home/hasna/...
// (ENOENT on darwin). The path functions must re-root a foreign-home
// profile dir onto the LOCAL home before building paths.
describe("configs prelaunch path re-rooting (cloud-store home mismatch)", () => {
  const macHome = "/Users/hasna";
  const linuxHome = "/home/hasna";

  test("helper re-roots a foreign /home dir onto a macOS local home", () => {
    const foreign = join(linuxHome, ".hasna", "accounts", "profiles", "claude", "account003");
    expect(rerootProfileDirOntoLocalHome(foreign, macHome)).toBe(
      join(macHome, ".hasna", "accounts", "profiles", "claude", "account003"),
    );
  });

  test("helper re-roots a foreign /Users dir onto a linux local home (mirror case)", () => {
    const foreign = join(macHome, ".hasna", "accounts", "profiles", "claude", "account003");
    expect(rerootProfileDirOntoLocalHome(foreign, linuxHome)).toBe(
      join(linuxHome, ".hasna", "accounts", "profiles", "claude", "account003"),
    );
  });

  test("helper leaves a same-home dir unchanged (no-op)", () => {
    const local = join(linuxHome, ".hasna", "accounts", "profiles", "claude", "account003");
    expect(rerootProfileDirOntoLocalHome(local, linuxHome)).toBe(local);
  });

  test("helper leaves empty and non-home dirs unchanged", () => {
    expect(rerootProfileDirOntoLocalHome("", macHome)).toBe("");
    expect(rerootProfileDirOntoLocalHome("/opt/custom/profiles/x", macHome)).toBe(resolve("/opt/custom/profiles/x"));
  });

  test("manifest path never leaves the running home root", () => {
    const { homedir } = require("node:os") as typeof import("node:os");
    const realHome = homedir();
    const realRoot = realHome.startsWith("/Users") ? "/Users" : "/home";
    const foreignHome = realRoot === "/Users" ? "/home/hasna" : "/Users/hasna";
    const profile = {
      name: "account003",
      tool: "claude",
      dir: join(foreignHome, ".hasna", "accounts", "profiles", "claude", "account003"),
      createdAt: new Date(0).toISOString(),
    };
    const path = configsManifestPath(profile);
    expect(path.startsWith(realHome)).toBe(true);
    expect(path.startsWith(foreignHome)).toBe(false);
    expect(path).toBe(
      join(realHome, ".hasna", "accounts", "profiles", "claude", "account003", ".hasna", "session-render-manifest.json"),
    );
  });

  test("audit path never leaves the running home root", () => {
    const { homedir } = require("node:os") as typeof import("node:os");
    const realHome = homedir();
    const realRoot = realHome.startsWith("/Users") ? "/Users" : "/home";
    const foreignHome = realRoot === "/Users" ? "/home/hasna" : "/Users/hasna";
    const profile = {
      name: "account003",
      tool: "claude",
      dir: join(foreignHome, ".hasna", "accounts", "profiles", "claude", "account003"),
      createdAt: new Date(0).toISOString(),
    };
    const path = configsPrelaunchAuditPath(profile);
    expect(path.startsWith(realHome)).toBe(true);
    expect(path.startsWith(foreignHome)).toBe(false);
    expect(path).toBe(
      join(realHome, ".hasna", "accounts", "profiles", "claude", "account003", ".hasna", "accounts", "prelaunch-status.json"),
    );
  });

  test("path unchanged for a local-home profile dir (no re-root)", () => {
    const { homedir } = require("node:os") as typeof import("node:os");
    const realHome = homedir();
    const dir = join(realHome, ".hasna", "accounts", "profiles", "browserplan", "personal");
    const profile = { name: "personal", tool: "browserplan", dir, createdAt: new Date(0).toISOString() };
    expect(configsManifestPath(profile)).toBe(join(dir, ".hasna", "session-render-manifest.json"));
    expect(configsPrelaunchAuditPath(profile)).toBe(join(dir, ".hasna", "accounts", "prelaunch-status.json"));
  });
});