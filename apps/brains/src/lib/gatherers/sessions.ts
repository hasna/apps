import { readdir, readFile, stat } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { GatherResult, GathererOptions, TrainingExample } from "./types.js";

const SYSTEM_PROMPT = "You are Claude Code, an AI assistant built by Anthropic that helps developers with coding, architecture, debugging, and software engineering tasks."

function extractText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content
  return content
    .filter(c => c.type === "text" && c.text)
    .map(c => (c as { text: string }).text)
    .join("\n")
    .trim()
}

// Gathers training data from Claude Code session transcripts (~/.claude/projects/)
export async function gatherFromSessions(options: GathererOptions = {}): Promise<GatherResult> {
  const { limit = 1000 } = options;
  const examples: TrainingExample[] = [];

  const claudeDir = join(homedir(), ".claude", "projects");
  if (!existsSync(claudeDir)) {
    return { source: "sessions", examples: [], count: 0 };
  }

  const projectDirs = await readdir(claudeDir).catch(() => [] as string[]);

  for (const projectDir of projectDirs) {
    if (examples.length >= limit) break;
    const projectPath = join(claudeDir, projectDir);
    const files = await readdir(projectPath).catch(() => [] as string[]);

    for (const file of files) {
      if (examples.length >= limit) break;
      if (!file.endsWith(".jsonl")) continue;

      const filePath = join(projectPath, file);

      // Filter by modification time when `since` is provided
      if (options.since) {
        const fileStat = await stat(filePath).catch(() => null)
        if (fileStat && fileStat.mtime < options.since) continue
      }

      const content = await readFile(filePath, "utf-8").catch(() => "");
      if (!content.trim()) continue;

      const lines = content.trim().split("\n");
      // Collect ordered turns from this session file
      const turns: Array<{ role: "user" | "assistant"; content: string }> = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          // Claude Code session JSONL uses type "user" (not "human") and type "assistant"
          if ((entry.type === "user" || entry.type === "human") && entry.message?.content) {
            const text = extractText(entry.message.content)
            if (text.trim()) turns.push({ role: "user", content: text.trim() });
          } else if (entry.type === "assistant" && entry.message?.content) {
            const text = extractText(entry.message.content)
            if (text.trim()) turns.push({ role: "assistant", content: text.trim() });
          }
        } catch {
          // skip malformed lines
        }
      }

      // Sliding window of up to 6 turns to build multi-turn examples
      const windowSize = 6;
      for (let start = 0; start < turns.length - 1 && examples.length < limit; start++) {
        const window = turns.slice(start, start + windowSize);
        // Window must start with user
        if (!window[0] || window[0].role !== "user") continue;
        const lastAssistantIdx = window.map(t => t.role).lastIndexOf("assistant");
        if (lastAssistantIdx < 1) continue;

        const usedTurns = window.slice(0, lastAssistantIdx + 1);
        examples.push({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...usedTurns,
          ],
        });
      }
    }
  }

  return { source: "sessions", examples, count: examples.length };
}
