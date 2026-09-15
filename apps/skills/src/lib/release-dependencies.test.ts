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

/** Real Node/Bun resolution, with one tuple instantiated under two peer parents
 * and an ordinary broad-range dependency that is hoisted across those parents. */
function peerContextFixture() {
  const owner = realpathSync(mkdtempSync(join(tmpdir(), "skills-producer-context-"))), root = join(owner, "producer");
  const manifest = { name: "peer-context-fixture", version: "1.0.0", dependencies: { consumer: "1.0.0", a: "1.0.0", b: "1.0.0", adapter: "1.0.0", zod: "^4.0.0" } };
  const consumer = { name: "consumer", version: "1.0.0", peerDependencies: { zod: "^3.0.0 || ^4.0.0" } };
  const parent = (name: string) => ({ name, version: "1.0.0", dependencies: { consumer: "1.0.0", adapter: "1.0.0", zod: "^3.0.0" } });
  const adapter = { name: "adapter", version: "1.0.0", dependencies: { consumer: "1.0.0", zod: "^3.0.0 || ^4.0.0" } };
  const lock: any = { lockfileVersion: 1, workspaces: { "": manifest }, packages: {
    consumer: ["consumer@1.0.0", "", { peerDependencies: consumer.peerDependencies }, "fixture-integrity"],
    a: ["a@1.0.0", "", { dependencies: parent("a").dependencies }, "fixture-integrity"],
    b: ["b@1.0.0", "", { dependencies: parent("b").dependencies }, "fixture-integrity"],
    adapter: ["adapter@1.0.0", "", { dependencies: adapter.dependencies }, "fixture-integrity"],
    zod: ["zod@4.5.4", "", {}, "fixture-integrity"],
    "a/zod": ["zod@3.25.76", "", {}, "fixture-integrity"],
    "b/zod": ["zod@3.25.76", "", {}, "fixture-integrity"],
  } };
  const install = (relative: string, value: unknown) => {
    const directory = join(root, relative); mkdirSync(directory, { recursive: true }); write(join(directory, "package.json"), value); return directory;
  };
  install("node_modules/consumer", consumer); install("node_modules/adapter", adapter);
  install("node_modules/zod", { name: "zod", version: "4.5.4" });
  for (const name of ["a", "b"]) {
    install(`node_modules/${name}`, parent(name));
    install(`node_modules/${name}/node_modules/consumer`, consumer);
    install(`node_modules/${name}/node_modules/zod`, { name: "zod", version: "3.25.76" });
  }
  write(join(root, "package.json"), manifest); write(join(root, "bun.lock"), lock);
  function resolved(parent: string, name: string) {
    const directory = realpathSync(join(root, parent)), node = realpathSync(createRequire(join(directory, "package.json")).resolve(`${name}/package.json`));
    expect(realpathSync(Bun.resolveSync(`${name}/package.json`, directory))).toBe(node);
    return { path: node, ...JSON.parse(readFileSync(node, "utf8")) };
  }
  return { root, owner, lock, consumer, install, resolved, dispose: () => rmSync(owner, { recursive: true, force: true }) };
}

test("one peer tuple retains each parent's binding while ordinary broad-range dependencies use their own hoisted context", () => {
  const f = peerContextFixture();
  try {
    expect(f.resolved("node_modules/consumer", "zod").version).toBe("4.5.4");
    for (const parent of ["a", "b"]) expect(f.resolved(`node_modules/${parent}/node_modules/consumer`, "zod").version).toBe("3.25.76");
    expect(f.resolved("node_modules/adapter", "zod").version).toBe("4.5.4");
    const before = bytes(f.root), result = verifyProducerDependencies(f.root);
    const peers = result.nodes.filter(node => node.name === "consumer");
    expect(new Set(peers.map(node => node.context.zod))).toEqual(new Set(["zod", "a/zod", "b/zod"]));
    expect(result.nodes.filter(node => node.name === "adapter").every(node => node.context.zod === "zod")).toBe(true);
    expect(bytes(f.root)).toBe(before);
  } finally { f.dispose(); }
});

