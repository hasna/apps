import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, closeSync, existsSync, ftruncateSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pluginFileWitnesses, PLUGIN_PROJECTION_LIMITS } from "./plugin-projection.js";
import { materializePluginTree, pluginExecutableDigest, readPluginJson, snapshotPluginTree, verifyPluginTree, writePluginJsonImmutable } from "./plugin-projection-store.js";
import type { SkillBundleEntry } from "./skill-bundle.js";

let root: string;
const entry = (path: string, text = "fixture", mode = 0o644): SkillBundleEntry => ({ path, bytes: new TextEncoder().encode(text), mode });
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "skills-plugin-store-"))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("immutable plugin projection storage", () => {
  test("materializes exact regular files once and preserves executable modes", () => {
    const target = join(root, "private", "tree"), entries = [entry(".claude-plugin/plugin.json", "{}"), entry("bin/fixture", "exit 0", 0o755)];
    materializePluginTree(target, entries);
    expect(statSync(join(root, "private")).mode & 0o777).toBe(0o700);
    expect(snapshotPluginTree(target)).toEqual(entries);
    verifyPluginTree(target, pluginFileWitnesses(entries));
    const identity = statSync(target).ino;
    materializePluginTree(target, entries);
    expect(statSync(target).ino).toBe(identity);
    expect(() => materializePluginTree(target, [entry("changed")])).toThrow();
    expect(readdirSync(join(root, "private"))).toEqual(["tree"]);
  });
  test("rejects cache mutation, additional files, additional directories and wrong modes", () => {
    const target = join(root, "tree"), entries = [entry("file")], witnesses = pluginFileWitnesses(entries);
    materializePluginTree(target, entries);
    writeFileSync(join(target, "file"), "changed");
    expect(() => verifyPluginTree(target, witnesses)).toThrow();
    writeFileSync(join(target, "file"), "fixture");
    writeFileSync(join(target, "extra"), "extra");
    expect(() => verifyPluginTree(target, witnesses)).toThrow();
    rmSync(join(target, "extra")); mkdirSync(join(target, "empty"));
    expect(() => verifyPluginTree(target, witnesses)).toThrow();
    rmSync(join(target, "empty"), { recursive: true }); chmodSync(join(target, "file"), 0o600);
    expect(() => verifyPluginTree(target, witnesses)).toThrow();
  });
  test("rejects symlink roots, ancestors, files, hard links and special files without blocking", () => {
    const target = join(root, "tree"); materializePluginTree(target, [entry("file")]);
    symlinkSync(target, join(root, "alias"));
    expect(() => snapshotPluginTree(join(root, "alias"))).toThrow();
    expect(() => snapshotPluginTree(join(root, "alias", "child"))).toThrow();
    symlinkSync(join(target, "file"), join(target, "linked"));
    expect(() => snapshotPluginTree(target)).toThrow(); rmSync(join(target, "linked"));
    linkSync(join(target, "file"), join(target, "hard"));
    expect(() => snapshotPluginTree(target)).toThrow(); rmSync(join(target, "hard"));
    const fifo = spawnSync("mkfifo", [join(target, "pipe")]); expect(fifo.status).toBe(0);
    expect(() => snapshotPluginTree(target)).toThrow();
    expect(() => readPluginJson(join(target, "pipe"))).toThrow();
  });
  test("refuses ambiguous paths, oversized bytes and unsupported modes before writing", () => {
    const target = join(root, "tree");
    for (const entries of [[entry("../escape")], [entry("File"), entry("file")], [entry("a/file"), entry("A/second")], [entry("é".repeat(51))], [entry("file", "text", 0o600)], [{ ...entry("large"), bytes: new Uint8Array(PLUGIN_PROJECTION_LIMITS.fileBytes + 1) }]]) {
      expect(() => materializePluginTree(target, entries)).toThrow(); expect(existsSync(target)).toBe(false);
    }
    mkdirSync(target); writeFileSync(join(target, "File"), "x"); writeFileSync(join(target, "file"), "x");
    expect(() => snapshotPluginTree(target)).toThrow();
  });
  test("refuses active locks and insecure parents without touching their contents", () => {
    const target = join(root, "tree"); mkdirSync(`${target}.lock`); writeFileSync(join(`${target}.lock`, "owner"), "other");
    expect(() => materializePluginTree(target, [entry("file")])).toThrow();
    expect(readFileSync(join(`${target}.lock`, "owner"), "utf8")).toBe("other");
    rmSync(`${target}.lock`, { recursive: true }); chmodSync(root, 0o755);
    expect(() => materializePluginTree(target, [entry("file")])).toThrow(); expect(existsSync(target)).toBe(false);
  });
});

