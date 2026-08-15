import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  SYNC_MARKER_FILE,
  syncSkillsToAgents,
} from "./agent-sync.js";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const ROOT = process.cwd();
const SKILL_DIR = join(ROOT, "agent-skills", "goal-plan-coordination");
const SKILL_PATH = join(SKILL_DIR, "SKILL.md");
const CASES_PATH = join(SKILL_DIR, "tests", "control-cases.json");

type ResumeCase = {
  name: string;
  state: string;
  resume_directed: boolean;
  intentional_hold: boolean;
  budget_limited: boolean;
  expected: "continue" | "resume" | "stay";
};

type ReviewCase = {
  name: string;
  reviewers: number;
  fixed: boolean;
  reviewer_per_step: boolean;
  fresh_final_blind: boolean;
  expected: boolean;
};

type RereviewCase = {
  name: string;
  classes: string[];
  named_only: boolean;
  direct_regressions_only: boolean;
  cycle: number;
  expected: boolean;
};

type AcceptanceCase = {
  name: string;
  text: string;
  gates: string[];
  lanes: string[];
  defect_classes: string[];
  expected: boolean;
};

type ControlCases = {
  resume: ResumeCase[];
  review: ReviewCase[];
  rereview: RereviewCase[];
  acceptance: AcceptanceCase[];
};

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function filesBelow(directory: string, prefix = ""): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const absolute = join(directory, entry);
    const relative = join(prefix, entry);
    return statSync(absolute).isDirectory()
      ? filesBelow(absolute, relative)
      : [relative];
  });
}

function frontmatterKeys(skillMd: string): string[] {
  const match = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Za-z0-9_-]+):/)?.[1])
    .filter((key): key is string => Boolean(key));
}

