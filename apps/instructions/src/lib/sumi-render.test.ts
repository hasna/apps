import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_AGENTS, CONFIG_TRANSFORMS, type Config, type ProfileConfigBinding, type ProfileConfigBindingSpec } from "../types/index.js";
import { selectAssetCapability } from "./asset-plan.js";
import { isSupportedConfigAgent } from "./config-agents.js";
import { legacyProfileConfigBinding, planProfileSessionRender, PROVIDER_CAPABILITIES } from "./instruction-graph.js";
import { applySessionRender, checkSessionRenderDrift, restoreSessionRenderSnapshot } from "./session-apply.js";
import { planSessionRender, selectProfileConfigsForSessionRender, type SessionInstructionSource } from "./session-render.js";
import { sessionRenderOwnsPath } from "./session-render-ownership.js";
import { makeTempRoot } from "./test-temp-root.js";
import { applyTransform } from "./transforms.js";

const roots: string[] = [];
function root(): string {
  const value = makeTempRoot("instructions-sumi-");
  roots.push(value);
  return value;
}
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });

const source: SessionInstructionSource = {
  id: "knowledge-work",
  content: "SUMI_KNOWLEDGE_SENTINEL\nCheck the source before updating reviewed knowledge.",
  targetProviders: ["sumi"],
};

function config(id: string, agent: Config["agent"] = "global"): Config {
  return {
    id, name: id, slug: id, kind: "file", category: "rules", agent,
    target_path: null, outputs: [], format: "markdown", content: `${id}_SENTINEL`,
    description: null, tags: [], is_template: false, version: 1,
    created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z", synced_at: null,
  };
}
function binding(configId: string, overrides: Partial<ProfileConfigBindingSpec> = {}): ProfileConfigBinding {
  return { profile_id: "curated", config_id: configId, sort_order: 0, binding: { ...legacyProfileConfigBinding(), ...overrides } };
}
function compiled(targetHome: string, overrides: Partial<ProfileConfigBindingSpec> = {}) {
  return planProfileSessionRender({
    tool: "sumi", profile: "knowledge-work", profile_id: "curated", targetHome,
    provider_version: "0.2.22", configs: [config("reviewed-rule")], bindings: [binding("reviewed-rule", overrides)],
  });
}