test("same-version peer substitution cannot reuse an earlier physical-package visit from another context", () => {
  const f = peerContextFixture();
  try {
    const path = join(f.root, "node_modules/a/node_modules/consumer"), target = join(f.root, "node_modules/consumer");
    rmSync(path, { recursive: true }); symlinkSync(target, path);
    expect(f.resolved("node_modules/a", "consumer").version).toBe("1.0.0");
    expect(f.resolved("node_modules/a/node_modules/consumer", "zod").version).toBe("4.5.4");
    const before = bytes(f.root);
    expect(() => verifyProducerDependencies(f.root)).toThrow("zod resolved zod@4.5.4, lock requires zod@3.25.76");
    expect(bytes(f.root)).toBe(before); expect(realpathSync(path)).toBe(target);
  } finally { f.dispose(); }
});

test("an ordinary dependency cannot select a different inherited lock entry merely because both satisfy its broad range", () => {
  const f = peerContextFixture();
  try {
    const directory = join(f.root, "node_modules/adapter/node_modules"); mkdirSync(directory);
    symlinkSync(join(f.root, "node_modules/a/node_modules/zod"), join(directory, "zod"));
    expect(f.resolved("node_modules/adapter", "zod").version).toBe("3.25.76");
    expect(Bun.semver.satisfies("3.25.76", "^3.0.0 || ^4.0.0")).toBe(true);
    expect(Bun.semver.satisfies("4.5.4", "^3.0.0 || ^4.0.0")).toBe(true);
    const before = bytes(f.root);
    expect(() => verifyProducerDependencies(f.root)).toThrow("zod resolved zod@3.25.76, lock requires zod@4.5.4");
    expect(bytes(f.root)).toBe(before);
  } finally { f.dispose(); }
});

test("hoisted tuples retain their own nested lock entries after another importing parent", () => {
  const f = peerContextFixture();
  try {
    f.lock.packages["adapter/zod"] = ["zod@3.25.76", "", {}, "fixture-integrity"];
    f.install("node_modules/adapter/node_modules/zod", { name: "zod", version: "3.25.76" });
    // Adapter's ordinary consumer resolves the global tuple, but its peer must
    // now inherit adapter/zod rather than the grandparent a/zod or root zod.
    f.install("node_modules/adapter/node_modules/consumer", f.consumer);
    write(join(f.root, "bun.lock"), f.lock);
    const before = bytes(f.root), result = verifyProducerDependencies(f.root);
    expect(result.nodes.some(node => node.name === "consumer" && node.context.zod === "adapter/zod")).toBe(true);
    expect(f.resolved("node_modules/adapter/node_modules/consumer", "zod").version).toBe("3.25.76");
    expect(bytes(f.root)).toBe(before);
  } finally { f.dispose(); }
});

test("cyclic peer graphs terminate with finite contexts and still inspect each binding", () => {
  const f = peerContextFixture();
  try {
    const consumer = { ...f.consumer, peerDependencies: { ...f.consumer.peerDependencies, a: "1.0.0" } };
    f.lock.packages.consumer[2].peerDependencies = consumer.peerDependencies;
    for (const relative of ["node_modules/consumer", "node_modules/a/node_modules/consumer", "node_modules/b/node_modules/consumer"]) f.install(relative, consumer);
    write(join(f.root, "bun.lock"), f.lock);
    const before = bytes(f.root), result = verifyProducerDependencies(f.root);
    expect(result.nodeCount).toBeLessThan(40); expect(result.edgeCount).toBeLessThan(100);
    expect(new Set(result.nodes.filter(node => node.name === "consumer").map(node => node.context.zod))).toEqual(new Set(["zod", "a/zod", "b/zod"]));
    expect(bytes(f.root)).toBe(before);
  } finally { f.dispose(); }
});
