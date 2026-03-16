export interface DiffLine {
  type: "added" | "removed" | "unchanged"
  content: string
  lineNum?: number
}

export function diffTexts(a: string, b: string): DiffLine[] {
  const aLines = a.split("\n")
  const bLines = b.split("\n")

  // Simple LCS-based line diff
  const m = aLines.length
  const n = bLines.length

  // Build LCS table
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0) as number[])
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      lcs[i]![j] = aLines[i - 1] === bLines[j - 1]
        ? (lcs[i - 1]![j - 1] ?? 0) + 1
        : Math.max(lcs[i - 1]![j] ?? 0, lcs[i]![j - 1] ?? 0)
    }
  }

  // Traceback
  const trace: DiffLine[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aLines[i - 1] === bLines[j - 1]) {
      trace.unshift({ type: "unchanged", content: aLines[i - 1] ?? "" })
      i--; j--
    } else if (j > 0 && (i === 0 || (lcs[i]![j - 1] ?? 0) >= (lcs[i - 1]![j] ?? 0))) {
      trace.unshift({ type: "added", content: bLines[j - 1] ?? "" })
      j--
    } else {
      trace.unshift({ type: "removed", content: aLines[i - 1] ?? "" })
      i--
    }
  }

  return trace
}

export function formatDiff(lines: DiffLine[]): string {
  return lines.map((l) => {
    if (l.type === "added") return `+ ${l.content}`
    if (l.type === "removed") return `- ${l.content}`
    return `  ${l.content}`
  }).join("\n")
}
