import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isolatedInstructionsTestEnv } from "../test-support/environment.js";
import { legacyProfileConfigBinding } from "../lib/instruction-graph.js";
import { makeTempRoot } from "../lib/test-temp-root.js";
import type { Config } from "../types/index.js";

describe("shared project companion CLI", () => {
  test("uses hosted explicit bindings, persists its selector and refreshes both managed files", async () => {
    const root = makeTempRoot("instructions-project-companion-cli-"), projectRoot = join(root, "project");
    mkdirSync(projectRoot);
    const profile = { id: "shared-project", name: "Shared", slug: "shared", description: null, selectors: {}, variables: {}, created_at: "2026-09-19", updated_at: "2026-09-19" };
    let config: Config = { id: "rule", name: "Rule", slug: "rule", kind: "file", category: "rules", agent: "global", target_path: null,
      outputs: [], format: "markdown", content: "HOSTED_SHARED_PROJECT_POLICY_V1", description: null, tags: [], is_template: false, version: 1, created_at: "2026-09-19", updated_at: "2026-09-19", synced_at: null };
    const binding = { ...legacyProfileConfigBinding(), providers: [{ provider: "sumi" }, { provider: "claude" }] };
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      const path = new URL(request.url).pathname;
      if (!request.headers.has("x-api-key")) return Response.json({ error: "unauthorized" }, { status: 403 });
      if (path.endsWith("/bindings")) return Response.json({ bindings: [{ profile_id: profile.id, config_id: config.id, sort_order: 0, binding }] });
      if (path.endsWith("/assets")) return Response.json({ assets: [] });
      if (path.endsWith("/profiles/shared-project")) return Response.json({ profile: { ...profile, configs: [config] } });
      return Response.json({ error: "not found" }, { status: 404 });
    } });
    const env = isolatedInstructionsTestEnv(root);
    delete env.HASNA_INSTRUCTIONS_LOCAL; delete env.HASNA_INSTRUCTIONS_DB_PATH;
    const cli = async (args: string[]) => {
      const child = Bun.spawn([process.execPath, "--no-env-file", "src/cli/index.tsx", ...args], { cwd: join(import.meta.dir, "../.."), env, stdout: "pipe", stderr: "pipe" });
      const [status, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { status, stdout, stderr };
    };
    try {
      const credentialsDir = join(root, ".hasna/instructions/config"); mkdirSync(credentialsDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(credentialsDir, "credentials"), `HASNA_INSTRUCTIONS_API_URL=http://127.0.0.1:${server.port}/instructions\nHASNA_INSTRUCTIONS_API_KEY=synthetic-companion-test\n`, { mode: 0o600 });
      const args = ["--tool", "sumi", "--profile", "shared", "--compile-profile", profile.id, "--provider-version", "0.2.22", "--project-root", projectRoot, "--claude-project-import", "2.1.278", "--no-station-profile", "--json"];
      const preview = await cli(["session", "plan", ...args]);
      expect({ status: preview.status, stderr: preview.stderr }).toMatchObject({ status: 0 });
      expect(JSON.parse(preview.stdout).manifest.claudeProjectImport.providerVersion).toBe("2.1.278");
      expect(existsSync(join(projectRoot, "CLAUDE.md"))).toBe(false);
      const applied = await cli(["session", "apply", ...args]);
      expect({ status: applied.status, stderr: applied.stderr }).toMatchObject({ status: 0 });
      expect(JSON.parse(applied.stdout).snapshotPath).not.toBeNull();
      const bridge = readFileSync(join(projectRoot, "CLAUDE.md"), "utf8"); expect(bridge).toContain("@./AGENTS.md");
      const manifestPath = join(projectRoot, ".hasna/session-render-manifest.json");
      expect(JSON.parse(readFileSync(manifestPath, "utf8")).refreshSelector.claudeProjectImport).toEqual({ providerVersion: "2.1.278" });
      config = { ...config, version: 2, content: "HOSTED_SHARED_PROJECT_POLICY_V2" };
      const refreshed = await cli(["session", "refresh", "--target-home", projectRoot, "--json"]);
      expect({ status: refreshed.status, stderr: refreshed.stderr }).toMatchObject({ status: 0 });
      expect(JSON.parse(refreshed.stdout).status).toBe("updated");
      expect(readFileSync(join(projectRoot, "AGENTS.md"), "utf8")).toContain(config.content);
      expect(readFileSync(join(projectRoot, "CLAUDE.md"), "utf8")).toBe(bridge);
      const hash = createHash("sha256").update(readFileSync(manifestPath)).digest("hex");
      expect((await cli(["session", "apply", ...args])).status).toBe(1);
      expect((await cli(["session", "apply", ...args, "--expected-manifest-sha256", hash])).status).toBe(0);
    } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
  });
});
