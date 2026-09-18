import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { expect, test } from "bun:test";
import { buildPluginProjection, pluginTreeDigest, type PluginProjectionManifest } from "./plugin-projection.js";
import type { SkillBundleEntry } from "./skill-bundle.js";

const entry = (path: string, text: string): SkillBundleEntry => ({ path, bytes: new TextEncoder().encode(text), mode: 0o644 });
function fixture(extra: SkillBundleEntry[] = []) {
  const original = [entry(".claude-plugin/plugin.json", JSON.stringify({ name: "fixture", version: "1.0.0", skills: ["./extra"], commands: ["./custom"] })),
    entry("skills/one/SKILL.md", "Synthetic skill"), entry("extra/two/SKILL.md", "Synthetic extra skill"),
    entry("commands/old.md", "Synthetic dormant command"), entry("custom/current.md", "Synthetic command"),
    entry("agents/observer.md", "Synthetic ordinary agent"), entry("assets/a.txt", "Synthetic asset"), ...extra];
  const payloads = original.filter(item => item.path.endsWith("SKILL.md") || /^(commands|custom)\/.*\.md$/.test(item.path));
  const manifest: PluginProjectionManifest = { schemaVersion: 1, agent: "claude", pluginId: "fixture@synthetic", upstream: { source: "https://example.com/synthetic", revision: "fixture-revision", version: "1.0.0", license: "MIT", treeDigest: pluginTreeDigest(original) }, review: { hooks: "reviewed-no-skill-injection", dependencies: "reviewed-no-retired-payload-dependency" }, payloads: payloads.map(item => ({ path: item.path, kind: item.path.endsWith("SKILL.md") ? "skill" : "command", sourceDigest: pluginTreeDigest([item]), target: { slug: "synthetic-payload", version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}` } })) };
  return { original, manifest, entries: [entry("plugin-projection.json", JSON.stringify(manifest)), ...original.map(item => ({ ...item, path: `original/${item.path}` }))] };
}
test("projection retires default, custom and dormant command prompts and preserves ordinary bytes", () => {
  const f = fixture(), result = buildPluginProjection(f.entries);
  expect(result.payloads).toHaveLength(4);
  expect(result.files.map(file => file.path)).toEqual([".claude-plugin/plugin.json", "agents/observer.md", "assets/a.txt"]);
  expect(result.files.find(file => file.path === "agents/observer.md")?.bytes).toEqual(f.original.find(file => file.path === "agents/observer.md")?.bytes);
  expect(JSON.parse(new TextDecoder().decode(result.files[0]!.bytes))).toEqual({ name: "fixture", version: "1.0.0" });
});
test("unmapped prompt, provenance mutation, package install and removed-file dependency all refuse", () => {
  for (const change of ["mapping", "digest", "install", "dependency"]) {
    const f = fixture(change === "install" ? [entry("package.json", '{"scripts":{"install":"false"}}')] : change === "dependency" ? [entry("tools/a.sh", "cat skills/one/SKILL.md")] : []);
    if (change === "mapping") f.manifest.payloads.pop();
    if (change === "digest") f.manifest.upstream.treeDigest = `sha256:${"0".repeat(64)}`;
    f.entries[0] = entry("plugin-projection.json", JSON.stringify(f.manifest));
    expect(() => buildPluginProjection(f.entries)).toThrow();
  }
});
test("case-insensitive command roots cannot reseed prompts on macOS", () => {
  const f = fixture([entry("Commands/case-alias.md", "Synthetic command alias")]);
  expect(() => buildPluginProjection(f.entries)).toThrow("mapping");
});
test("overlapping skill roots cannot silently remove declared ordinary components", () => {
  for (const path of ["./assets/a.txt", "./assets/./a.txt", "./other/../assets/a.txt", "./assets//a.txt"]) {
    const f = fixture();
    f.original[0] = entry(".claude-plugin/plugin.json", JSON.stringify({ name: "fixture", version: "1.0.0", skills: ["./extra", "./assets"], commands: ["./custom"], agents: [path] }));
    f.manifest.upstream.treeDigest = pluginTreeDigest(f.original);
    const entries = [entry("plugin-projection.json", JSON.stringify(f.manifest)), ...f.original.map(item => ({ ...item, path: `original/${item.path}` }))];
    expect(() => buildPluginProjection(entries)).toThrow("ordinary component");
  }
});

function unversionedFixture(extra: SkillBundleEntry[] = [], nativeFields: Record<string, unknown> = {}) {
  const f = fixture([entry("README.md", "See commands/old.md for the original command documentation."), ...extra]);
  f.original[0] = entry(".claude-plugin/plugin.json", JSON.stringify({ name: "fixture", skills: ["./extra"], commands: ["./custom"], ...nativeFields }));
  const manifest = { ...f.manifest, schemaVersion: 2, upstream: { ...f.manifest.upstream, version: null, revision: "a".repeat(40), treeDigest: pluginTreeDigest(f.original) }, review: { ...f.manifest.review, documentation: [{ path: "README.md", sourceDigest: pluginTreeDigest([f.original.find(item => item.path === "README.md")!]) }] } };
  return { original: f.original, manifest, entries: () => [entry("plugin-projection.json", JSON.stringify(manifest)), ...f.original.map(item => ({ ...item, path: `original/${item.path}` }))] };
}
test("versionless immutable upstream preserves manifest and explicitly reviewed README bytes", () => {
  const f = unversionedFixture(), result = buildPluginProjection(f.entries());
  expect(result.manifest.upstream.version).toBeNull();
  expect(JSON.parse(new TextDecoder().decode(result.files.find(item => item.path === ".claude-plugin/plugin.json")!.bytes))).toEqual({ name: "fixture" });
  expect(result.files.find(item => item.path === "README.md")!.bytes).toEqual(f.original.find(item => item.path === "README.md")!.bytes);
});
test("schema one cannot acquire null versions or documentation exceptions", () => {
  const f = unversionedFixture(); f.manifest.schemaVersion = 1;
  expect(() => buildPluginProjection(f.entries())).toThrow();
});
test("versionless identity refuses invented or mutable provenance and declared native versions", () => {
  for (const revision of ["main", "1aa8f02ec832", "a".repeat(39), "A".repeat(40)]) {
    const f = unversionedFixture(); f.manifest.upstream.revision = revision;
    expect(() => buildPluginProjection(f.entries())).toThrow();
  }
  for (const version of ["1.0.0", null, "", 7]) {
    const f = unversionedFixture([], { version });
    expect(() => buildPluginProjection(f.entries())).toThrow();
  }
});
test("documentation exemption cannot hide runtime dependencies or selected components", () => {
  for (const nativeFields of [{ agents: "./README.md" }, { agents: "./" }, { hooks: "./README.md" }, { mcpServers: { fixture: { command: "cat README.md" } } }]) {
    const f = unversionedFixture([], nativeFields);
    expect(() => buildPluginProjection(f.entries())).toThrow();
  }
  for (const path of ["tools/run.sh", "agents/observer-2.md", "hooks/hooks.json", "CLAUDE.md"]) {
    const f = unversionedFixture([entry(path, "Read README.md")]);
    expect(() => buildPluginProjection(f.entries())).toThrow();
  }
  const executable = unversionedFixture(); executable.original.find(item => item.path === "README.md")!.mode = 0o755;
  executable.manifest.upstream.treeDigest = pluginTreeDigest(executable.original);
  executable.manifest.review.documentation[0]!.sourceDigest = pluginTreeDigest([executable.original.find(item => item.path === "README.md")!]);
  expect(() => buildPluginProjection(executable.entries())).toThrow();
});
test("documentation review is exact, bounded, and never inferred from markdown extension", () => {
  for (const change of ["missing", "digest", "path", "duplicate", "runtime"]) {
    const f = unversionedFixture(change === "runtime" ? [entry("agents/runtime.md", "Read commands/old.md")] : []);
    if (change === "missing") f.manifest.review.documentation = [];
    if (change === "digest") f.manifest.review.documentation[0]!.sourceDigest = `sha256:${"0".repeat(64)}`;
    if (change === "path") f.manifest.review.documentation[0]!.path = "agents/runtime.md";
    if (change === "duplicate") f.manifest.review.documentation.push(f.manifest.review.documentation[0]!);
    expect(() => buildPluginProjection(f.entries())).toThrow();
  }
});

test("schema two supports exact declared versions and preserves absent native version bytes", () => {
  const declared = unversionedFixture([], { version: "2.0.0" });
  const declaredManifest = { ...declared.manifest, upstream: { ...declared.manifest.upstream, version: "2.0.0" } };
  const result = buildPluginProjection([entry("plugin-projection.json", JSON.stringify(declaredManifest)), ...declared.original.map(item => ({ ...item, path: `original/${item.path}` }))]);
  expect(result.manifest.upstream.version).toBe("2.0.0");
  const absent = unversionedFixture(); absent.original[0] = entry(".claude-plugin/plugin.json", '{ "name": "fixture" }\n');
  // Remove the custom payloads when their native custom roots are absent.
  absent.original = absent.original.filter(item => !item.path.startsWith("custom/") && !item.path.startsWith("extra/"));
  absent.manifest.payloads = absent.manifest.payloads.filter(item => !item.path.startsWith("custom/") && !item.path.startsWith("extra/"));
  absent.manifest.upstream.treeDigest = pluginTreeDigest(absent.original);
  const projected = buildPluginProjection([entry("plugin-projection.json", JSON.stringify(absent.manifest)), ...absent.original.map(item => ({ ...item, path: `original/${item.path}` }))]);
  expect(projected.files.find(item => item.path === ".claude-plugin/plugin.json")!.bytes).toEqual(absent.original[0]!.bytes);
});
