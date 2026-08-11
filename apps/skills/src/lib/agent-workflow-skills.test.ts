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

function secretScanContractFailures(workflow: string): string[] {
  const start = workflow.indexOf("  secret-scan:\n");
  const end = workflow.indexOf("\n  ci:\n", start);
  if (start < 0 || end <= start) return ["secret-scan job"];

  const secretScan = workflow.slice(start, end);
  const required: Array<[string, string]> = [
    ["job name", "name: Secret scan (gitleaks)"],
    [
      "pinned checkout",
      "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    ],
    ["full history checkout", "fetch-depth: 0"],
    ["credential-free checkout", "persist-credentials: false"],
    ["pinned gitleaks version", "GITLEAKS_VERSION: 8.30.1"],
    [
      "pinned gitleaks checksum",
      "GITLEAKS_SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
    ],
    ["checksum verification", "sha256sum --check -"],
    [
      "PR base range from event",
      "GITLEAKS_PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}",
    ],
    [
      "PR head range from event",
      "GITLEAKS_PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}",
    ],
    ["push base range from event", "GITLEAKS_PUSH_BASE_SHA: ${{ github.event.before }}"],
    ["push head range from event", "GITLEAKS_PUSH_HEAD_SHA: ${{ github.sha }}"],
    ["validated SHA range", "sha_pattern='^[0-9a-f]{40}$'"],
    ["merge-result regression control", "Verify merge-result-only secret coverage"],
    ["runtime-generated control credential", "openssl genpkey -algorithm RSA"],
    ["history negative control", "HISTORY_CONTROL_RC=%s"],
    ["tree positive control", "TREE_CONTROL_RC=%s"],
    ["exact candidate checkout", 'git checkout --detach --quiet "$head_sha"'],
    ["checked-out head verification", 'actual_head="$(git rev-parse HEAD)"'],
    ["checked-out head equality", 'if [[ "$actual_head" != "$head_sha" ]]'],
    ["initial-push range", 'GITLEAKS_LOG_OPTS="$head_sha"'],
    ["bounded commit range", 'GITLEAKS_LOG_OPTS="$base_sha..$head_sha"'],
    ["gitleaks git scan", '"$RUNNER_TEMP/gitleaks-bin/gitleaks" git .'],
    ["gitleaks log options", '--log-opts="$GITLEAKS_LOG_OPTS"'],
    [
      "exact head tree archive",
      'git archive --format=tar --output="$tree_archive" "$actual_head"',
    ],
    ["gitleaks checked-out tree scan", '"$RUNNER_TEMP/gitleaks-bin/gitleaks" dir "$head_tree"'],
    ["redaction", "--redact"],
    ["quiet banner", "--no-banner"],
    ["GitHub platform", "--platform github"],
    ["blocking exit code", "--exit-code 1"],
  ];
  const failures = required
    .filter(([, expected]) => !secretScan.includes(expected))
    .map(([label]) => label);

  if (/actions\/checkout@(v\d+|main|master)\b/.test(secretScan)) {
    failures.push("floating checkout");
  }
  if (secretScan.includes("--no-redact")) failures.push("disabled redaction");
  return failures;
}

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
    expect(skill).toContain(
      "printf '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\\n' > \"$NPMRC\"",
    );
    expect(skill.match(/secrets exec "\$TOKEN_PATH" --as NODE_AUTH_TOKEN/g) ?? []).toHaveLength(2);
    expect(skill).toContain(
      String.raw`npm view "$PKG@$NEW_VERSION" gitHead --json \
      --userconfig "$NPMRC"`,
    );
    expect(skill).toContain('--userconfig "$NPMRC"');
    expect(skill).toContain("GITHEAD_VERIFIED:");
    expect(skill).toContain('grep -iE "^\\\\+([^+].*)?($SECRET_PATTERN)"');
    expect(skill).not.toContain('grep -iE "^\\\\+[^+].*($SECRET_PATTERN)"');
    expect(skill).not.toContain("bun publish --access");
    expect(skill).not.toContain("_authToken=[REDACTED_SECRET]");
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

  test("CI secret scan pins gitleaks and scans the exact PR or push range", () => {
    const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(secretScanContractFailures(workflow)).toEqual([]);
  });

  test("CI secret scan structural guard rejects missing and unsafe variants", () => {
    const workflow = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
    const start = workflow.indexOf("  secret-scan:\n");
    const end = workflow.indexOf("\n  ci:\n", start);
    const job = workflow.slice(start, end);
    const cases: Array<[string, string, string]> = [
      ["missing job", workflow.slice(0, start) + workflow.slice(end), "secret-scan job"],
      [
        "floating checkout",
        workflow.replace(
          "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
          "actions/checkout@v6",
        ),
        "floating checkout",
      ],
      [
        "shallow checkout",
        workflow.replace("fetch-depth: 0", "fetch-depth: 1"),
        "full history checkout",
      ],
      [
        "credential-persisting checkout",
        workflow.replace("persist-credentials: false", "persist-credentials: true"),
        "credential-free checkout",
      ],
      [
        "missing checksum verification",
        workflow.replace("          printf '%s  %s\\n' \"$GITLEAKS_SHA256\" \"$archive\" | sha256sum --check -\n", ""),
        "checksum verification",
      ],
      [
        "hard-coded PR base",
        workflow.replace(
          "GITLEAKS_PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}",
          "GITLEAKS_PR_BASE_SHA: 0000000000000000000000000000000000000000",
        ),
        "PR base range from event",
      ],
      [
        "missing blocking exit code",
        workflow.replaceAll("            --exit-code 1", ""),
        "blocking exit code",
      ],
      [
        "missing merge-result runtime control",
        workflow.replace("      - name: Verify merge-result-only secret coverage", "      - name: Removed"),
        "merge-result regression control",
      ],
      [
        "missing exact head checkout",
        workflow.replace('          git checkout --detach --quiet "$head_sha"\n', ""),
        "exact candidate checkout",
      ],
      [
        "history-only scan",
        workflow.replace(
          '          "$RUNNER_TEMP/gitleaks-bin/gitleaks" dir "$head_tree" \\\n',
          '          "$RUNNER_TEMP/gitleaks-bin/gitleaks" git "$head_tree" \\\n',
        ),
        "gitleaks checked-out tree scan",
      ],
      [
        "disabled redaction",
        workflow.replace("            --redact", "            --redact\n            --no-redact"),
        "disabled redaction",
      ],
    ];

    expect(job.length).toBeGreaterThan(0);
    for (const [label, candidate, expectedFailure] of cases) {
      expect(secretScanContractFailures(candidate), label).toContain(expectedFailure);
    }
  });
});
