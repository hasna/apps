import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planSessionRender, type SessionRenderTool } from "./session-render.js";
import { applySessionRender, restoreSessionRenderSnapshot } from "./session-apply.js";
import { planProfileSessionRender } from "./instruction-graph.js";
import { makeTempRoot } from "./test-temp-root.js";
import { PROFILE_CONFIG_BINDING_SCHEMA, type Config, type ProfileConfigBinding } from "../types/index.js";

const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
function root() { const path = makeTempRoot("instructions-native-profile-"); roots.push(path); return path; }
const sources = [{ id: "owned-operating-rule", layer: "global" as const, content: "Preserve the operator's existing account files." }];

for (const tool of ["grok", "devin"] as const) {
  test(`${tool} explicit native home renders global instructions and snapshots later updates`, () => {
    const targetHome = join(root(), tool === "grok" ? ".grok" : "config/devin");
    mkdirSync(targetHome, { recursive: true });
    const credential = join(targetHome, "owned-auth-fixture");
    writeFileSync(credential, "unchanged-fixture", { mode: 0o600 });
    const input = { tool, profile: "account-one", targetHome, sources };
    const plan = planSessionRender(input);
    expect(plan.blocked).toBe(false);
    expect(plan.targetKind).toBe("session-home");
    expect(plan.targetOwner.kind).toBe("provider-profile");
    expect(plan.files.map(file => file.relativePath)).toEqual(["AGENTS.md"]);
    expect(plan.manifest.env).toEqual(tool === "grok" ? { GROK_HOME: targetHome } : {});
    expect(existsSync(join(targetHome, "AGENTS.md"))).toBe(false);
    expect(applySessionRender(plan).applied).toBe(true);
    const original = readFileSync(join(targetHome, "AGENTS.md"), "utf8");
    expect(original).toContain(sources[0]!.content);
    const updated = applySessionRender(planSessionRender({ ...input, sources: [{ ...sources[0]!, content: "Updated owned instruction." }] }));
    expect(updated.snapshotPath).toBeTruthy();
    expect(readFileSync(join(targetHome, "AGENTS.md"), "utf8")).toContain("Updated owned instruction.");
    restoreSessionRenderSnapshot(updated.snapshotPath!);
    expect(readFileSync(join(targetHome, "AGENTS.md"), "utf8")).toBe(original);
    expect(readFileSync(credential, "utf8")).toBe("unchanged-fixture");
  });

  test(`${tool} retains explicit project rendering and never infers a global home`, () => {
    const targetHome = join(root(), "profile");
    const projectRoot = join(root(), "project");
    const project = planSessionRender({ tool, profile: "account-one", targetHome, projectRoot, sources });
    expect(project.targetKind).toBe("project-root");
    expect(project.targetHome).toBe(projectRoot);
    expect(project.files[0]!.relativePath).toBe(tool === "grok" ? "AGENTS.md" : ".devin/rules/01-owned-operating-rule.md");
    expect(planSessionRender({ tool, profile: "account-one", sources }).blocked).toBe(true);
    expect(planSessionRender({ tool, profile: "account-one", targetHome: " ", sources }).blocked).toBe(true);
    expect(existsSync(targetHome)).toBe(false);
  });

  test(`${tool} native apply refuses unmanaged rules and symlink targets`, () => {
    const targetHome = root();
    const instruction = join(targetHome, "AGENTS.md");
    writeFileSync(instruction, "Operator-owned rules\n");
    const plan = planSessionRender({ tool, profile: "account-one", targetHome, sources });
    const refused = applySessionRender(plan);
    expect(refused.applied).toBe(false);
    expect(refused.conflicts[0]?.reason).toContain("unmanaged");
    expect(existsSync(join(targetHome, ".hasna", "session-render-manifest.json"))).toBe(false);
    expect(readFileSync(instruction, "utf8")).toBe("Operator-owned rules\n");
    rmSync(instruction);
    const outside = join(root(), "outside.md");
    writeFileSync(outside, "Outside instructions\n");
    symlinkSync(outside, instruction);
    expect(() => applySessionRender(plan)).toThrow();
    expect(readFileSync(outside, "utf8")).toBe("Outside instructions\n");
  });
}

test("native compiled profiles describe flattened global loading and reject implicit conditional promotion", () => {
  const config = { id: "rule", name: "rule", slug: "rule", kind: "file", category: "rules", agent: "global", target_path: null,
    outputs: [], format: "markdown", content: "Profile-bound rule.", description: null, tags: [], is_template: false,
    version: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", synced_at: null } as Config;
  const binding: ProfileConfigBinding = { profile_id: "profile", config_id: config.id, sort_order: 0,
    binding: { schema: PROFILE_CONFIG_BINDING_SCHEMA, activation: { mode: "always" }, required: true, fallback: "fail" } };
  for (const tool of ["grok", "devin"] as SessionRenderTool[]) {
    const input = { tool, profile: "account-one", profile_id: "profile", provider_version: tool === "grok" ? "1.0.13" : "3000.10.21",
      targetHome: root(), configs: [config], bindings: [binding] };
    const plan = planProfileSessionRender(input);
    expect(plan.instructionGraph.capability.provider_variant).toBe("native-profile");
    expect(plan.instructionGraph.capability.selected_representation).toBe("flattened");
    expect(plan.instructionGraph.capability.loading_path).toBe("AGENTS.md");
    expect(() => planProfileSessionRender({ ...input, bindings: [{ ...binding,
      binding: { ...binding.binding, activation: { mode: "glob", globs: ["src/**"] } } }] })).toThrow();
    expect(() => planProfileSessionRender({ ...input, projectRoot: root(), graph_context: { provider_variant: "native-profile" } })).toThrow("--target-home");
  }
});
