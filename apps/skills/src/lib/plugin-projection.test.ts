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
