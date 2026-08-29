// Git tools: commit, bulk_commit, smart_commit, diff, repo_state, last_commit

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ToolHelpers } from "./helpers.js";
import { stripAnsi } from "../../compression.js";
import { estimateTokens } from "../../tokens.js";
import { processOutput } from "../../output-processor.js";
import { getOutputProvider } from "../../providers/index.js";
import { invalidateBootCache } from "../../session-boot.js";
import { compactLines, truncateText } from "../../compact-output.js";

export function registerGitTools(server: McpServer, h: ToolHelpers): void {

  // ── commit ────────────────────────────────────────────────────────────────

  server.tool(
    "commit",
    "Commit and optionally push. Agent says what to commit, we handle git add/commit/push. Saves ~400 tokens vs raw git commands.",
    {
      message: z.string().describe("Commit message"),
      files: z.array(z.string()).optional().describe("Files to stage (default: all changed)"),
      push: z.boolean().optional().describe("Push after commit (default: false)"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ message, files, push, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      const addCmd = files && files.length > 0 ? `git add ${files.map(f => `"${f}"`).join(" ")}` : "git add -A";
      const commitCmd = `${addCmd} && git commit -m ${JSON.stringify(message)}`;
      const fullCmd = push ? `${commitCmd} && git push` : commitCmd;

      const result = await h.exec(fullCmd, workDir, 30000);
      const output = (result.stdout + result.stderr).trim();
      h.logCall("commit", { command: `commit: ${message.slice(0, 80)}`, durationMs: Date.now() - start, exitCode: result.exitCode });
      invalidateBootCache();

      return { content: [{ type: "text" as const, text: JSON.stringify({
        exitCode: result.exitCode,
        output: stripAnsi(output).split("\n").filter(l => l.trim()).slice(0, 5).join("\n"),
        pushed: push ?? false,
      }) }] };
    }
  );

  // ── bulk_commit ───────────────────────────────────────────────────────────

  server.tool(
    "bulk_commit",
    "Multiple logical commits in one call. Agent decides which files go in which commit, we handle all git commands. No AI cost. Use smart_commit instead if you want AI to decide the grouping.",
    {
      commits: z.array(z.object({
        message: z.string().describe("Commit message"),
        files: z.array(z.string()).describe("Files to stage for this commit"),
      })).describe("Array of logical commits"),
      push: z.boolean().optional().describe("Push after all commits (default: true)"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ commits, push, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      const results: { message: string; files: number; ok: boolean }[] = [];

      for (const c of commits) {
        const fileArgs = c.files.map(f => `"${f}"`).join(" ");
        const cmd = `git add ${fileArgs} && git commit -m ${JSON.stringify(c.message)}`;
        const r = await h.exec(cmd, workDir, 15000);
        results.push({ message: c.message, files: c.files.length, ok: r.exitCode === 0 });
      }

      let pushed = false;
      if (push !== false) {
        const pushResult = await h.exec("git push", workDir, 30000);
        pushed = pushResult.exitCode === 0;
      }

      invalidateBootCache();
      h.logCall("bulk_commit", { command: `${commits.length} commits`, durationMs: Date.now() - start });

      return { content: [{ type: "text" as const, text: JSON.stringify({ commits: results, pushed, total: results.length }) }] };
    }
  );

  // ── smart_commit ──────────────────────────────────────────────────────────

  server.tool(
    "smart_commit",
    "AI-powered git commit. Analyzes all changes, groups into logical commits with generated messages, stages and commits each group, optionally pushes. One call replaces the entire git workflow. Agent just says 'commit my work'.",
    {
      push: z.boolean().optional().describe("Push after all commits (default: true)"),
      hint: z.string().optional().describe("Optional context about the changes (e.g., 'fixed auth + added users endpoint')"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ push, hint, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();

      // 1. Get all changed files
      const status = await h.exec("git status --porcelain", workDir, 10000);
      const diffStat = await h.exec("git diff --stat", workDir, 10000);
      const untrackedDiff = await h.exec("git diff HEAD --stat", workDir, 10000);

      const changedFiles = status.stdout.trim();
      if (!changedFiles) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ message: "Nothing to commit — working tree clean" }) }] };
      }

      // 2. AI groups changes into logical commits
      const provider = getOutputProvider();

      const grouping = await provider.complete(
        `Changed files:\n${changedFiles}\n\nDiff stats:\n${diffStat.stdout}\n${untrackedDiff.stdout}${hint ? `\n\nContext: ${hint}` : ""}`,
        {
          system: `You are a git commit assistant. Group these changed files into logical commits. Return ONLY a JSON array:

[{"message": "conventional commit message", "files": ["file1.ts", "file2.ts"]}]

Rules:
- Group related changes (same feature, same fix, same refactor)
- Use conventional commits: feat:, fix:, refactor:, test:, docs:, chore:
- Message should explain WHY, not WHAT (the diff shows what)
- Each file appears in exactly one group
- If all changes are related, use a single commit
- Extract file paths from the status output (skip the status prefix like M, A, ??)`,
          maxTokens: 1000,
          temperature: 0,
        }
      );

      let commits: { message: string; files: string[] }[] = [];
      try {
        const jsonMatch = grouping.match(/\[[\s\S]*\]/);
        if (jsonMatch) commits = JSON.parse(jsonMatch[0]);
      } catch {}

      if (commits.length === 0) {
        // Fallback: single commit with all files
        commits = [{ message: hint ?? "chore: update files", files: changedFiles.split("\n").map(l => l.slice(3).trim()) }];
      }

      // 3. Execute each commit
      const results: { message: string; files: number; ok: boolean }[] = [];
      for (const c of commits) {
        const fileArgs = c.files.map(f => `"${f}"`).join(" ");
        const cmd = `git add ${fileArgs} && git commit -m ${JSON.stringify(c.message)}`;
        const r = await h.exec(cmd, workDir, 15000);
        results.push({ message: c.message, files: c.files.length, ok: r.exitCode === 0 });
      }

      // 4. Push if requested
      let pushed = false;
      if (push !== false) {
        const pushResult = await h.exec("git push", workDir, 30000);
        pushed = pushResult.exitCode === 0;
      }

      invalidateBootCache();
      h.logCall("smart_commit", { command: `${commits.length} commits`, durationMs: Date.now() - start, aiProcessed: true });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        commits: results,
        pushed,
        total: results.length,
        ok: results.every(r => r.ok),
      }) }] };
    }
  );

  // ── diff ──────────────────────────────────────────────────────────────────

  server.tool(
    "diff",
    "Show what changed — git diff with AI summary. One call replaces constructing git diff commands.",
    {
      ref: z.string().optional().describe("Diff against this ref (default: unstaged changes). Examples: HEAD~1, main, abc123"),
      file: z.string().optional().describe("Diff a specific file only"),
      stat: z.boolean().optional().describe("Show file-level stats only, not full diff (default: false)"),
      cwd: z.string().optional().describe("Working directory"),
    },
    async ({ ref, file, stat, cwd }) => {
      const start = Date.now();
      const workDir = cwd ?? process.cwd();
      let cmd = "git diff";
      if (ref) cmd += ` ${ref}`;
      if (stat) cmd += " --stat";
      if (file) cmd += ` -- ${file}`;

      const result = await h.exec(cmd, workDir, 15000);
      const output = (result.stdout + result.stderr).trim();

      if (!output) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ clean: true, message: "No changes" }) }] };
      }

      const processed = await processOutput(cmd, output);
      h.logCall("diff", { command: cmd, outputTokens: estimateTokens(output), tokensSaved: processed.tokensSaved, durationMs: Date.now() - start, aiProcessed: processed.aiProcessed });

      return { content: [{ type: "text" as const, text: JSON.stringify({
        summary: processed.summary,
        lines: output.split("\n").length,
        tokensSaved: processed.tokensSaved,
      }) }] };
    }
  );

  // ── repo_state ────────────────────────────────────────────────────────────

  server.tool(
    "repo_state",
    "Get compact repository state in one call — branch, status counts, bounded changed-file lists, and recent commits. Use verbose=true for full lists.",
    {
      path: z.string().optional().describe("Repo path (default: cwd)"),
      limit: z.number().optional().describe("Max changed files/commits to return per section (default: 20, max: 100)"),
      verbose: z.boolean().optional().describe("Return full changed-file lists and diff summary"),
    },
    async ({ path, limit, verbose }) => {
      const cwd = path ?? process.cwd();
      const [statusResult, diffResult, logResult] = await Promise.all([
        h.exec("git status --porcelain", cwd),
        h.exec("git diff --stat", cwd),
        h.exec("git log --oneline -12 --decorate", cwd),
      ]);

      const branchResult = await h.exec("git branch --show-current", cwd);

      const staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];
      for (const line of statusResult.stdout.split("\n").filter(l => l.trim())) {
        const x = line[0], y = line[1], file = line.slice(3);
        if (x === "?" && y === "?") untracked.push(file);
        else if (x !== " " && x !== "?") staged.push(file);
        if (y !== " " && y !== "?") unstaged.push(file);
      }

      const commits = logResult.stdout.split("\n").filter(l => l.trim()).map(l => {
        const match = l.match(/^([a-f0-9]+)\s+(.+)$/);
        return match ? { hash: match[1], message: match[2] } : { hash: "", message: l };
      });

      const pageSize = Math.min(limit ?? 20, 100);
      const compactDiff = compactLines(diffResult.stdout.trim() || "no changes", 30, 4000);
      const formatFiles = (files: string[]) => (verbose ? files : files.slice(0, pageSize)).map((file) => truncateText(file, 180));

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          branch: branchResult.stdout.trim(),
          dirty: staged.length + unstaged.length + untracked.length > 0,
          staged: formatFiles(staged),
          unstaged: formatFiles(unstaged),
          untracked: formatFiles(untracked),
          diffSummary: verbose ? diffResult.stdout.trim() || "no changes" : compactDiff.content,
          recentCommits: (verbose ? commits : commits.slice(0, pageSize)).map((commit) => ({
            hash: commit.hash,
            message: truncateText(commit.message, verbose ? 240 : 120),
          })),
          totals: {
            staged: staged.length,
            unstaged: unstaged.length,
            untracked: untracked.length,
            recentCommits: commits.length,
          },
          limit: pageSize,
          truncated: !verbose && (
            staged.length > pageSize ||
            unstaged.length > pageSize ||
            untracked.length > pageSize ||
            commits.length > pageSize ||
            compactDiff.truncated
          ),
          hint: "Use verbose=true for full git status arrays and diff summary.",
        }) }],
      };
    }
  );

  // ── last_commit ───────────────────────────────────────────────────────────

  server.tool(
    "last_commit",
    "Get compact details of the last commit — hash, message, and bounded diff stats. Use verbose=true for all stat lines.",
    {
      path: z.string().optional().describe("Repo path (default: cwd)"),
      limit: z.number().optional().describe("Max changed-file stat lines to return (default: 40, max: 200)"),
      verbose: z.boolean().optional().describe("Return all changed-file stat lines"),
    },
    async ({ path, limit, verbose }) => {
      const cwd = path ?? process.cwd();
      const [logResult, statResult] = await Promise.all([
        h.exec("git log -1 --format='%H%n%s%n%an%n%ai'", cwd),
        h.exec("git show --stat --format='' HEAD", cwd),
      ]);

      const [hash, message, author, date] = logResult.stdout.split("\n");
      const filesChanged = statResult.stdout.split("\n").filter(l => l.trim() && !l.includes("changed"));
      const pageSize = Math.min(limit ?? 40, 200);
      const visible = verbose ? filesChanged : filesChanged.slice(0, pageSize);

      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          hash: hash?.trim(),
          message: truncateText(message?.trim(), 200),
          author: author?.trim(),
          date: date?.trim(),
          filesChanged: visible.map((line) => truncateText(line, 220)),
          totalFilesChanged: filesChanged.length,
          returned: visible.length,
          truncated: !verbose && filesChanged.length > visible.length,
          hint: !verbose && filesChanged.length > visible.length ? "Use verbose=true for all changed-file stat lines." : undefined,
        }) }],
      };
    }
  );

  // ── git_init ────────────────────────────────────────────────────────────

  server.tool(
    "git_init",
    "Initialize a new git repo, optionally with .gitignore and initial commit.",
    {
      cwd: z.string().optional().describe("Directory to init (default: cwd)"),
      gitignore: z.string().optional().describe("Content for .gitignore file"),
      initialCommit: z.boolean().optional().describe("Create initial commit (default: true)"),
    },
    async ({ cwd, gitignore, initialCommit }) => {
      const workDir = cwd ?? process.cwd();
      await h.exec("git init", workDir, 5000);
      if (gitignore) {
        const { writeFileSync } = await import("fs");
        const { join } = await import("path");
        writeFileSync(join(workDir, ".gitignore"), gitignore);
      }
      if (initialCommit !== false) {
        await h.exec("git add -A && git commit -m 'init' --allow-empty", workDir, 10000);
      }
      h.logCall("git_init", { command: "git init" });
      return { content: [{ type: "text" as const, text: JSON.stringify({ initialized: true, cwd: workDir }) }] };
    }
  );
}
