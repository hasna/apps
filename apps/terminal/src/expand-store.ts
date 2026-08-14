// Expand store — keeps full output for progressive disclosure
// Agents get summary first, call expand(key) only if they need details

const MAX_ENTRIES = 50;

interface StoredOutput {
  command: string;
  output: string;
  timestamp: number;
}

export interface ExpandOptions {
  grep?: string;
  offset?: number;
  limit?: number;
  context?: number;
}

export interface ExpandResult {
  found: boolean;
  output?: string;
  lines?: number;
  totalLines?: number;
  offset?: number;
  limit?: number;
  truncated?: boolean;
}

const store = new Map<string, StoredOutput>();
let counter = 0;

/** Store full output and return a retrieval key */
export function storeOutput(command: string, output: string): string {
  const key = `out_${++counter}`;

  // Evict oldest if over limit
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }

  store.set(key, { command, output, timestamp: Date.now() });
  return key;
}

/** Escape regex special characters for safe use in new RegExp() */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeOptions(options?: string | ExpandOptions): ExpandOptions {
  if (typeof options === "string") return { grep: options };
  return options ?? {};
}

function clampNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

/** Retrieve output by key with optional filtering and line windows. */
export function expandOutput(key: string, options?: string | ExpandOptions): ExpandResult {
  const entry = store.get(key);
  if (!entry) return { found: false };

  const opts = normalizeOptions(options);
  let lines = entry.output.split("\n");
  const totalLines = lines.length;

  if (opts.grep) {
    // Escape metacharacters so user input like "[error" or "func()" doesn't crash
    const safe = escapeRegex(opts.grep);
    const pattern = new RegExp(safe, "i");
    const context = clampNonNegative(opts.context, 0);
    if (context === 0) {
      lines = lines.filter(l => pattern.test(l));
    } else {
      const keep = new Set<number>();
      for (let i = 0; i < lines.length; i++) {
        if (!pattern.test(lines[i])) continue;
        for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
          keep.add(j);
        }
      }
      lines = [...keep].sort((a, b) => a - b).map((i) => lines[i]);
    }
  }

  const filteredLines = lines.length;
  const offset = clampNonNegative(opts.offset, 0);
  const limit = opts.limit === undefined ? filteredLines : Math.max(0, Math.floor(opts.limit));
  const windowed = lines.slice(offset, offset + limit);
  const output = windowed.join("\n");

  return {
    found: true,
    output,
    lines: windowed.length,
    totalLines: filteredLines,
    offset,
    limit,
    truncated: offset > 0 || offset + limit < filteredLines,
  };
}

/** List available stored outputs */
export function listStored(): { key: string; command: string; lines: number; age: number }[] {
  return [...store.entries()].map(([key, entry]) => ({
    key,
    command: entry.command.slice(0, 60),
    lines: entry.output.split("\n").length,
    age: Date.now() - entry.timestamp,
  }));
}
