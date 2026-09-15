import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyProducerDependencies } from "./release-dependencies";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const write = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value));
function fixture() {
  const owner = realpathSync(mkdtempSync(join(tmpdir(), "skills-producer-graph-"))), root = join(owner, "producer");
  mkdirSync(join(root, "node_modules/adapter/node_modules/zod"), { recursive: true });
  mkdirSync(join(root, "node_modules/zod"));
  const manifest = { name: "producer-fixture", version: "1.0.0", dependencies: { adapter: "1.0.0", zod: "^4.0.0" } };
  const adapter = { name: "adapter", version: "1.0.0", dependencies: { zod: "^3.0.0" }, peerDependencies: { optional: "^1.0.0" } };
  const lock = { lockfileVersion: 1, workspaces: { "": manifest }, packages: {
    adapter: ["adapter@1.0.0", "", { dependencies: adapter.dependencies, peerDependencies: adapter.peerDependencies, optionalPeers: ["optional"] }, "fixture-integrity"],
    zod: ["zod@4.5.4", "", {}, "fixture-integrity"],
    "adapter/zod": ["zod@3.25.76", "", {}, "fixture-integrity"],
  } };
  write(join(root, "package.json"), manifest); write(join(root, "bun.lock"), lock);
  write(join(root, "node_modules/adapter/package.json"), adapter);
  write(join(root, "node_modules/zod/package.json"), { name: "zod", version: "4.5.4", exports: { "./v3": "./v3.js" } });
  writeFileSync(join(root, "node_modules/zod/v3.js"), "export const compatibilityVersion = 3;\n");
  write(join(root, "node_modules/adapter/node_modules/zod/package.json"), { name: "zod", version: "3.25.76" });
  return { owner, root, manifest, adapter, lock, dispose: () => rmSync(owner, { recursive: true, force: true }) };
}
function bytes(root: string): string {
  const rows: string[] = [];
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) rows.push(path.slice(root.length) + ":" + createHash("sha256").update(readFileSync(path)).digest("hex"));
    }
  }
  visit(root); return rows.join("\n");
}

test("the selected graph permits Zod4 v3 APIs and a separately locked nested Zod3", () => {
  const f = fixture();
  try {
    const before = bytes(f.root), result = verifyProducerDependencies(f.root);
    expect(result.nodeCount).toBe(3);
    expect(result.nodes.map(value => `${value.lockKey}@${value.version}`)).toEqual(["adapter@1.0.0", "adapter/zod@3.25.76", "zod@4.5.4"]);
    expect(result.edges.filter(value => value.optionalAbsent)).toHaveLength(1);
    expect(createRequire(join(f.root, "package.json")).resolve("zod/v3")).toBe(join(f.root, "node_modules/zod/v3.js"));
    expect(bytes(f.root)).toBe(before);
  } finally { f.dispose(); }
});

for (const [name, path, version] of [
  ["historical direct Zod3 donor", "node_modules/zod/package.json", "3.25.76"],
  ["wrong transitive Zod version", "node_modules/adapter/node_modules/zod/package.json", "4.5.4"],
] as const) test(`refuses ${name} before a build can use it`, () => {
  const f = fixture();
  try {
    write(join(f.root, path), { name: "zod", version }); const before = bytes(f.root);
    expect(() => verifyProducerDependencies(f.root)).toThrow("lock requires"); expect(bytes(f.root)).toBe(before);
  } finally { f.dispose(); }
});

test("missing required dependencies cannot be counted as absent optional peers", () => {
  const f = fixture();
  try {
    rmSync(join(f.root, "node_modules/zod"), { recursive: true });
    expect(() => verifyProducerDependencies(f.root)).toThrow("missing required zod");
  } finally { f.dispose(); }
});

test("root manifest drift refuses the selected frozen lock", () => {
  const f = fixture();
  try {
    f.manifest.dependencies.zod = "^3.0.0"; write(join(f.root, "package.json"), f.manifest);
    expect(() => verifyProducerDependencies(f.root)).toThrow("root dependencies mismatch");
  } finally { f.dispose(); }
});

test("same-version external symlinks cannot escape the selected graph", () => {
  const f = fixture();
  try {
    const foreign = join(f.owner, "outside"); mkdirSync(foreign);
    write(join(foreign, "package.json"), { name: "zod", version: "4.5.4" });
    rmSync(join(f.root, "node_modules/zod"), { recursive: true }); symlinkSync(foreign, join(f.root, "node_modules/zod"));
    expect(() => verifyProducerDependencies(f.root)).toThrow("escapes selected dependency graph");
  } finally { f.dispose(); }
});

test("required peers refuse absence even when their lock entry exists", () => {
  const f = fixture();
  try {
    (f.lock.packages.adapter[2] as { optionalPeers: string[] }).optionalPeers = [];
    write(join(f.root, "bun.lock"), f.lock);
    expect(() => verifyProducerDependencies(f.root)).toThrow("missing required optional");
  } finally { f.dispose(); }
});

test("unlocked installed optional peers and additional metadata edges both refuse", () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, "node_modules/optional")); write(join(f.root, "node_modules/optional/package.json"), { name: "optional", version: "1.0.0" });
    expect(() => verifyProducerDependencies(f.root)).toThrow("unlocked installed optional");
    rmSync(join(f.root, "node_modules/optional"), { recursive: true });
    write(join(f.root, "node_modules/adapter/package.json"), { ...f.adapter, dependencies: { ...f.adapter.dependencies, unexpected: "1.0.0" } });
    expect(() => verifyProducerDependencies(f.root)).toThrow("locked metadata differs");
  } finally { f.dispose(); }
});
