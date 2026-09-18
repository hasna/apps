import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config, ProfileAssetBinding, ProfileConfigBinding } from "../types/index.js";
import { compileAssetPlan, configAssetDigest, configAssetLocator, selectAssetCapability } from "./asset-plan.js";
import { planProfileSessionRender } from "./instruction-graph.js";
import { applySessionRender, restoreSessionRenderSnapshot } from "./session-apply.js";
import { refreshSessionRender } from "./session-refresh.js";
import type { ConfigStore } from "../data/config-store.js";
import { makeTempRoot } from "./test-temp-root.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
function config(id: string, content: string): Config { return { id, slug: id, name: id, content, kind: "reference", category: "rules", agent: "global", target_path: null, outputs: [], format: "markdown", description: null, tags: [], is_template: false, version: 1, created_at: "2026-09-18", updated_at: "2026-09-18", synced_at: null }; }
describe("native custom-agent asset refresh", () => {
  test.each(["claude", "sumi"] as const)("%s adopts scoped role bytes and refreshes only an explicitly repinned hosted asset", async (tool) => {
    const targetHome = makeTempRoot("instructions-custom-agent-"); roots.push(targetHome);
    const version = tool === "claude" ? "2.1.276" : "0.2.22";
    const surface = tool === "claude" ? "code" : "cli";
    const profile = { id: "profile-role", name: "profile-role", slug: "profile-role" };
    const rule = config("shared-base", "Synthetic shared base.");
    let role = config("role-source", "---\nname: auditor\ndescription: Synthetic scoped reviewer\n---\nREVIEWED_ROLE_V1\n");
    const bindings: ProfileConfigBinding[] = [{ profile_id: profile.id, config_id: rule.id, sort_order: 0, binding: { schema: "hasna.instructions.profile-config-binding/v1", activation: { mode: "always" }, required: true, fallback: "fail" } }];
    const asset = (): ProfileAssetBinding => ({ profile_id: profile.id, source_config_id: role.id, sort_order: 0,
      binding: { schema: "hasna.instructions.profile-asset-binding/v1", assetKey: "scoped-auditor", kind: "custom-agent", enabled: true, required: true,
        selector: { provider: tool, versionRange: version, surface, scope: "global" },
        source: { kind: "custom-agent", locator: configAssetLocator(role.id, role.version), digest: configAssetDigest(role.content), immutable: true, allowed: true },
        destination: { strategy: "emit-file", root: "target-home", relativePath: "agents/./auditor.md" }, uninstall: "remove-managed", rollback: "snapshot" } });
    let assetBinding = asset();
    const selector = { schema: "hasna.instructions.hosted-profile-selector/v1" as const, authority: "https://instructions.example.test/v1", profileId: profile.id, providerVersion: version, manual: [], codewithNativeImports: false, allowEmptySources: false, stationProfile: false, checkGlobalCoverage: false, assetScope: "global" as const, assetSurface: surface };
    const plan = planProfileSessionRender({ tool, profile: profile.slug, profile_id: profile.id, provider_version: version, targetHome, configs: [rule], bindings, asset_configs: [role], asset_bindings: [assetBinding], asset_scope: "global", asset_surface: surface, asset_plan_mode: "apply", refreshSelector: selector });
    mkdirSync(join(targetHome, "agents")); const rolePath = join(targetHome, "agents/auditor.md"); writeFileSync(rolePath, "Preserve original role.\r\n");
    const initial = applySessionRender(plan, { adoptFiles: [{ relativePath: "agents/auditor.md", sha256: hash(readFileSync(rolePath)) }] });
    expect(initial.applied).toBe(true); expect(initial.adoptions).toHaveLength(1);
    expect(readFileSync(rolePath, "utf8")).toBe(role.content);
    const nativeRoot = readFileSync(join(targetHome, tool === "claude" ? "CLAUDE.md" : "AGENTS.md"), "utf8");
    expect(nativeRoot).not.toContain("REVIEWED_ROLE_V1");
    const store = { mode: "api", v1BaseUrl: selector.authority, getProfile: async () => profile, getProfileConfigs: async () => [rule], getProfileConfigBindings: async () => bindings,
      getProfileAssetBindings: async () => [assetBinding], getConfigById: async () => role, listConfigs: async () => [] } as unknown as ConfigStore;
    expect((await refreshSessionRender({ targetHome, store })).status).toBe("unchanged");
    role = { ...role, version: 2, content: role.content.replace("V1", "V2") };
    await expect(refreshSessionRender({ targetHome, store })).rejects.toThrow();
    expect(readFileSync(rolePath, "utf8")).toContain("REVIEWED_ROLE_V1");
    assetBinding = asset(); const update = await refreshSessionRender({ targetHome, store });
    expect(update.status).toBe("updated"); expect(readFileSync(rolePath, "utf8")).toContain("REVIEWED_ROLE_V2");
    expect((await refreshSessionRender({ targetHome, store })).status).toBe("unchanged");
    expect(restoreSessionRenderSnapshot(update.apply.snapshotPath!).restored).toBe(true);
    expect(readFileSync(rolePath, "utf8")).toContain("REVIEWED_ROLE_V1");
  });
  test("keeps unknown and unsupported role loaders closed", () => {
    expect(selectAssetCapability("codex", "0.155.0", "cli", "custom-agent").support).toBe("unsupported");
    expect(selectAssetCapability("sumi", "0.3.0", "cli", "custom-agent").support).toBe("unsupported");
    expect(selectAssetCapability("claude", "2.1.100", "code", "custom-agent").support).toBe("unsupported");
  });
  test.each(["claude", "sumi"] as const)("%s refuses custom-agent destinations outside its native scoped directory", (provider) => {
    const role = config("role-source", "---\nname: auditor\ndescription: Synthetic scoped reviewer\n---\nSCOPED_ROLE\n");
    const version = provider === "claude" ? "2.1.276" : "0.2.22";
    const surface = provider === "claude" ? "code" : "cli";
    const binding: ProfileAssetBinding = { profile_id: "profile-role", source_config_id: role.id, sort_order: 0, binding: {
      schema: "hasna.instructions.profile-asset-binding/v1", assetKey: "auditor", kind: "custom-agent", enabled: true, required: true,
      selector: { provider, versionRange: version, surface, scope: "global" },
      source: { kind: "custom-agent", locator: configAssetLocator(role.id, role.version), digest: configAssetDigest(role.content), immutable: true, allowed: true },
      destination: { strategy: "emit-file", root: "target-home", relativePath: "agents/auditor.md" }, uninstall: "remove-managed", rollback: "snapshot",
    } };
    const compile = () => compileAssetPlan({ profileId: binding.profile_id, provider, providerVersion: version, surface, scope: "global", mode: "apply", configs: [role], bindings: [binding] });
    for (const relativePath of ["rules/auditor.md", "AGENTS.md", "CLAUDE.md", "agents/../rules/auditor.md", "agents/auditor.txt", "agents/nested/auditor.md"]) {
      binding.binding.destination.relativePath = relativePath;
      expect(compile).toThrow("ASSET_CUSTOM_AGENT_DESTINATION_UNSUPPORTED");
    }
    binding.binding.destination = { strategy: "emit-file", root: "project-root", relativePath: "agents/auditor.md" };
    expect(compile).toThrow("ASSET_CUSTOM_AGENT_DESTINATION_UNSUPPORTED");
  });
});
