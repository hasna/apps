// Discover — scan Claude Code session history to find token savings opportunities
// Reads ~/.claude/projects/*/sessions/*.jsonl, extracts Bash commands + output sizes,
// estimates how much terminal would have saved.

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join } from "path";
import { estimateTokens } from "./tokens.js";

export interface DiscoveredCommand {
  command: string;
  outputTokens: number;
  outputChars: number;
  sessionFile: string;
  timestamp?: string;
}

export interface DiscoverReport {
  totalSessions: number;
  totalCommands: number;
  totalOutputTokens: number;
  estimatedSavings: number; // tokens saved at 70% compression
  estimatedSavingsUsd: number; // at Opus rates ($5/M input)
  topCommands: { command: string; count: number; totalTokens: number; avgTokens: number }[];
  commandsByCategory: Record<string, { count: number; tokens: number }>;
}

/** Find all Claude session JSONL files */
function findSessionFiles(claudeDir: string, maxAge?: number): string[] {
  const files: string[] = [];
  const projectsDir = join(claudeDir, "projects");
  if (!existsSync(projectsDir)) return files;

  const now = Date.now();
  const cutoff = maxAge ? now - maxAge : 0;

  try {
    for (const project of readdirSync(projectsDir)) {
      const projectPath = join(projectsDir, project);
      // Look for session JSONL files (not subagents)
      try {
        for (const entry of readdirSync(projectPath)) {
          if (entry.endsWith(".jsonl")) {
            const filePath = join(projectPath, entry);
            try {
              const stat = statSync(filePath);
              if (stat.mtimeMs > cutoff) files.push(filePath);
            } catch {}
          }
        }
      } catch {}
    }
  } catch {}

  return files;
}

/** Extract Bash commands and their output sizes from a session file */
function extractCommands(sessionFile: string): DiscoveredCommand[] {
  const commands: DiscoveredCommand[] = [];

  try {
    const content = readFileSync(sessionFile, "utf8");
    const lines = content.split("\n").filter(l => l.trim());

    // Track tool_use IDs to match with tool_results
    const pendingToolUses: Map<string, string> = new Map(); // id -> command

    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const msg = obj.message;
        if (!msg?.content || !Array.isArray(msg.content)) continue;

        for (const block of msg.content) {
          // Capture Bash tool_use commands
          if (block.type === "tool_use" && block.name === "Bash" && block.input?.command) {
            pendingToolUses.set(block.id, block.input.command);
          }

          // Capture tool_result outputs and match to commands
          if (block.type === "tool_result" && block.tool_use_id) {
            const command = pendingToolUses.get(block.tool_use_id);
            if (command) {
              let outputText = "";
              if (typeof block.content === "string") {
                outputText = block.content;
              } else if (Array.isArray(block.content)) {
                outputText = block.content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => c.text)
                  .join("\n");
              }

              if (outputText.length > 0) {
                commands.push({
                  command,
                  outputTokens: estimateTokens(outputText),
                  outputChars: outputText.length,
                  sessionFile,
                });
              }
              pendingToolUses.delete(block.tool_use_id);
            }
          }
        }
      } catch {} // skip malformed lines
    }
  } catch {} // skip unreadable files

  return commands;
}

/** Categorize a command into a bucket */
function categorizeCommand(cmd: string): string {
  const trimmed = cmd.trim();
  if (/^git\b/.test(trimmed)) return "git";
  if (/\b(bun|npm|yarn|pnpm)\s+(test|run\s+test)/.test(trimmed)) return "test";
  if (/\b(bun|npm|yarn|pnpm)\s+run\s+(build|typecheck|lint)/.test(trimmed)) return "build";
  if (/^(grep|rg)\b/.test(trimmed)) return "grep";
  if (/^find\b/.test(trimmed)) return "find";
  if (/^(cat|head|tail|less)\b/.test(trimmed)) return "read";
  if (/^(ls|tree|du|wc)\b/.test(trimmed)) return "list";
  if (/^(curl|wget|fetch)\b/.test(trimmed)) return "network";
  if (/^(docker|kubectl|helm)\b/.test(trimmed)) return "infra";
  if (/^(python|pip|pytest)\b/.test(trimmed)) return "python";
  if (/^(cargo|rustc)\b/.test(trimmed)) return "rust";
  if (/^(go\s|golangci)\b/.test(trimmed)) return "go";
  return "other";
}

