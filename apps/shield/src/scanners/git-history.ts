import * as path from "path";
import { execFileSync } from "child_process";
import {
  type Scanner,
  type FindingInput,
  type ScannerRunOptions,
  ScannerType,
  Severity,
} from "../types/index.js";
import { SECRET_PATTERNS } from "./secrets.js";

// --- Git history scanner ---

const DEFAULT_MAX_COMMITS = 100;

interface GitDiffEntry {
  commitHash: string;
  author: string;
  date: string;
  addedLines: Array<{ file: string; line: number; text: string }>;
}

function parseGitLog(scanPath: string, maxCount: number): GitDiffEntry[] {
  const entries: GitDiffEntry[] = [];

  try {
    const output = execFileSync(
      "git",
      ["log", "--all", "--diff-filter=A", "-p", `--format=COMMIT:%H %ae %ai`, `--max-count=${maxCount}`],
      {
        cwd: scanPath,
        maxBuffer: 50 * 1024 * 1024,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );

    let currentEntry: GitDiffEntry | null = null;
    let currentFile = "";
    let lineCounter = 0;

    for (const line of output.split("\n")) {
      if (line.startsWith("COMMIT:")) {
        const parts = line.substring(7).split(" ");
        currentEntry = {
          commitHash: parts[0],
          author: parts[1],
          date: parts.slice(2).join(" "),
          addedLines: [],
        };
        entries.push(currentEntry);
        currentFile = "";
        lineCounter = 0;
        continue;
      }

      if (line.startsWith("diff --git")) {
        const match = line.match(/b\/(.+)$/);
        if (match) currentFile = match[1];
        lineCounter = 0;
        continue;
      }

      if (line.startsWith("@@")) {
        const match = line.match(/\+(\d+)/);
        lineCounter = match ? parseInt(match[1], 10) - 1 : 0;
        continue;
      }

      if (line.startsWith("+") && !line.startsWith("+++") && currentEntry && currentFile) {
        lineCounter++;
        currentEntry.addedLines.push({
          file: currentFile,
          line: lineCounter,
          text: line.substring(1),
        });
      } else if (!line.startsWith("-")) {
        lineCounter++;
      }
    }
  } catch {
    // Not a git repo or git not available
  }

  return entries;
}

function scanDiffForSecrets(entries: GitDiffEntry[]): FindingInput[] {
  const findings: FindingInput[] = [];

  for (const entry of entries) {
    for (const addedLine of entry.addedLines) {
      for (const sp of SECRET_PATTERNS) {
        sp.pattern.lastIndex = 0;
        if (sp.pattern.test(addedLine.text)) {
          findings.push({
            rule_id: `git-${sp.id}`,
            scanner_type: ScannerType.GitHistory,
            severity: sp.severity,
            file: addedLine.file,
            line: addedLine.line,
            message: `${sp.name} found in git history (commit ${entry.commitHash.substring(0, 8)} by ${entry.author} on ${entry.date})`,
            code_snippet: addedLine.text,
          });
        }
      }
    }
  }

  return findings;
}

// --- Check if secrets were removed but still in history ---

function detectRemovedSecrets(scanPath: string, findings: FindingInput[]): FindingInput[] {
  const enhanced: FindingInput[] = [];

  for (const finding of findings) {
    const filePath = path.join(scanPath, finding.file);
    let stillPresent = false;

    try {
      const currentContent = execFileSync("git", ["show", `HEAD:${finding.file}`], {
        cwd: scanPath,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      });
      // Check if the secret pattern is still in the current file
      const ruleId = finding.rule_id.replace(/^git-/, "");
      const pattern = SECRET_PATTERNS.find((sp) => sp.id === ruleId);
      if (pattern) {
        pattern.pattern.lastIndex = 0;
        stillPresent = pattern.pattern.test(currentContent);
      }
    } catch {
      // File no longer exists at HEAD — secret was removed
      stillPresent = false;
    }

    if (!stillPresent) {
      enhanced.push({
        ...finding,
        severity: finding.severity === Severity.Critical ? Severity.High : finding.severity,
        message: `${finding.message} — secret was removed from current version but remains in git history`,
      });
    } else {
      enhanced.push(finding);
    }
  }

  return enhanced;
}

export const gitHistoryScanner: Scanner = {
  name: "Git History Scanner",
  type: ScannerType.GitHistory,
  description: "Scans git commit history for secrets that were committed (even if later removed)",

  async scan(scanPath: string, _options?: ScannerRunOptions): Promise<FindingInput[]> {
    // Check if this is a git repository
    try {
      execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: scanPath,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      return [];
    }

    const entries = parseGitLog(scanPath, DEFAULT_MAX_COMMITS);
    if (entries.length === 0) return [];

    const rawFindings = scanDiffForSecrets(entries);
    if (rawFindings.length === 0) return [];

    return detectRemovedSecrets(scanPath, rawFindings);
  },
};

export default gitHistoryScanner;
