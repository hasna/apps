import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { legacyProfileConfigBinding } from "../lib/instruction-graph.js";
import { makeTempRoot } from "../lib/test-temp-root.js";
import type { Config } from "../types/index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
async function cli(root: string, args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const key of ["HASNA_INSTRUCTIONS_API_URL", "HASNA_INSTRUCTIONS_API_KEY", "INSTRUCTIONS_API_URL", "INSTRUCTIONS_API_KEY", "HASNA_INSTRUCTIONS_API_KEY_OVERRIDE", "HASNA_INSTRUCTIONS_API_KEY_REF", "HASNA_PROFILE", "HASNA_INSTRUCTIONS_LOCAL", "HASNA_INSTRUCTIONS_DB_PATH", "HASNA_CONFIG_HOME", "HASNA_DATA_HOME", "HASNA_CACHE_HOME"]) delete env[key];
  Object.assign(env, { HOME: root, HASNA_HOME: join(root, ".hasna"), HASNA_STATE_HOME: join(root, "state"), HASNA_CONFIGS_HOME: join(root, "render-state"), NO_COLOR: "1", FORCE_COLOR: "0" });
  const child = Bun.spawn(["bun", "src/cli/index.tsx", ...args], { cwd: packageRoot, env, stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { status, stdout, stderr };
}

describe("hosted session refresh CLI", () => {
  test("records remote selector on adoption, refreshes current HTTP sources, and reconciles only exact reviewed drift", async () => {
    const root = makeTempRoot("instructions-refresh-cli-");
    const targetHome = join(root, "sumi-config");
    mkdirSync(targetHome);
    const agentsPath = join(targetHome, "AGENTS.md");
    const manifestPath = join(targetHome, ".hasna/session-render-manifest.json");
    writeFileSync(agentsPath, "Original operator instruction.\n");
    const profile = { id: "profile-1", name: "Reviewed", slug: "reviewed", description: null, selectors: {}, variables: {}, created_at: "2026-09-18", updated_at: "2026-09-18" };
    let config: Config = { id: "rule-1", name: "Rule", slug: "rule", kind: "file", category: "rules", agent: "global", target_path: null, outputs: [], format: "markdown", content: "HOSTED_CURRENT_RULE_V1", description: null, tags: [], is_template: false, version: 1, created_at: "2026-09-18", updated_at: "2026-09-18", synced_at: null };
    let failAuth = false;
    let incompleteBindings = false;
    let bindingPayload: unknown = legacyProfileConfigBinding();
    const calls: string[] = [];
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const url = new URL(request.url); calls.push(url.pathname);
      if (failAuth || !request.headers.has("x-api-key")) return Response.json({ error: "unauthorized" }, { status: 403 });
      if (url.pathname.endsWith("/bindings")) return Response.json({ bindings: incompleteBindings ? [] : [{ profile_id: profile.id, config_id: config.id, sort_order: 0, binding: bindingPayload }] });
      if (url.pathname.endsWith("/assets")) return Response.json({ assets: [] });
      if (url.pathname.endsWith("/profiles/profile-1")) return Response.json({ profile: { ...profile, configs: [config] } });
      return Response.json({ error: "not found" }, { status: 404 });
    } });
    try {
      const credentialsDir = join(root, ".hasna/instructions/config"); mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(credentialsDir, "credentials"), `HASNA_INSTRUCTIONS_API_URL=http://127.0.0.1:${server.port}/instructions\nHASNA_INSTRUCTIONS_API_KEY=synthetic-refresh-test\n`, { mode: 0o600 });
      const applyOptions = ["--tool", "sumi", "--profile", "knowledge", "--compile-profile", profile.id, "--provider-version", "0.2.22", "--target-home", targetHome, "--no-station-profile", "--json"];
      incompleteBindings = true;
      const incomplete = await cli(root, ["session", "apply", ...applyOptions, "--adopt-file", `AGENTS.md=${sha256(readFileSync(agentsPath, "utf8"))}`]);
      expect(incomplete.status).toBe(1);
      expect(incomplete.stderr).toContain("HOSTED_PROFILE_BINDINGS_INCOMPLETE");
      expect(readFileSync(agentsPath, "utf8")).toBe("Original operator instruction.\n");
      incompleteBindings = false;
      for (const invalidPayload of [undefined, null, { schema: "hasna.instructions.profile-config-binding/v1", activation: { mode: "always" }, fallback: "fail" }]) {
        bindingPayload = invalidPayload;
        const invalid = await cli(root, ["session", "apply", ...applyOptions, "--adopt-file", `AGENTS.md=${sha256(readFileSync(agentsPath, "utf8"))}`]);
        expect(invalid.status).toBe(1);
        expect(invalid.stderr).toContain("HOSTED_PROFILE_BINDINGS_INVALID");
        expect(readFileSync(agentsPath, "utf8")).toBe("Original operator instruction.\n");
      }
      bindingPayload = legacyProfileConfigBinding();
      const wrong = await cli(root, ["session", "apply", ...applyOptions, "--adopt-file", `AGENTS.md=${"0".repeat(64)}`]);
      expect(wrong.status).toBe(1); expect(readFileSync(agentsPath, "utf8")).toBe("Original operator instruction.\n");
      const adopted = await cli(root, ["session", "apply", ...applyOptions, "--adopt-file", `AGENTS.md=${sha256(readFileSync(agentsPath, "utf8"))}`]);
      expect({ status: adopted.status, stderr: adopted.stderr }).toMatchObject({ status: 0 });
      const adoptionReceipt = JSON.parse(adopted.stdout);
      expect(adoptionReceipt.adoptions[0].sourceIds).toEqual(["rule"]);
      expect(adoptionReceipt.snapshotPath).not.toBeNull();
      const firstManifest = readFileSync(manifestPath, "utf8");
      expect(JSON.parse(firstManifest).refreshSelector.profileId).toBe(profile.id);
      expect(JSON.parse(firstManifest).refreshSelector.authority).toBe(`http://127.0.0.1:${server.port}/instructions/v1`);
      const mtime = statSync(manifestPath).mtimeMs;
      calls.length = 0;
      const unchanged = await cli(root, ["session", "refresh", "--target-home", targetHome, "--json"]);
      expect({ status: unchanged.status, stderr: unchanged.stderr }).toMatchObject({ status: 0 });
      expect(JSON.parse(unchanged.stdout).status).toBe("unchanged");
      expect(calls.some((path) => path.endsWith("/bindings"))).toBe(true);
      expect(readFileSync(manifestPath, "utf8")).toBe(firstManifest); expect(statSync(manifestPath).mtimeMs).toBe(mtime);
      config = { ...config, content: "HOSTED_CURRENT_RULE_V2", version: 2 };
      const updated = await cli(root, ["session", "refresh", "--target-home", targetHome, "--json"]);
      expect(updated.status).toBe(0); expect(JSON.parse(updated.stdout).status).toBe("updated");
      expect(readFileSync(agentsPath, "utf8")).toContain("HOSTED_CURRENT_RULE_V2");
      expect(JSON.parse(readFileSync(manifestPath, "utf8")).adoptions[0].preimageSha256).toBe(sha256("Original operator instruction.\n"));
      const current = readFileSync(agentsPath, "utf8");
      failAuth = true;
      const failed = await cli(root, ["session", "refresh", "--target-home", targetHome, "--json"]);
      expect(failed.status).toBe(1); expect(JSON.parse(failed.stdout).status).toBe("failed"); expect(readFileSync(agentsPath, "utf8")).toBe(current);
      failAuth = false;
      writeFileSync(agentsPath, current + "Reviewed out-of-band append.\n");
      const reconcile = await cli(root, ["session", "apply", ...applyOptions, "--reconcile-file", `AGENTS.md=${sha256(readFileSync(agentsPath, "utf8"))}`, "--expected-manifest-sha256", sha256(readFileSync(manifestPath, "utf8"))]);
      expect({ status: reconcile.status, stderr: reconcile.stderr }).toMatchObject({ status: 0 });
      expect(JSON.parse(reconcile.stdout).reconciliations).toHaveLength(1);
      expect(readFileSync(agentsPath, "utf8")).toBe(current);
      expect(JSON.parse(readFileSync(manifestPath, "utf8")).reconciliations).toHaveLength(1);
    } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
  });
});