/** Normalize command for grouping (strip variable parts like paths, hashes) */
function normalizeCommand(cmd: string): string {
  return cmd
    .replace(/[0-9a-f]{7,40}/g, "{hash}") // git hashes
    .replace(/\/[\w./-]+\.(ts|tsx|js|json|py|rs|go)\b/g, "{file}") // file paths
    .replace(/\d{4}-\d{2}-\d{2}/g, "{date}") // dates
    .replace(/:\d+/g, ":{line}") // line numbers
    .trim();
}

/** Run discover across all Claude sessions */
export function discover(options: { maxAgeDays?: number; minTokens?: number } = {}): DiscoverReport {
  const claudeDir = join(process.env.HOME ?? "~", ".claude");
  const maxAge = (options.maxAgeDays ?? 30) * 24 * 60 * 60 * 1000;
  const minTokens = options.minTokens ?? 50;

  const sessionFiles = findSessionFiles(claudeDir, maxAge);
  const allCommands: DiscoveredCommand[] = [];

  for (const file of sessionFiles) {
    allCommands.push(...extractCommands(file));
  }

  // Filter to commands with meaningful output
  const significant = allCommands.filter(c => c.outputTokens >= minTokens);

  // Group by normalized command
  const groups = new Map<string, { count: number; totalTokens: number; example: string }>();
  for (const cmd of significant) {
    const key = normalizeCommand(cmd.command);
    const existing = groups.get(key) ?? { count: 0, totalTokens: 0, example: cmd.command };
    existing.count++;
    existing.totalTokens += cmd.outputTokens;
    groups.set(key, existing);
  }

  // Top commands by total tokens
  const topCommands = [...groups.entries()]
    .map(([cmd, data]) => ({
      command: data.example,
      count: data.count,
      totalTokens: data.totalTokens,
      avgTokens: Math.round(data.totalTokens / data.count),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 20);

  // Category breakdown
  const commandsByCategory: Record<string, { count: number; tokens: number }> = {};
  for (const cmd of significant) {
    const cat = categorizeCommand(cmd.command);
    if (!commandsByCategory[cat]) commandsByCategory[cat] = { count: 0, tokens: 0 };
    commandsByCategory[cat].count++;
    commandsByCategory[cat].tokens += cmd.outputTokens;
  }

  const totalOutputTokens = significant.reduce((sum, c) => sum + c.outputTokens, 0);
  // Conservative 70% compression estimate (RTK claims 60-90%)
  const estimatedSavings = Math.round(totalOutputTokens * 0.7);
  // Each saved input token is repeated across ~5 turns on average before compaction
  const multipliedSavings = estimatedSavings * 5;
  // At Opus rates ($5/M input tokens)
  const estimatedSavingsUsd = (multipliedSavings * 5) / 1_000_000;

  return {
    totalSessions: sessionFiles.length,
    totalCommands: significant.length,
    totalOutputTokens,
    estimatedSavings,
    estimatedSavingsUsd,
    topCommands,
    commandsByCategory,
  };
}

/** Format discover report for CLI display */
export function formatDiscoverReport(report: DiscoverReport): string {
  const lines: string[] = [];

  lines.push(`📊 Terminal Discover — Token Savings Analysis`);
  lines.push(`   Scanned ${report.totalSessions} sessions, ${report.totalCommands} commands with >50 token output\n`);

  lines.push(`💰 Estimated savings with open-terminal:`);
  lines.push(`   Output tokens: ${report.totalOutputTokens.toLocaleString()}`);
  lines.push(`   Compressible:  ${report.estimatedSavings.toLocaleString()} tokens (70% avg)`);
  lines.push(`   Repeated ~5x before compaction = ${(report.estimatedSavings * 5).toLocaleString()} billable tokens`);
  lines.push(`   At Opus rates: $${report.estimatedSavingsUsd.toFixed(2)} saved\n`);

  if (report.topCommands.length > 0) {
    lines.push(`🔝 Top commands by token cost:`);
    for (const cmd of report.topCommands.slice(0, 15)) {
      const avg = cmd.avgTokens.toLocaleString().padStart(6);
      const total = cmd.totalTokens.toLocaleString().padStart(8);
      lines.push(`   ${String(cmd.count).padStart(4)}× ${avg} avg → ${total} total  ${cmd.command.slice(0, 60)}`);
    }
    lines.push("");
  }

  if (Object.keys(report.commandsByCategory).length > 0) {
    lines.push(`📁 By category:`);
    const sorted = Object.entries(report.commandsByCategory).sort((a, b) => b[1].tokens - a[1].tokens);
    for (const [cat, data] of sorted) {
      lines.push(`   ${cat.padEnd(10)} ${String(data.count).padStart(5)} cmds  ${data.tokens.toLocaleString().padStart(10)} tokens`);
    }
  }

  return lines.join("\n");
}
