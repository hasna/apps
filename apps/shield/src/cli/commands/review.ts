import type { Command } from "commander";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import chalk from "chalk";
import {
  ScannerType,
  ReportFormat,
  type Finding,
  type FindingInput,
} from "../../types/index.js";
import { runScanner } from "../../scanners/index.js";
import { getReporter } from "../../reporters/index.js";

interface StagedFile {
  path: string;
  addedLines: Set<number>;
}

function readGitPaths(cwd: string, diffFilter?: string): string[] {
  const args = ["diff", "--cached", "--name-only", "-z"];
  if (diffFilter) args.push(`--diff-filter=${diffFilter}`);
  const output = execFileSync("git", args, { cwd, encoding: "buffer" });
  return output.toString("utf-8").split("\0").filter(Boolean);
}

function safeStagedPath(filePath: string): string {
  const normalized = normalize(filePath);
  if (
    !filePath ||
    isAbsolute(filePath) ||
    normalized === ".." ||
    normalized.startsWith(`..${sep}`)
  ) {
    throw new Error("Staged path escapes the repository boundary");
  }
  return normalized;
}

function addedLinesForFile(cwd: string, filePath: string): Set<number> {
  const diff = execFileSync(
    "git",
    [
      "--literal-pathspecs",
      "diff",
      "--cached",
      "--unified=0",
      "--no-color",
      "--no-ext-diff",
      "--",
      filePath,
    ],
    { cwd, encoding: "utf-8" },
  );
  const addedLines = new Set<number>();

  for (const line of diff.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!hunk) continue;
    const start = Number.parseInt(hunk[1], 10);
    const count = hunk[2] === undefined ? 1 : Number.parseInt(hunk[2], 10);
    for (let offset = 0; offset < count; offset++) addedLines.add(start + offset);
  }

  return addedLines;
}

function findingTouchesAddedLine(finding: FindingInput, addedLines: Set<number>): boolean {
  const endLine = finding.end_line ?? finding.line;
  for (let line = finding.line; line <= endLine; line++) {
    if (addedLines.has(line)) return true;
  }
  return false;
}

async function scanStagedFiles(cwd: string, stagedFiles: StagedFile[]): Promise<FindingInput[]> {
  const snapshotRoot = mkdtempSync(join(tmpdir(), "shield-staged-review-"));
  try {
    const addedLinesByPath = new Map<string, Set<number>>();
    for (const stagedFile of stagedFiles) {
      const filePath = safeStagedPath(stagedFile.path);
      const snapshotPath = join(snapshotRoot, filePath);
      mkdirSync(dirname(snapshotPath), { recursive: true });
      const content = execFileSync("git", ["show", `:${stagedFile.path}`], {
        cwd,
        encoding: "buffer",
      });
      writeFileSync(snapshotPath, content);
      addedLinesByPath.set(filePath.split(sep).join("/"), stagedFile.addedLines);
    }

    const findings: FindingInput[] = [];
    for (const scannerType of [ScannerType.Secrets, ScannerType.Code]) {
      const results = await runScanner(scannerType, snapshotRoot, {
        // A staged review promises coverage of every staged hunk. Repository-wide
        // ignore patterns are appropriate for broad scans, not an explicit diff.
        ignore_patterns: [],
      });
      findings.push(
        ...results.filter((finding) => {
          const addedLines = addedLinesByPath.get(finding.file.split(sep).join("/"));
          return addedLines !== undefined && findingTouchesAddedLine(finding, addedLines);
        }),
      );
    }
    return findings;
  } finally {
    rmSync(snapshotRoot, { recursive: true, force: true });
  }
}

export function registerReviewCommand(program: Command): void {
  program
    .command("review")
    .description("Security review staged git changes")
    .action(async () => {
      let allChangedFiles: string[];
      let stagedFiles: StagedFile[];
      try {
        const cwd = process.cwd();
        allChangedFiles = readGitPaths(cwd);
        stagedFiles = readGitPaths(cwd, "ACMR").map((path) => ({
          path,
          addedLines: addedLinesForFile(cwd, path),
        }));
      } catch {
        console.error(chalk.red("\n  Failed to get staged diff. Are you in a git repo?\n"));
        process.exit(1);
        return;
      }

      if (allChangedFiles.length === 0) {
        console.log(chalk.yellow("\n  No staged changes to review.\n"));
        return;
      }

      console.log(chalk.bold("\n  Reviewing staged changes...\n"));

      if (stagedFiles.length === 0) {
        console.log(chalk.green("  No files in staged diff to review.\n"));
        return;
      }

      console.log(chalk.gray(`  Checking ${stagedFiles.length} changed file(s)...`));

      const cwd = process.cwd();
      let findingInputs: FindingInput[];
      try {
        findingInputs = await scanStagedFiles(cwd, stagedFiles);
      } catch {
        console.error(chalk.red("\n  Failed to scan the staged diff.\n"));
        process.exit(1);
        return;
      }

      if (findingInputs.length === 0) {
        console.log(chalk.green("\n  No security issues found in staged changes.\n"));
        return;
      }

      const tempFindings: Finding[] = findingInputs.map((input, i) => ({
        id: `review-${i}`,
        scan_id: "review",
        rule_id: input.rule_id,
        scanner_type: input.scanner_type,
        severity: input.severity,
        file: input.file,
        line: input.line,
        column: input.column ?? null,
        end_line: input.end_line ?? null,
        message: input.message,
        code_snippet: input.code_snippet ?? null,
        fingerprint: `review-${i}`,
        suppressed: false,
        suppressed_reason: null,
        llm_explanation: null,
        llm_fix: null,
        llm_exploitability: null,
        created_at: new Date().toISOString(),
      }));

      const reporter = getReporter(ReportFormat.Terminal);
      reporter.report(tempFindings);
    });
}
