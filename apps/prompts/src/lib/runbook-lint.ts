export const RUNBOOK_DETECTION_KINDS = ["boilerplate", "commands", "outputs"] as const

export type RunbookDetectionKind = typeof RUNBOOK_DETECTION_KINDS[number]

export interface RunbookPromptFile {
  path: string
  content: string
}

export interface RunbookLineSpan {
  start: number
  end: number
}

export interface RunbookFindingFile {
  path: string
  lines: RunbookLineSpan
}

export interface RunbookLintFinding {
  kind: RunbookDetectionKind
  files: RunbookFindingFile[]
  excerpt: string
}

export interface RunbookLintReport {
  version: 1
  filesScanned: number
  detections: RunbookDetectionKind[]
  findings: RunbookLintFinding[]
}

interface RunbookBlock {
  kind: RunbookDetectionKind
  path: string
  lines: RunbookLineSpan
  normalized: string
  excerpt: string
}

const HEADING_KIND_PATTERNS: ReadonlyArray<readonly [RunbookDetectionKind, RegExp]> = [
  ["outputs", /\b(outputs?|output schema|output format|response schema|response format|result schema)\b/i],
  ["commands", /\b(commands?|command inventory|tool inventory)\b/i],
  ["boilerplate", /\b(boilerplate|sop|standard operating procedure|procedures?|instructions?|guidelines?|workflow)\b/i],
]

function headingKind(heading: string): RunbookDetectionKind | undefined {
  return HEADING_KIND_PATTERNS.find(([, pattern]) => pattern.test(heading))?.[0]
}

function normalizedBlock(lines: string[]): string {
  return lines
    .filter((line) => !/^\s*(```|~~~)/.test(line))
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n")
    .toLowerCase()
}

function blockExcerpt(lines: string[]): string {
  const excerpt = lines
    .filter((line) => !/^\s*(```|~~~)/.test(line))
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")

  return excerpt.length <= 160 ? excerpt : `${excerpt.slice(0, 157)}...`
}

function markdownHeadings(lines: readonly string[]): Array<{ index: number; title: string }> {
  const headings: Array<{ index: number; title: string }> = []
  let fenceMarker: string | undefined

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence) {
      if (!fenceMarker) fenceMarker = fence[0]
      else if (fence[0] === fenceMarker) fenceMarker = undefined
      continue
    }
    if (fenceMarker) continue

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading?.[2]) headings.push({ index, title: heading[2] })
  }

  return headings
}

function extractBlocks(file: RunbookPromptFile, detections: ReadonlySet<RunbookDetectionKind>): RunbookBlock[] {
  const lines = file.content.replace(/\r\n?/g, "\n").split("\n")
  const headings = markdownHeadings(lines)
  const blocks: RunbookBlock[] = []

  for (let headingIndex = 0; headingIndex < headings.length; headingIndex += 1) {
    const heading = headings[headingIndex]
    if (!heading) continue
    const kind = headingKind(heading.title)
    if (!kind || !detections.has(kind)) continue

    let bodyStart = heading.index + 1
    let bodyEnd = headings[headingIndex + 1]?.index ?? lines.length
    while (bodyStart < bodyEnd && !(lines[bodyStart] ?? "").trim()) bodyStart += 1
    while (bodyEnd > bodyStart && !(lines[bodyEnd - 1] ?? "").trim()) bodyEnd -= 1
    if (bodyStart === bodyEnd) continue

    const body = lines.slice(bodyStart, bodyEnd)
    blocks.push({
      kind,
      path: file.path,
      lines: { start: bodyStart + 1, end: bodyEnd },
      normalized: normalizedBlock(body),
      excerpt: blockExcerpt(body),
    })
  }

  return blocks
}

export function parseRunbookDetections(value: string): RunbookDetectionKind[] {
  const requested = value.split(",").map((part) => part.trim()).filter(Boolean)
  const invalid = requested.filter((part) => !RUNBOOK_DETECTION_KINDS.includes(part as RunbookDetectionKind))
  if (invalid.length > 0) throw new Error(`Unknown detection kind(s): ${invalid.join(", ")}`)

  return RUNBOOK_DETECTION_KINDS.filter((kind) => requested.includes(kind))
}

export function analyzeRunbookPrompts(
  files: readonly RunbookPromptFile[],
  detections: readonly RunbookDetectionKind[],
): RunbookLintReport {
  const orderedDetections = RUNBOOK_DETECTION_KINDS.filter((kind) => detections.includes(kind))
  const detectionSet = new Set(orderedDetections)
  const orderedFiles = [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )
  const blocks = orderedFiles.flatMap((file) => extractBlocks(file, detectionSet))
  const findings: RunbookLintFinding[] = []

  for (const kind of orderedDetections) {
    const groups = new Map<string, RunbookBlock[]>()
    for (const block of blocks) {
      if (block.kind !== kind || !block.normalized) continue
      const matches = groups.get(block.normalized) ?? []
      matches.push(block)
      groups.set(block.normalized, matches)
    }

    for (const matches of groups.values()) {
      if (new Set(matches.map((match) => match.path)).size < 2) continue
      findings.push({
        kind,
        files: matches.map((match) => ({ path: match.path, lines: match.lines })),
        excerpt: matches[0]?.excerpt ?? "",
      })
    }
  }

  return {
    version: 1,
    filesScanned: orderedFiles.length,
    detections: orderedDetections,
    findings,
  }
}