describe("Sumi native instruction rendering", () => {
  test("registers independently from OpenCode and transforms explicitly selected sources", () => {
    expect(CONFIG_AGENTS).toContain("sumi");
    expect(CONFIG_TRANSFORMS).toContain("sumi-flat");
    expect(isSupportedConfigAgent("sumi")).toBe(true);
    expect(PROVIDER_CAPABILITIES.sumi).toMatchObject({
      provider: "sumi", loading_path: "AGENTS.md", activation_modes: ["always"], native_imports: false,
      conditional_artifacts: false, selected_representation: "flattened",
    });
    expect(selectAssetCapability("sumi", "0.2.22", "cli", "plugin").support).toBe("unsupported");
    const input = { ...config("canonical", "claude"), content: "Shared rule.\n<!-- claude-only:start -->\nClaude-only setup.\n<!-- claude-only:end -->" };
    const output = applyTransform(input, { agent: "sumi", transform: "sumi-flat", target_path: "/explicit/AGENTS.md" });
    expect(output).toContain("Shared rule.");
    expect(output).not.toContain("Claude-only setup.");
  });

  test("requires an explicit discovered global target rather than assuming OpenCode config", () => {
    const plan = planSessionRender({ tool: "sumi", profile: "knowledge-work", sources: [source] });
    expect(plan.blocked).toBe(true);
    expect(plan.blockers.join(" ")).toContain("sumi debug paths config");
    expect(plan.files).toEqual([]);
    expect(plan.env).toEqual({});
  });

  test("renders exactly one native file at the actual config target and filters providers", () => {
    const targetHome = join(root(), "launcher-config");
    const plan = planSessionRender({
      tool: "sumi", profile: "knowledge-work", targetHome,
      sources: [source, { id: "global", content: "GLOBAL_SENTINEL" }, { id: "other", content: "OPENCODE_ONLY_SENTINEL", targetProviders: ["opencode"] }],
    });
    expect(plan.blocked).toBe(false);
    expect(plan.targetKind).toBe("session-home");
    expect(plan.env).toEqual({ SUMI_CONFIG_DIR: targetHome });
    expect(plan.files.map((file) => file.relativePath)).toEqual(["AGENTS.md"]);
    expect(plan.files[0]!.content.split("SUMI_KNOWLEDGE_SENTINEL").length - 1).toBe(1);
    expect(plan.files[0]!.content).toContain("GLOBAL_SENTINEL");
    expect(plan.files[0]!.content).not.toContain("OPENCODE_ONLY_SENTINEL");
    expect(plan.manifest.skippedSources.some((entry) => entry.id === "other")).toBe(true);
    expect(plan.manifest.targetOwner.writer.id).toBe("instructions-session-renderer");
    expect(plan.allFiles.some((file) => /opencode|sumi\.json/.test(file.relativePath))).toBe(false);
  });

  test("selects the explicit repository root without redirecting global Sumi configuration", () => {
    const base = root();
    const globalHome = join(base, "global-config");
    const projectRoot = join(base, "repository");
    mkdirSync(globalHome);
    mkdirSync(projectRoot);
    writeFileSync(join(globalHome, "AGENTS.md"), "Existing global instructions.\n");
    const plan = planSessionRender({ tool: "sumi", profile: "project-work", targetHome: globalHome, projectRoot, sources: [source] });
    expect(plan.targetHome).toBe(projectRoot);
    expect(plan.targetKind).toBe("project-root");
    expect(plan.targetOwner.kind).toBe("project");
    expect(plan.env).toEqual({});
    expect(applySessionRender(plan).applied).toBe(true);
    expect(readFileSync(join(projectRoot, "AGENTS.md"), "utf8")).toContain("SUMI_KNOWLEDGE_SENTINEL");
    expect(readFileSync(join(globalHome, "AGENTS.md"), "utf8")).toBe("Existing global instructions.\n");
  });

  test("selects Sumi and global profile rules without importing provider configs or unrelated rules", () => {
    const configs = [config("global"), config("sumi", "sumi"), config("opencode", "opencode"), { ...config("settings", "sumi"), category: "agent" as const, format: "json" as const, content: "{}" }];
    const selection = selectProfileConfigsForSessionRender(configs, "sumi");
    expect(selection.sources.map((entry) => entry.id)).toEqual(["global", "sumi"]);
    expect(selection.skippedSources.map((entry) => entry.id)).toEqual(["opencode", "settings"]);
    const graph = planProfileSessionRender({
      tool: "sumi", profile: "knowledge-work", profile_id: "curated", targetHome: root(), provider_version: "0.2.22",
      configs: configs.slice(0, 3),
      bindings: [binding("global"), binding("sumi", { providers: [{ provider: "sumi" }] }), binding("opencode", { providers: [{ provider: "opencode" }] })],
    });
    expect(graph.instructionGraph.units.map((unit) => unit.config_id)).toEqual(["global", "sumi"]);
    expect(graph.files[0]!.content).not.toContain("opencode_SENTINEL");
  });

  test("profile output transforms cannot import unrelated Claude rule members", () => {
    const exported = {
      ...config("exported", "claude"),
      outputs: [{ agent: "codex" as const, transform: "codex-flat" as const, target_path: "/configured/AGENTS.md" }],
    };
    const privateRule = { ...config("claude-only", "claude"), target_path: "/configured/claude/rules/private.md" };
    const selection = selectProfileConfigsForSessionRender([exported, privateRule], "codex");
    expect(selection.sources.map((entry) => entry.id)).toEqual(["exported"]);
    expect(selection.sources[0]!.content).toContain("exported_SENTINEL");
    expect(selection.sources[0]!.content).not.toContain("claude-only_SENTINEL");
    expect(selection.skippedSources.some((entry) => entry.id === "claude-only")).toBe(true);
  });

  test("rejects unsupported conditional rules and unverified versions, with explicit fallback readback", () => {
    const targetHome = root();
    expect(() => compiled(targetHome, { activation: { mode: "glob", globs: ["docs/**"] } })).toThrow("REQUIRED_CAPABILITY_UNSUPPORTED");
    for (const conditional of [
      { ...source, globs: ["docs/**"] },
      { ...source, metadata: { activation: { mode: "manual" } } },
      { ...source, rules: [{ id: "conditional", content: "Scoped rule.", globs: ["docs/**"] }] },
    ]) {
      expect(() => planSessionRender({ tool: "sumi", profile: "knowledge-work", targetHome, sources: [conditional] })).toThrow("cannot preserve conditional activation");
    }
    const fallback = compiled(targetHome, { activation: { mode: "glob", globs: ["docs/**"] }, fallback: "flatten" });
    expect(fallback.instructionGraph.units[0]!.effective_activation.mode).toBe("always");
    expect(fallback.instructionGraph.diagnostics.some((entry) => entry.code === "FALLBACK_APPLIED")).toBe(true);
    expect(fallback.files[0]!.content).toContain("reviewed-rule_SENTINEL");
    for (const provider_version of ["0.2.21", "0.3.0"]) {
      expect(() => planProfileSessionRender({
        tool: "sumi", profile: "knowledge-work", profile_id: "curated", targetHome, provider_version,
        configs: [config("rule")], bindings: [binding("rule")],
      })).toThrow("PROVIDER_VERSION_UNSUPPORTED");
    }
  });

  test("repeat render is stable, snapshots restore exact bytes, and unmanaged files are preserved", () => {
    const targetHome = root();
    writeFileSync(join(targetHome, "sumi.json"), '{"unmanaged":true}\n');
    const original = planSessionRender({ tool: "sumi", profile: "knowledge-work", targetHome, sources: [source], generatedAt: "2026-09-18T00:00:00.000Z" });
    expect(applySessionRender(original).applied).toBe(true);
    const originalBytes = readFileSync(join(targetHome, "AGENTS.md"), "utf8");
    expect(sessionRenderOwnsPath(join(targetHome, "AGENTS.md"))).toBe(true);
    const repeated = applySessionRender(original);
    expect(repeated.conflicts).toEqual([]);
    expect(readFileSync(join(targetHome, "AGENTS.md"), "utf8")).toBe(originalBytes);
    expect(checkSessionRenderDrift(targetHome).clean).toBe(true);
    const changed = planSessionRender({ tool: "sumi", profile: "knowledge-work", targetHome, sources: [{ ...source, content: "Updated reviewed instruction." }], generatedAt: "2026-09-18T00:01:00.000Z" });
    const applied = applySessionRender(changed);
    expect(applied.applied).toBe(true);
    expect(applied.snapshotPath).not.toBeNull();
    expect(readFileSync(join(targetHome, "AGENTS.md"), "utf8")).toContain("Updated reviewed instruction.");
    expect(restoreSessionRenderSnapshot(applied.snapshotPath!).restored).toBe(true);
    expect(readFileSync(join(targetHome, "AGENTS.md"), "utf8")).toBe(originalBytes);
    expect(readFileSync(join(targetHome, "sumi.json"), "utf8")).toBe('{"unmanaged":true}\n');
    expect(checkSessionRenderDrift(targetHome).clean).toBe(true);
  });

  test("existing unmanaged instructions and symlink targets are protected", () => {
    const targetHome = root();
    const agentsPath = join(targetHome, "AGENTS.md");
    writeFileSync(agentsPath, "Existing operator instructions.\n");
    const plan = planSessionRender({ tool: "sumi", profile: "knowledge-work", targetHome, sources: [source] });
    const result = applySessionRender(plan);
    expect(result.applied).toBe(false);
    expect(result.conflicts.some((entry) => entry.relativePath === "AGENTS.md")).toBe(true);
    expect(readFileSync(agentsPath, "utf8")).toBe("Existing operator instructions.\n");
    expect(existsSync(join(targetHome, ".hasna/session-render-manifest.json"))).toBe(false);
    rmSync(agentsPath);
    const outside = join(root(), "outside.md");
    writeFileSync(outside, "Protected outside file.\n");
    symlinkSync(outside, agentsPath);
    expect(() => applySessionRender(plan)).toThrow("symlink");
    expect(readFileSync(outside, "utf8")).toBe("Protected outside file.\n");
  });
});
