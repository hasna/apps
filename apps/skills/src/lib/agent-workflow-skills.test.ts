import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { SKILLS } from "./registry";
import { parseSkillFrontmatter } from "./skill-validation";

import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const ROOT = process.cwd();
const AGENT_SKILLS_DIR = join(ROOT, "agent-skills");

/**
 * The 9 fleet agent-workflow skills moved to the private per-station store
 * (hasna-internal/fleet-resources) per owner ruling 2026-08-15. They are for
 * internal fleet use only; the public repo must not carry them, and a
 * re-introduction is a regression this suite exists to catch.
 */
const PRIVATE_WORKFLOW_SKILLS = [
  "fleet-package-rollout",
  "goal-plan-coordination",
  "inbox",
  "inbox-monitor",
  "merge-pr",
  "skill-goal-execute",
  "skill-login",
  "skill-project-create",
  "skill-publish",
] as const;

function secretScanContractFailures(workflow: string): string[] {
  const start = workflow.indexOf("  secret-scan:\n");
  const end = workflow.indexOf("\n  ci:\n", start);
  if (start < 0 || end <= start) return ["secret-scan job"];

  const secretScan = workflow.slice(start, end);
  const exactHeadScanStart = secretScan.indexOf(
    "      - name: Scan the exact range and checked-out head tree",
  );
  const exactHeadScan =
    exactHeadScanStart >= 0 ? secretScan.slice(exactHeadScanStart) : "";
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
    ["export-ignore negative control", "merge-only-private-key.pem export-ignore"],
    ["history negative control", "HISTORY_CONTROL_RC=%s"],
    ["archive negative control", "ARCHIVE_CONTROL_RC=%s"],
    ["blob-tree positive control", "BLOB_TREE_CONTROL_RC=%s"],
    ["exact candidate checkout", 'git checkout --detach --quiet "$head_sha"'],
    ["checked-out head verification", 'actual_head="$(git rev-parse HEAD)"'],
    ["checked-out head equality", 'if [[ "$actual_head" != "$head_sha" ]]'],
    ["initial-push range", 'GITLEAKS_LOG_OPTS="$head_sha"'],
    ["bounded commit range", 'GITLEAKS_LOG_OPTS="$base_sha..$head_sha"'],
    ["gitleaks git scan", '"$RUNNER_TEMP/gitleaks-bin/gitleaks" git .'],
    ["gitleaks log options", '--log-opts="$GITLEAKS_LOG_OPTS"'],
    ["gitleaks checked-out tree scan", '"$RUNNER_TEMP/gitleaks-bin/gitleaks" dir "$head_tree"'],
    ["redaction", "--redact"],
    ["quiet banner", "--no-banner"],
    ["GitHub platform", "--platform github"],
    ["blocking exit code", "--exit-code 1"],
  ];
  const failures = required
    .filter(([, expected]) => !secretScan.includes(expected))
    .map(([label]) => label);

  const exactHeadRequired: Array<[string, string]> = [
    [
      "exact head blob listing",
      'git ls-tree -rz --full-tree "$actual_head" > "$tree_listing"',
    ],
    ["exact head blob extraction", 'git cat-file blob "$object_id" > "$destination"'],
    ["exact head blob count guard", 'if [[ "$blob_count" -eq 0 ]]'],
  ];
  if (!exactHeadScan) {
    failures.push("exact head scan step");
  } else {
    failures.push(
      ...exactHeadRequired
        .filter(([, expected]) => !exactHeadScan.includes(expected))
        .map(([label]) => label),
    );
    if (exactHeadScan.includes("git archive")) {
      failures.push("attribute-sensitive exact head archive");
    }
  }

  if (/actions\/checkout@(v\d+|main|master)\b/.test(secretScan)) {
    failures.push("floating checkout");
  }
  if (
    /gitleaks" dir "\$head_tree"[\s\S]*?--platform github[\s\S]*?--exit-code 1/.test(secretScan)
  ) {
    failures.push("unsupported tree platform flag");
  }
  if (secretScan.includes("--no-redact")) failures.push("disabled redaction");
  return failures;
}

describe("private fleet workflow skills", () => {
  test("agent-skills/ carries no skill corpus in the public repo", () => {
    // Only the pointer README remains; the fleet workflow skills live in the
    // private per-station store (hasna-internal/fleet-resources), not here.
    expect(readdirSync(AGENT_SKILLS_DIR).sort()).toEqual(["README.md"]);
  });

  test("the moved skills are absent from the repo and the customer catalog", () => {
    for (const name of PRIVATE_WORKFLOW_SKILLS) {
      expect(SKILLS.some((skill) => skill.name === name)).toBe(false);
      expect(existsSync(join(AGENT_SKILLS_DIR, name))).toBe(false);
      expect(existsSync(join(ROOT, "skills", name))).toBe(false);
      expect(existsSync(join(ROOT, "skills", `skill-${name}`))).toBe(false);
    }
  });

  test("any agent-skills directory that appears later must carry valid frontmatter", () => {
    // Future-proof guard: if a genuinely public skill is ever placed here again,
    // its frontmatter must match its folder name exactly.
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
});

describe("CI secret-scan contract", () => {
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
        "missing export-ignore negative control",
        workflow.replace("          printf 'merge-only-private-key.pem export-ignore\\n' > \"$control_repo/.gitattributes\"\n", ""),
        "export-ignore negative control",
      ],
      [
        "missing exact head checkout",
        workflow.replace('          git checkout --detach --quiet "$head_sha"\n', ""),
        "exact candidate checkout",
      ],
      [
        "attribute-sensitive exact head archive",
        workflow.replace(
          '          git ls-tree -rz --full-tree "$actual_head" > "$tree_listing"\n',
          '          git archive --format=tar --output="$tree_listing" "$actual_head"\n',
        ),
        "exact head blob listing",
      ],
      [
        "missing exact head blob extraction",
        workflow.replace('            git cat-file blob "$object_id" > "$destination"\n', ""),
        "exact head blob extraction",
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
        "unsupported tree platform flag",
        workflow.replace(
          '          "$RUNNER_TEMP/gitleaks-bin/gitleaks" dir "$head_tree" \\\n            --redact',
          '          "$RUNNER_TEMP/gitleaks-bin/gitleaks" dir "$head_tree" \\\n            --platform github \\\n            --redact',
        ),
        "unsupported tree platform flag",
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
