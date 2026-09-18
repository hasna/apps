import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CloudConfigStore, LocalConfigStore } from "../data/config-store.js";
import type { Config, ProfileConfigBinding } from "../types/index.js";
import type { InstructionsStorageClient } from "./client-types.js";
import { legacyProfileConfigBinding, planProfileSessionRender } from "./instruction-graph.js";
import { applySessionRender, restoreSessionRenderSnapshot } from "./session-apply.js";
import { refreshSessionRender } from "./session-refresh.js";
import type { SessionHostedProfileSelector } from "./session-render.js";
import { makeTempRoot } from "./test-temp-root.js";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const AUTHORITY = "https://instructions.example.test/v1";
const profile = { id: "profile-1", name: "Reviewed", slug: "reviewed", description: null, selectors: {}, variables: {}, created_at: "2026-09-18", updated_at: "2026-09-18" };
const config: Config = {
  id: "rule-1", name: "Rule", slug: "rule", kind: "file", category: "rules", agent: "global", target_path: null,
  outputs: [], format: "markdown", content: "ORIGINAL_HOSTED_RULE", description: null, tags: [], is_template: false,
  version: 1, created_at: "2026-09-18", updated_at: "2026-09-18", synced_at: null,
};
const binding: ProfileConfigBinding = { profile_id: profile.id, config_id: config.id, sort_order: 0, binding: legacyProfileConfigBinding() };
const selector: SessionHostedProfileSelector = {
  schema: "hasna.instructions.hosted-profile-selector/v1", authority: AUTHORITY, profileId: profile.id, providerVersion: "0.2.22",
  manual: [], codewithNativeImports: false, allowEmptySources: false, stationProfile: false, checkGlobalCoverage: false,
};
function fixture() {
  const targetHome = makeTempRoot("instructions-refresh-"); roots.push(targetHome);
  const state = { configs: [{ ...config }], calls: [] as string[], failStatus: 0, missingBindings: false, missingAssets: false, onRead: undefined as (() => void) | undefined };
  const request = async <T>(_method: string, path: string): Promise<T> => {
    state.calls.push(path); state.onRead?.();
    const error = (status: number) => Object.assign(new Error(`Synthetic HTTP ${status}`), { status, name: "HasnaHttpError" });
    if (state.failStatus) throw error(state.failStatus);
    if (path.includes("/bindings")) { if (state.missingBindings) throw error(404); return { bindings: [binding] } as T; }
    if (path.includes("/assets")) { if (state.missingAssets) throw error(404); return { assets: [] } as T; }
    if (path.startsWith("/profiles?")) return { profiles: [profile] } as T;
    if (path.startsWith("/profiles/profile-1")) return { profile: { ...profile, configs: state.configs } } as T;
    throw new Error(`Unexpected fixture request: ${path}`);
  };
  const store = new CloudConfigStore({ name: "instructions", baseUrl: AUTHORITY, transport: { baseUrl: AUTHORITY, request } } as InstructionsStorageClient);
  const plan = planProfileSessionRender({
    tool: "sumi", profile: "knowledge", profile_id: profile.id, provider_version: "0.2.22", targetHome,
    configs: state.configs, bindings: [binding], asset_plan_mode: "apply", refreshSelector: selector,
  });
  expect(applySessionRender(plan).applied).toBe(true);
  return { targetHome, state, store, manifestPath: join(targetHome, ".hasna/session-render-manifest.json"), agentsPath: join(targetHome, "AGENTS.md") };
}
describe("hosted session refresh", () => {
  test("queries hosted profile on every unchanged refresh and writes no files", async () => {
    const { targetHome, store, state, manifestPath, agentsPath } = fixture();
    const manifest = readFileSync(manifestPath, "utf8"), mtime = statSync(manifestPath).mtimeMs, original = readFileSync(agentsPath, "utf8");
    for (let invocation = 0; invocation < 2; invocation++) {
      state.calls.length = 0;
      const result = await refreshSessionRender({ targetHome, store });
      expect(result.status).toBe("unchanged"); expect(result.apply.applied).toBe(false); expect(result.apply.snapshotPath).toBeNull();
      expect(result.apply.files.every((file) => file.action === "unchanged")).toBe(true);
      expect(state.calls.some((path) => path.includes("/bindings"))).toBe(true);
      expect(state.calls.some((path) => path.includes("/assets"))).toBe(true);
      expect(state.calls.some((path) => path.includes("limit=100"))).toBe(true);
      expect(readFileSync(manifestPath, "utf8")).toBe(manifest); expect(statSync(manifestPath).mtimeMs).toBe(mtime);
      expect(readFileSync(agentsPath, "utf8")).toBe(original);
    }
  });
  test("updates from current hosted bytes, retains selector, and creates a restorable snapshot", async () => {
    const { targetHome, store, state, manifestPath, agentsPath } = fixture();
    const original = readFileSync(agentsPath, "utf8"); state.configs = [{ ...config, version: 2, content: "NEW_HOSTED_RULE" }];
    expect((await refreshSessionRender({ targetHome, store, dryRun: true })).status).toBe("dry-run");
    expect(readFileSync(agentsPath, "utf8")).toBe(original);
    const result = await refreshSessionRender({ targetHome, store });
    expect(result.status).toBe("updated"); expect(result.apply.snapshotPath).not.toBeNull();
    expect(readFileSync(agentsPath, "utf8")).toContain("NEW_HOSTED_RULE"); expect(readFileSync(agentsPath, "utf8")).not.toContain("ORIGINAL_HOSTED_RULE");
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).refreshSelector).toEqual(selector);
    expect((await refreshSessionRender({ targetHome, store })).status).toBe("unchanged");
    expect(restoreSessionRenderSnapshot(result.apply.snapshotPath!).restored).toBe(true); expect(readFileSync(agentsPath, "utf8")).toBe(original);
  });
  test("fails closed on hosted auth or capability failures without restoring cached prompts", async () => {
    const { targetHome, store, state, manifestPath, agentsPath } = fixture();
    const original = readFileSync(agentsPath, "utf8"), manifest = readFileSync(manifestPath, "utf8");
    state.failStatus = 403; await expect(refreshSessionRender({ targetHome, store })).rejects.toThrow("403");
    state.failStatus = 0; state.missingBindings = true; await expect(refreshSessionRender({ targetHome, store })).rejects.toThrow("HOSTED_BINDINGS_REQUIRED");
    state.missingBindings = false; state.missingAssets = true; await expect(refreshSessionRender({ targetHome, store })).rejects.toThrow("HOSTED_ASSETS_REQUIRED");
    expect(readFileSync(agentsPath, "utf8")).toBe(original); expect(readFileSync(manifestPath, "utf8")).toBe(manifest);
  });
  test("rejects local stores and changed hosted authority before reading sources", async () => {
    const { targetHome, store, state } = fixture();
    await expect(refreshSessionRender({ targetHome, store: new LocalConfigStore() })).rejects.toThrow("HOSTED_REQUIRED");
    Object.defineProperty(store, "v1BaseUrl", { value: "https://other.example.test/v1" });
    await expect(refreshSessionRender({ targetHome, store })).rejects.toThrow("AUTHORITY_MISMATCH"); expect(state.calls).toEqual([]);
  });
  test("refuses operator drift and stale manifest observations while preserving their bytes", async () => {
    const { targetHome, store, state, manifestPath, agentsPath } = fixture(); const original = readFileSync(agentsPath, "utf8");
    writeFileSync(agentsPath, "Operator edit must remain.\n");
    expect((await refreshSessionRender({ targetHome, store })).status).toBe("blocked"); expect(readFileSync(agentsPath, "utf8")).toBe("Operator edit must remain.\n");
    writeFileSync(agentsPath, original);
    state.onRead = () => { state.onRead = undefined; const changed = JSON.parse(readFileSync(manifestPath, "utf8")); changed.generatedAt = "2099-01-01T00:00:00.000Z"; writeFileSync(manifestPath, JSON.stringify(changed)); };
    await expect(refreshSessionRender({ targetHome, store })).rejects.toThrow("manifest"); expect(readFileSync(agentsPath, "utf8")).toBe(original);
  });
  test("rejects a removed hosted instruction binding instead of silently emptying the target", async () => {
    const { targetHome, store, state, agentsPath } = fixture(); const original = readFileSync(agentsPath, "utf8"); state.configs = [];
    await expect(refreshSessionRender({ targetHome, store })).rejects.toThrow("missing config"); expect(readFileSync(agentsPath, "utf8")).toBe(original);
  });
});