describe("private immutable plugin receipts", () => {
  test("writes owner-only JSON, permits exact replay and rejects replacement", () => {
    const path = join(root, "receipts", "fixture.json"); expect(readPluginJson(path)).toBeNull();
    writePluginJsonImmutable(path, { schemaVersion: 1, fixture: true });
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readPluginJson(path)).toEqual({ schemaVersion: 1, fixture: true });
    writePluginJsonImmutable(path, { schemaVersion: 1, fixture: true });
    expect(() => writePluginJsonImmutable(path, { fixture: false })).toThrow();
    chmodSync(path, 0o400); expect(readPluginJson(path)).toEqual({ schemaVersion: 1, fixture: true });
    expect(readdirSync(join(root, "receipts"))).toEqual(["fixture.json"]);
  });
  test("rejects public, oversized, malformed and linked receipts", () => {
    const path = join(root, "receipt.json"); writeFileSync(path, "{}", { mode: 0o644 }); chmodSync(path, 0o644);
    expect(() => readPluginJson(path)).toThrow(); chmodSync(path, 0o600); writeFileSync(path, "not json");
    expect(() => readPluginJson(path)).toThrow();
    writeFileSync(path, " ".repeat(PLUGIN_PROJECTION_LIMITS.metadataBytes + 1)); expect(() => readPluginJson(path)).toThrow();
    expect(() => writePluginJsonImmutable(join(root, "large.json"), "x".repeat(PLUGIN_PROJECTION_LIMITS.metadataBytes))).toThrow();
    rmSync(path); symlinkSync(join(root, "absent"), path); expect(() => readPluginJson(path)).toThrow();
    expect(() => writePluginJsonImmutable(path, {})).toThrow();
  });
});

describe("reviewed plugin executable identity", () => {
  test("hashes an executable without executing it and rejects unsafe or oversized binaries", () => {
    const path = join(root, "fixture"), text = "this is inert synthetic content";
    writeFileSync(path, text, { mode: 0o755 });
    expect(pluginExecutableDigest(path)).toBe(`sha256:${createHash("sha256").update(text).digest("hex")}`);
    linkSync(path, join(root, "package-manager-hardlink"));
    expect(pluginExecutableDigest(path)).toBe(`sha256:${createHash("sha256").update(text).digest("hex")}`);
    chmodSync(path, 0o777); expect(() => pluginExecutableDigest(path)).toThrow();
    chmodSync(path, 0o644); expect(() => pluginExecutableDigest(path)).toThrow();
    chmodSync(path, 0o755); symlinkSync(path, join(root, "alias")); expect(() => pluginExecutableDigest(join(root, "alias"))).toThrow();
    const fd = openSync(path, "r+"); ftruncateSync(fd, 256 * 1024 * 1024 + 1); closeSync(fd);
    expect(() => pluginExecutableDigest(path)).toThrow();
  });
  test("detects executable mutation during a streamed read", async () => {
    const path = join(root, "fixture"), ready = join(root, "ready");
    const fd = openSync(path, "wx", 0o755); ftruncateSync(fd, 255 * 1024 * 1024); closeSync(fd);
    const script = 'const fs=require("node:fs"); const fd=fs.openSync(process.argv[1],"r+"); fs.writeFileSync(process.argv[2],"ready"); let n=0; setInterval(()=>fs.writeSync(fd,Buffer.from([++n%256]),0,1,0),1);';
    const child = Bun.spawn([process.execPath, "-e", script, path, ready], { stdout: "ignore", stderr: "ignore" });
    try {
      const deadline = Date.now() + 5000;
      while (!existsSync(ready) && Date.now() < deadline) await Bun.sleep(5);
      expect(existsSync(ready)).toBe(true);
      expect(() => pluginExecutableDigest(path)).toThrow("changed");
    } finally { child.kill(); await child.exited; }
  });
});
