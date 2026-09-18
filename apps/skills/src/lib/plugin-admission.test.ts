import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitPlugin, assertPluginAuthorityEnvironment, planPluginAdmission, resolveAdmittedPlugin } from "./plugin-admission.js";
import { pluginFixture, putSynthetic } from "./plugin-admission.test-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "skills-plugin-admission-")); roots.push(root); return { root, ...pluginFixture(root) }; }
test("plan is write-free; admission pins provenance and migration; resolution freshly reads API", async () => {
  const f = fixture(), plan = await planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, f.options);
  expect(existsSync(f.options.storeRoot)).toBe(false);
  expect(plan.removed.map(file => file.path)).toEqual(["commands/command-example.md", "skills/example/SKILL.md"]);
  expect(plan.files.map(file => file.path)).toEqual([".claude-plugin/plugin.json", ".lsp.json", ".mcp.json", "agents/observer.md", "assets/retained.txt", "hooks/hooks.json"]);
  const receipt = await admitPlugin("synthetic-integration", "synthetic-profile", f.target, plan.planDigest, f.options);
  const calls = f.state.bundleCalls;
  expect(await resolveAdmittedPlugin(plan.bindingId, f.options)).toBe(receipt.materializedPath);
  expect(f.state.bundleCalls - calls).toBe(2);
  expect(await admitPlugin("synthetic-integration", "synthetic-profile", f.target, plan.planDigest, f.options)).toEqual(receipt);
  f.state.offline = true;
  await expect(resolveAdmittedPlugin(plan.bindingId, f.options)).rejects.toThrow();
  expect(existsSync(receipt.materializedPath)).toBe(true);
});
test("revocation, changed package, cross-workspace and changed executables cannot reuse admission", async () => {
  for (const failure of ["revoke", "version", "workspace", "executable", "corrupt"]) {
    const f = fixture(), plan = await planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, f.options);
    await admitPlugin("synthetic-integration", "synthetic-profile", f.target, plan.planDigest, f.options);
    if (failure === "revoke") f.state.revoked = true;
    if (failure === "version") f.update("1.0.1");
    if (failure === "workspace") f.state.workspace = "another-workspace";
    if (failure === "executable") putSynthetic(f.target.resolver.executable, "#!/bin/sh\nexit 92\n", 0o755);
    if (failure === "corrupt") f.state.corrupt = true;
    await expect(resolveAdmittedPlugin(plan.bindingId, f.options)).rejects.toThrow();
  }
});
test("digest review prevents TOCTOU approval; failed timeout and missing migration never publish a directory", async () => {
  const f = fixture(), plan = await planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, f.options);
  f.update("1.0.1");
  await expect(admitPlugin("synthetic-integration", "synthetic-profile", f.target, plan.planDigest, f.options)).rejects.toThrow("plan changed");
  expect(existsSync(f.options.storeRoot)).toBe(false);
  await expect(planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, { ...f.options, timeoutMs: 10, client: { ...f.client, resolveProfile: () => new Promise(() => {}) } })).rejects.toThrow("deadline");
  expect(existsSync(f.options.storeRoot)).toBe(false);
  f.bundles.delete("synthetic-payload@1.0.0");
  await expect(planPluginAdmission("synthetic-integration", "synthetic-profile", f.target, f.options)).rejects.toThrow("unavailable");
});
test("no environment authority substitution and no uncertified native version", async () => {
  for (const key of ["HASNA_SKILLS_API_URL", "SKILLS_API_KEY", "HASNA_SKILLS_API_KEY_OVERRIDE", "HASNA_SKILLS_LOCAL", "HASNA_SKILLS_DIR"]) expect(() => assertPluginAuthorityEnvironment({ [key]: "synthetic" })).toThrow();
  const f = fixture();
  await expect(planPluginAdmission("synthetic-integration", "synthetic-profile", { ...f.target, native: { ...f.target.native, version: "2.1.269" as "2.1.274" } }, f.options)).rejects.toThrow("certified");
});