function body(skillMd: string): string {
  return skillMd.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function resumeDecision(control: ResumeCase): "continue" | "resume" | "stay" {
  if (control.state === "active") return "continue";
  if (control.intentional_hold || control.budget_limited) return "stay";
  if (
    control.resume_directed
    && ["paused", "blocked", "usage_limited"].includes(control.state)
  ) {
    return "resume";
  }
  return "stay";
}

function validCodewithReview(control: ReviewCase): boolean {
  return control.reviewers === 1
    && control.fixed
    && !control.reviewer_per_step
    && !control.fresh_final_blind;
}

function validFocusedRereview(control: RereviewCase): boolean {
  return control.cycle >= 1
    && control.cycle <= 2
    && control.named_only
    && control.direct_regressions_only
    && control.classes.length > 0
    && control.classes.every((severity) => severity === "P0" || severity === "P1");
}

function validFiniteAcceptance(control: AcceptanceCase): boolean {
  const banned = [
    "all P0-P3",
    "reconcile all findings",
    "repeat validation until clean",
  ];
  return control.gates.length > 0
    && control.lanes.length > 0
    && control.defect_classes.length > 0
    && control.defect_classes.every(
      (severity) => severity === "P0" || severity === "P1",
    )
    && banned.every((phrase) => !control.text.includes(phrase));
}

describe("goal-plan-coordination canonical source", () => {
  test("is present with the complete canonical resource set", () => {
    expect(existsSync(SKILL_PATH)).toBe(true);
    expect(filesBelow(SKILL_DIR).sort()).toEqual([
      "SKILL.md",
      "agents/openai.yaml",
      "references/reconciliation-and-scope.md",
      "references/recovery.md",
      "tests/control-cases.json",
    ]);
  });

  test("keeps canonical frontmatter and body adapter-neutral", () => {
    const source = readFileSync(SKILL_PATH, "utf8");
    expect(frontmatterKeys(source)).toEqual(["name", "description"]);
    expect(source.match(/^user_invocable:/gm) ?? []).toHaveLength(0);
    expect(source).not.toContain("~/.claude/");
    expect(source).not.toContain("~/.codewith/");
    expect(source).not.toContain("/home/");
    expect(source).not.toContain("Primary home:");
    expect(source).toContain("references/recovery.md");
    expect(source).toContain("references/reconciliation-and-scope.md");
  });

  test("contains current lifecycle, review, rereview, and finite-acceptance rules", () => {
    const source = readFileSync(SKILL_PATH, "utf8");
    expect(source).toContain("Use `pause_goal` for an intentional temporary hold.");
    expect(source).toContain("Call `resume_goal` before continuing");
    expect(source).toContain("Completed, cancelled, deferred, or intentionally abandoned");
    expect(source).toContain("Budget-limited");
    expect(source).toMatch(/exactly one\s+independent correctness reviewer/);
    expect(source).toContain("the same reviewer re-checks only");
    expect(source).toContain("At most two remediation cycles are allowed.");
    expect(source).toContain("the exact lanes the change can reach");
    expect(source).toContain("all P0-P3");
    expect(source).toContain("reconcile all findings");
    expect(source).toContain("repeat validation until clean");

    expect(source).not.toContain(
      "as of 2026-07 no model-callable native-goal pause tool is exposed",
    );
    expect(source).not.toContain(
      "Use at least two independent reviewers for substantial or high-risk work",
    );
    expect(source).not.toContain("After every material slice");
    expect(source).not.toContain("Run a final fresh adversarial gate");
  });
});

describe("goal-plan-coordination policy controls", () => {
  const controls = JSON.parse(readFileSync(CASES_PATH, "utf8")) as ControlCases;

  test("accepts resumable states and rejects terminal or intentionally held states", () => {
    for (const control of controls.resume) {
      expect(resumeDecision(control), control.name).toBe(control.expected);
    }
  });

  test("accepts one fixed Codewith reviewer and rejects review-layer expansion", () => {
    for (const control of controls.review) {
      expect(validCodewithReview(control), control.name).toBe(control.expected);
    }
  });

  test("limits focused rereview to named P0/P1 defects and two cycles", () => {
    for (const control of controls.rereview) {
      expect(validFocusedRereview(control), control.name).toBe(control.expected);
    }
  });

  test("accepts finite gates and rejects unbounded terminal wording", () => {
    for (const control of controls.acceptance) {
      expect(validFiniteAcceptance(control), control.name).toBe(control.expected);
    }
  });
});

describe("goal-plan-coordination materialization", () => {
  test("materializes Codewith and Claude with only declared frontmatter adaptation", () => {
    const corpus = mkdtempSync(join(tmpdir(), "goal-plan-empty-corpus-"));
    const home = mkdtempSync(join(tmpdir(), "goal-plan-materialized-home-"));
    try {
      const result = syncSkillsToAgents({
        names: ["goal-plan-coordination"],
        agents: ["codewith", "claude"],
        rootDir: corpus,
        homeDir: home,
        sourceDir: ROOT,
      });
      expect(result.actions).toHaveLength(2);
      expect(result.actions.every((action) => action.action === "create")).toBe(true);

      const source = readFileSync(SKILL_PATH, "utf8");
      const codewithDir = join(home, ".codewith", "skills", "goal-plan-coordination");
      const claudeDir = join(home, ".claude", "skills", "goal-plan-coordination");
      const codewith = readFileSync(join(codewithDir, "SKILL.md"), "utf8");
      const claude = readFileSync(join(claudeDir, "SKILL.md"), "utf8");

      expect(codewith).toBe(source);
      expect(sha256(codewith)).toBe(sha256(source));
      expect(claude.match(/^user_invocable:\s*true$/gm) ?? []).toHaveLength(1);
      expect(claude.replace("user_invocable: true\n", "")).toBe(source);
      expect(body(claude)).toBe(body(source));
      expect(body(codewith)).toBe(body(source));

      for (const relative of [
        "agents/openai.yaml",
        "references/recovery.md",
        "references/reconciliation-and-scope.md",
        "tests/control-cases.json",
      ]) {
        const sourceBytes = readFileSync(join(SKILL_DIR, relative), "utf8");
        const codewithBytes = readFileSync(join(codewithDir, relative), "utf8");
        const claudeBytes = readFileSync(join(claudeDir, relative), "utf8");
        expect(sha256(codewithBytes), relative).toBe(sha256(sourceBytes));
        expect(sha256(claudeBytes), relative).toBe(sha256(sourceBytes));
      }

      expect(existsSync(join(codewithDir, SYNC_MARKER_FILE))).toBe(true);
      expect(existsSync(join(claudeDir, SYNC_MARKER_FILE))).toBe(true);
    } finally {
      rmSync(corpus, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
