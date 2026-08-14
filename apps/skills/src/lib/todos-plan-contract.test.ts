import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SYNC_MARKER_FILE, syncSkillsToAgents } from "./agent-sync.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const TODOS_PLAN_SOURCE = join(import.meta.dir, "..", "..", "skills", "todos-plan", "SKILL.md");

const RETIRED_DEPLOYMENT_MODE_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ["self_hosted enum token", /\bself_hosted\b/i],
  ["three-way deployment mode list", /\blocal\s*\|\s*self[-_ ]?hosted\s*\|\s*cloud\b/i],
  ["deployment classification requirement", /\bdeployment classification\b/i],
  ["Hasna AWS mode assignment", /\bHasna AWS authority is\b/i],
  ["Todos SaaS mode assignment", /\bTodos SaaS authority is\b/i],
  [
    "explicit self-hosted/cloud mode authorization",
    /\brequire an explicit\s+`?(?:self[_ -]?hosted|cloud)`?\s+classification\b/i,
  ],
  [
    "mode-to-local fallback wording",
    /\bnever switch from\s+`?(?:self[_ -]?hosted|cloud)`?\s+to local storage\b/i,
  ],
];

function retiredDeploymentModeFindings(content: string): string[] {
  return RETIRED_DEPLOYMENT_MODE_PATTERNS
    .filter(([, pattern]) => pattern.test(content))
    .map(([name]) => name);
}

describe("todos-plan production contract", () => {
  test("the vocabulary guard permits ordinary doctrine-compliant location and product words", () => {
    const allowed =
      "A local SQLite file can serve the user-hosted product. Hasna SaaS is a cloud service whose server may use PostgreSQL.";
    expect(retiredDeploymentModeFindings(allowed)).toEqual([]);
  });

  test("the canonical source preserves the production envelope without retired deployment modes", () => {
    const source = readFileSync(TODOS_PLAN_SOURCE, "utf-8");

    expect(retiredDeploymentModeFindings(source)).toEqual([]);
    expect(source).toContain("## Required Operation-Authority Gate");
    expect(source).toContain("## Production Collection and Completeness Gate");
    expect(source).toContain("## Fresh Production Mutation Gate");
    expect(source).toContain("## Named C1-C9 Production Mutation Envelope");
    expect(source).toMatch(/\bfull (?:stable )?UUID\b/i);
    expect(source).toMatch(/\b(?:compare-and-swap|CAS|If-Match)\b/);
    expect(source).toMatch(/\bprotected input channel\b/i);
    expect(source).toMatch(/\breceipt\b/i);
    expect(source).toMatch(/\bcompensation\b/i);
    expect(source).toMatch(/\bfail closed\b/i);
    for (let clause = 1; clause <= 9; clause += 1) {
      expect(source).toMatch(new RegExp(`\\*\\*C${clause}\\b`));
    }
  });

  test("a named bundled skill can force-update an unmanaged Codewith copy", () => {
    const corpus = mkdtempSync(join(tmpdir(), "todos-plan-empty-corpus-"));
    const home = mkdtempSync(join(tmpdir(), "todos-plan-codewith-home-"));
    try {
      const installedDir = join(home, ".codewith", "skills", "todos-plan");
      mkdirSync(installedDir, { recursive: true });
      writeFileSync(
        join(installedDir, "SKILL.md"),
        "---\nname: todos-plan\ndescription: stale\n---\n\nHasna AWS authority is `self_hosted`.\n",
      );
      writeFileSync(join(installedDir, "obsolete.txt"), "remove me");

      const { actions } = syncSkillsToAgents({
        rootDir: corpus,
        homeDir: home,
        names: ["todos-plan"],
        agents: ["codewith"],
        force: true,
      });

      expect(actions).toEqual([
        {
          skill: "todos-plan",
          agent: "codewith",
          path: join(installedDir, "SKILL.md"),
          action: "update",
        },
      ]);
      expect(existsSync(join(installedDir, SYNC_MARKER_FILE))).toBe(true);
      expect(existsSync(join(installedDir, "obsolete.txt"))).toBe(false);

      const canonical = readFileSync(TODOS_PLAN_SOURCE, "utf-8");
      const installed = readFileSync(join(installedDir, "SKILL.md"), "utf-8");
      expect(installed).toBe(canonical);
      expect(retiredDeploymentModeFindings(installed)).toEqual([]);
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
