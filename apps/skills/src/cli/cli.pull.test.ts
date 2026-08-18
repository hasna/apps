import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "./cli.test-utils";
import { createSkillsFetchHandler } from "../server/app.js";
import { resolveStoreBackends } from "../server/store-fixtures.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

// A clean $HOME (no auth.json) plus empty credential env is an unconfigured install: the
// point of these tests is that `skills pull` fails closed instead of inventing a host.
const UNCONFIGURED = { SKILLS_API_URL: "", SKILLS_API_KEY: "", SKILL_API_KEY: "" };

describe("skills pull (CLI)", () => {
  test("--help documents the command and its flags", async () => {
    const { stdout, exitCode } = await runCli(["pull", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("into this machine's corpus");
    expect(stdout).toContain("--all");
    expect(stdout).toContain("--for-machine");
  });

  test("fails closed with a clear message when nothing is configured", async () => {
    const { stderr, exitCode } = await runCli(["pull", "some-skill"], UNCONFIGURED);
    expect(exitCode).toBe(1);
    // No credential -> named, actionable error; never a silent success or a guessed host.
    expect(stderr).toContain("No API key configured");
    expect(stderr).toContain("SKILLS_API_URL");
  });

  test("fails closed with a MissingApiUrl message when a key exists but no origin does", async () => {
    const { stderr, exitCode } = await runCli(["pull", "some-skill"], {
      SKILLS_API_URL: "",
      SKILLS_API_KEY: "sk_test_key",
    });
    expect(exitCode).toBe(1);
    // The fail-closed guarantee: with a key but no origin, refuse rather than pick a host.
    expect(stderr).toContain("requires a Skills API URL");
    expect(stderr.toLowerCase()).not.toContain("localhost");
  });

  test("--json emits a structured error when unconfigured", async () => {
    const { stdout, exitCode } = await runCli(["pull", "some-skill", "--json"], UNCONFIGURED);
    expect(exitCode).toBe(1);
    const payload = JSON.parse(stdout);
    expect(payload.error).toContain("No API key configured");
    expect(Array.isArray(payload.detail)).toBe(true);
  });

  test("human summary names the resolved corpus root, not a hardcoded installed path", async () => {
    // A real in-process instance serves a bundled skill over HTTP; the CLI pulls it
    // into a temp HOME whose corpus is the owner-layout-migrated <app folder>/skills
    // root. The summary line must name THAT root — printing ~/.hasna/skills/installed
    // here would be the stale claim this regression pins (bug class 170b0e9b).
    const backends = await resolveStoreBackends();
    const memory = backends.find((backend) => backend.name === "memory");
    if (!memory) throw new Error("memory store backend unavailable");
    // Synthetic fixture auth — deliberately not credential-shaped so the staged
    // secrets scan stays clean (repo convention: synthetic tokens are sentinels).
    const fixtureAuth = "skills-pull-summary";
    const PRINCIPAL = {
      orgId: "org_pull_summary",
      orgSlug: "org-pull-summary",
      orgName: "Org Pull Summary",
      userId: "user_pull_summary",
      email: "pull-summary@example.com",
      apiKeyId: "key_pull_summary",
    };
    const fixture = await memory.create([{ token: fixtureAuth, principal: PRINCIPAL }]);
    const fetch = await createSkillsFetchHandler({
      store: fixture.store,
      config: { inlineWorker: false, allowEphemeralStore: fixture.allowEphemeralStore },
    });
    const server = Bun.serve({ port: 0, fetch });
    const home = mkdtempSync(join(tmpdir(), "skills-pull-summary-home-"));
    try {
      // Owner-layout migration record -> corpus resolves to <app folder>/skills.
      const appDir = join(home, ".hasna", "skills");
      mkdirSync(join(appDir, "skills"), { recursive: true });
      writeFileSync(
        join(appDir, "skills", ".layout-migration.json"),
        `${JSON.stringify({ version: 1, migratedAt: new Date().toISOString(), moved: ["installed"], note: "test" })}\n`,
      );

      const { stdout, exitCode } = await runCli(["pull", "ad-creative-pack"], {
        HOME: home,
        SKILLS_API_URL: `http://127.0.0.1:${server.port}`,
        SKILLS_API_KEY: fixtureAuth,
      });
      expect(exitCode).toBe(0);
      expect(stdout).toContain(join(appDir, "skills"));
      expect(stdout).not.toContain("~/.hasna/skills/installed");
    } finally {
      server.stop(true);
      await fixture.close();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
