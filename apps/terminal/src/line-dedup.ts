// Cross-command line deduplication — track lines already shown to agent
// When new output contains >50% already-seen lines, suppress them

const seenLines = new Set<string>();
const MAX_SEEN = 5000;

function normalize(line: string): string {
  return line.trim().toLowerCase();
}

export interface DedupResult {
  output: string;
  novelCount: number;
  seenCount: number;
  deduplicated: boolean;
}

/** Deduplicate output lines against session history */
export function dedup(output: string): DedupResult {
  const lines = output.split("\n");
  if (lines.length < 5) {
    // Short output — add to seen, don't dedup
    for (const l of lines) { if (l.trim()) seenLines.add(normalize(l)); }
    return { output, novelCount: lines.length, seenCount: 0, deduplicated: false };
  }

  let novelCount = 0;
  let seenCount = 0;
  const novel: string[] = [];

  for (const line of lines) {
    const norm = normalize(line);
    if (!norm) { novel.push(line); continue; }

    if (seenLines.has(norm)) {
      seenCount++;
    } else {
      novelCount++;
      novel.push(line);
      seenLines.add(norm);
    }
  }

  // Evict oldest if too large
  if (seenLines.size > MAX_SEEN) {
    const entries = [...seenLines];
    for (let i = 0; i < entries.length - MAX_SEEN; i++) {
      seenLines.delete(entries[i]);
    }
  }

  // Only dedup if >50% were already seen
  if (seenCount > lines.length * 0.5) {
    const result = novel.join("\n");
    return { output: result + `\n(${seenCount} lines already shown, omitted)`, novelCount, seenCount, deduplicated: true };
  }

  // Add all to seen but return full output
  for (const l of lines) { if (l.trim()) seenLines.add(normalize(l)); }
  return { output, novelCount: lines.length, seenCount: 0, deduplicated: false };
}

/** Clear dedup history */
export function clearDedup(): void {
  seenLines.clear();
}
