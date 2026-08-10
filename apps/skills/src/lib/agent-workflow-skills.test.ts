import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "node:child_process";
import { SKILLS } from "./registry";
import { parseSkillFrontmatter } from "./skill-validation";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const ROOT = process.cwd();
const AGENT_SKILLS_DIR = join(ROOT, "agent-skills");

function filesBelow(directory: string, prefix = ""): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry);
    const relative = join(prefix, entry);
    return statSync(absolute).isDirectory() ? filesBelow(absolute, relative) : [relative];
  });
}

describe("repository-managed agent workflow skills", () => {
  test("all agent skills have matching valid frontmatter", () => {
    const failures: string[] = [];
    for (const folder of readdirSync(AGENT_SKILLS_DIR)) {
      const directory = join(AGENT_SKILLS_DIR, folder);
      if (!statSync(directory).isDirectory()) continue;
      const skillPath = join(directory, "SKILL.md");
      if (!existsSync(skillPath)) {
        failures.push(`${folder}: missing SKILL.md`);
        continue;
      }
      const frontmatter = parseSkillFrontmatter(readFileSync(skillPath, "utf8"));
      if (!frontmatter || frontmatter.name !== folder || !frontmatter.description) {
        failures.push(`${folder}: invalid or mismatched frontmatter`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("merge-pr remains outside the customer skill catalog and public corpus", () => {
    expect(SKILLS.some((skill) => skill.name === "merge-pr")).toBe(false);
    expect(existsSync(join(ROOT, "skills", "merge-pr"))).toBe(false);
    expect(existsSync(join(ROOT, "skills", "skill-merge-pr"))).toBe(false);
  });

  test("merge-pr contains only the canonical workflow and required resources", () => {
    expect(filesBelow(join(AGENT_SKILLS_DIR, "merge-pr")).sort()).toEqual([
      "SKILL.md",
      "references/merge-safety.md",
      "scripts/merge_pr_guard.py",
      "scripts/test_merge_pr_guard.py",
      "tests/fixtures/multi-commit-synthesized.json",
      "tests/fixtures/trailer-free-provider.json",
    ]);
  });

  test("skill-publish carries the worktree-safe npm provenance helper and regression", () => {
    expect(filesBelow(join(AGENT_SKILLS_DIR, "skill-publish")).sort()).toEqual([
      "SKILL.md",
      "scripts/capture_registry.js",
      "scripts/publish_with_git_head.sh",
      "scripts/test_publish_with_git_head.sh",
    ]);
  });

  test("skill-publish routes npm through the helper and verifies registry gitHead", () => {
    const skill = readFileSync(join(AGENT_SKILLS_DIR, "skill-publish", "SKILL.md"), "utf8");
    expect(skill).toContain("scripts/publish_with_git_head.sh");
    expect(skill).toContain('secrets exec "$TOKEN_PATH" --as NODE_AUTH_TOKEN');
    expect(skill).toContain('--userconfig "$NPMRC"');
    expect(skill).toContain("GITHEAD_VERIFIED:");
    expect(skill).toContain('grep -iE "^\\\\+([^+].*)?($SECRET_PATTERN)"');
    expect(skill).not.toContain('grep -iE "^\\\\+[^+].*($SECRET_PATTERN)"');
    expect(skill).not.toContain("bun publish --access");
  });

  test("skill-publish preserves npm gitHead and restores linked worktrees", () => {
    const result = spawnSync(
      "bash",
      ["agent-skills/skill-publish/scripts/test_publish_with_git_head.sh"],
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  test("inbox-monitor handles rotating machine identity without hiding same-name traffic", () => {
    const result = spawnSync("bash", ["agent-skills/inbox-monitor/scripts/test_inbox_monitor.sh"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  test("inbox resolves registered sender IDs without hiding unsigned same-name traffic", () => {
    const result = spawnSync("bash", ["agent-skills/inbox/tests/test_registered_sender_id.sh"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });

  test("fleet-package-rollout uses the executable manifest route and keeps SSH non-executing", () => {
    const skillPath = join(AGENT_SKILLS_DIR, "fleet-package-rollout", "SKILL.md");
    expect(existsSync(skillPath)).toBe(true);

    const skill = readFileSync(skillPath, "utf8");
    expect(skill).toContain("machines apps plan --machine <canary>");
    expect(skill).toContain("machines apps apply --machine <canary> --yes");
    expect(skill).toContain("machines apps status --machine <canary> --json");
    expect(skill).toContain("Positive control (executable route)");
    expect(skill).toContain("Negative control (non-executing route)");
    expect(skill).toContain("machines ssh --machine <canary> --cmd 'printf rollout-probe'");
    expect(skill).toContain("Never pass `--private-metadata`");
    expect(skill).toContain("Never run raw `ssh`");
    expect(skill).toMatch(
      /`machines ssh` is a route resolver and command formatter\. It does not execute the\s+requested command\./,
    );
    expect(skill.match(/^machines ssh --machine <canary>/gm) ?? []).toHaveLength(1);
    expect(skill).not.toContain(
      "route one exact, non-interactive install command through `machines ssh`",
    );
    expect(skill).not.toMatch(/^\s*(?:ssh|scp)\s+/m);
    expect(skill).not.toMatch(/^\s*machines ssh .*--private-metadata/m);
  });

  test("merge-pr guard passes its raw-fixture behavior suite", () => {
    const result = spawnSync(
      "python3",
      ["-m", "unittest", "agent-skills/merge-pr/scripts/test_merge_pr_guard.py"],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  });
});
