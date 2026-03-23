// Session context — stores last N command+output pairs for follow-up queries
// Enables: terminal "show auth code" → terminal "explain that function"

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { getTerminalDir } from "./paths.js";

const DIR = getTerminalDir();
const CTX_FILE = join(DIR, "session-context.json");
const MAX_ENTRIES = 5;

interface ContextEntry {
  prompt: string;
  command: string;
  output: string; // first 500 chars
  timestamp: number;
}

function ensureDir() {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true });
}

/** Load session context */
export function loadContext(): ContextEntry[] {
  ensureDir();
  if (!existsSync(CTX_FILE)) return [];
  try {
    const entries = JSON.parse(readFileSync(CTX_FILE, "utf8")) as ContextEntry[];
    // Only return entries from last 30 minutes (session freshness)
    const cutoff = Date.now() - 30 * 60 * 1000;
    return entries.filter(e => e.timestamp > cutoff).slice(-MAX_ENTRIES);
  } catch { return []; }
}

/** Save a command to session context */
export function saveContext(prompt: string, command: string, output: string): void {
  ensureDir();
  const entries = loadContext();
  entries.push({
    prompt,
    command,
    output: output.slice(0, 500),
    timestamp: Date.now(),
  });
  // Keep only last N
  const trimmed = entries.slice(-MAX_ENTRIES);
  writeFileSync(CTX_FILE, JSON.stringify(trimmed, null, 2));
}

/** Format context for AI prompt injection */
export function formatContext(): string {
  const entries = loadContext();
  if (entries.length === 0) return "";
  const lines: string[] = ["\nRECENT SESSION CONTEXT (for follow-up references like 'that', 'it', 'the same'):"];
  for (const e of entries.slice(-3)) {
    lines.push(`> ${e.prompt}`);
    lines.push(`$ ${e.command}`);
    if (e.output) lines.push(e.output.slice(0, 200));
  }
  return lines.join("\n");
}
