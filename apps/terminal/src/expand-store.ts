// Expand store — keeps full output for progressive disclosure
// Agents get summary first, call expand(key) only if they need details

const MAX_ENTRIES = 50;

interface StoredOutput {
  command: string;
  output: string;
  timestamp: number;
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

/** Retrieve full output by key, optionally filtered */
export function expandOutput(key: string, grep?: string): { found: boolean; output?: string; lines?: number } {
  const entry = store.get(key);
  if (!entry) return { found: false };

  let output = entry.output;
  if (grep) {
    const pattern = new RegExp(grep, "i");
    output = output.split("\n").filter(l => pattern.test(l)).join("\n");
  }

  return { found: true, output, lines: output.split("\n").length };
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
