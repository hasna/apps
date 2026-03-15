// Parsers for git output (log, status, diff)

import type { Parser, GitLogEntry, GitStatus } from "./base.js";

export const gitLogParser: Parser<GitLogEntry[]> = {
  name: "git-log",

  detect(command: string, _output: string): boolean {
    return /\bgit\s+log\b/.test(command);
  },

  parse(_command: string, output: string): GitLogEntry[] {
    const entries: GitLogEntry[] = [];
    const lines = output.split("\n");

    // Detect oneline format: "abc1234 commit message"
    const firstLine = lines[0]?.trim() ?? "";
    const isOneline = /^[a-f0-9]{7,12}\s+/.test(firstLine) && !firstLine.startsWith("commit ");

    if (isOneline) {
      for (const line of lines) {
        const match = line.trim().match(/^([a-f0-9]{7,12})\s+(.+)$/);
        if (match) {
          entries.push({ hash: match[1], author: "", date: "", message: match[2] });
        }
      }
      return entries;
    }

    // Verbose format
    let hash = "", author = "", date = "", message: string[] = [];

    for (const line of lines) {
      const commitMatch = line.match(/^commit\s+([a-f0-9]+)/);
      if (commitMatch) {
        if (hash) {
          entries.push({ hash: hash.slice(0, 8), author, date, message: message.join(" ").trim() });
        }
        hash = commitMatch[1];
        author = ""; date = ""; message = [];
        continue;
      }

      const authorMatch = line.match(/^Author:\s+(.+)/);
      if (authorMatch) { author = authorMatch[1]; continue; }

      const dateMatch = line.match(/^Date:\s+(.+)/);
      if (dateMatch) { date = dateMatch[1].trim(); continue; }

      if (line.startsWith("    ")) {
        message.push(line.trim());
      }
    }

    if (hash) {
      entries.push({ hash: hash.slice(0, 8), author, date, message: message.join(" ").trim() });
    }

    return entries;
  },
};

export const gitStatusParser: Parser<GitStatus> = {
  name: "git-status",

  detect(command: string, _output: string): boolean {
    return /\bgit\s+status\b/.test(command);
  },

  parse(_command: string, output: string): GitStatus {
    const lines = output.split("\n");
    let branch = "";
    const staged: string[] = [];
    const unstaged: string[] = [];
    const untracked: string[] = [];

    const branchMatch = output.match(/On branch\s+(\S+)/);
    if (branchMatch) branch = branchMatch[1];

    let section = "";
    for (const line of lines) {
      if (line.includes("Changes to be committed")) { section = "staged"; continue; }
      if (line.includes("Changes not staged")) { section = "unstaged"; continue; }
      if (line.includes("Untracked files")) { section = "untracked"; continue; }

      const fileMatch = line.match(/^\s+(?:new file|modified|deleted|renamed):\s+(.+)/);
      if (fileMatch) {
        if (section === "staged") staged.push(fileMatch[1].trim());
        else if (section === "unstaged") unstaged.push(fileMatch[1].trim());
        continue;
      }

      // Untracked files are just indented filenames
      if (section === "untracked" && line.match(/^\s+\S/) && !line.includes("(use ")) {
        untracked.push(line.trim());
      }
    }

    return { branch, staged, unstaged, untracked };
  },
};
