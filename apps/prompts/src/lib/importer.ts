import { upsertPrompt, listPrompts } from "../db/prompts.js"
import type { CreatePromptInput, Prompt } from "../types/index.js"

export interface ImportItem {
  title: string
  body: string
  slug?: string
  description?: string
  collection?: string
  tags?: string[]
}

export interface ImportResult {
  created: number
  updated: number
  errors: Array<{ item: string; error: string }>
}

export function importFromJson(items: ImportItem[], changedBy?: string): ImportResult {
  let created = 0
  let updated = 0
  const errors: Array<{ item: string; error: string }> = []

  for (const item of items) {
    try {
      const input: CreatePromptInput = {
        title: item.title,
        body: item.body,
        slug: item.slug,
        description: item.description,
        collection: item.collection,
        tags: item.tags,
        source: "imported",
        changed_by: changedBy,
      }
      const { created: wasCreated } = upsertPrompt(input)
      if (wasCreated) created++
      else updated++
    } catch (e) {
      errors.push({ item: item.title, error: e instanceof Error ? e.message : String(e) })
    }
  }

  return { created, updated, errors }
}

export function exportToJson(collection?: string): {
  prompts: Prompt[]
  exported_at: string
  collection?: string
} {
  const prompts = listPrompts({ collection, limit: 10000 })
  return { prompts, exported_at: new Date().toISOString(), collection }
}

// ── Markdown export ───────────────────────────────────────────────────────────
// Each prompt becomes a .md file with YAML frontmatter:
//   ---
//   title: My Prompt
//   slug: my-prompt
//   collection: default
//   tags: [foo, bar]
//   description: Short description
//   ---
//   <body>

export function promptToMarkdown(prompt: Prompt): string {
  const tags = prompt.tags.length > 0
    ? `[${prompt.tags.map((tag) => formatFrontmatterScalar(tag)).join(", ")}]`
    : "[]"
  const desc = prompt.description ? `\ndescription: ${formatFrontmatterScalar(prompt.description)}` : ""
  return `---
title: ${formatFrontmatterScalar(prompt.title)}
slug: ${formatFrontmatterScalar(prompt.slug)}
collection: ${formatFrontmatterScalar(prompt.collection)}
tags: ${tags}${desc}
---

${prompt.body}
`
}

const SAFE_PLAIN_FRONTMATTER_SCALAR = /^[A-Za-z0-9][A-Za-z0-9 _./-]*$/
const YAML_IMPLICIT_PLAIN_SCALAR = /^(?:~|null|true|false|yes|no|on|off|0b[0-1_]+|0x[0-9a-f_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:e[-+]?[0-9_]+)?|\d{4}-\d{2}-\d{2})$/i

function formatFrontmatterScalar(value: string): string {
  if (!needsQuotedFrontmatterScalar(value)) return value
  return `"${escapeDoubleQuotedFrontmatterScalar(value)}"`
}

function needsQuotedFrontmatterScalar(value: string): boolean {
  return !SAFE_PLAIN_FRONTMATTER_SCALAR.test(value)
    || YAML_IMPLICIT_PLAIN_SCALAR.test(value)
}

function escapeDoubleQuotedFrontmatterScalar(value: string): string {
  let escaped = ""
  for (const char of value) {
    if (char === "\\") escaped += "\\\\"
    else if (char === "\"") escaped += "\\\""
    else if (char === "\0") escaped += "\\0"
    else if (char === "\b") escaped += "\\b"
    else if (char === "\t") escaped += "\\t"
    else if (char === "\n") escaped += "\\n"
    else if (char === "\f") escaped += "\\f"
    else if (char === "\r") escaped += "\\r"
    else {
      const code = char.charCodeAt(0)
      if (code === 0x2028 || code === 0x2029) {
        escaped += `\\u${code.toString(16).toUpperCase()}`
      } else {
        escaped += code < 0x20 || (code >= 0x7F && code <= 0x9F)
          ? `\\x${code.toString(16).toUpperCase().padStart(2, "0")}`
          : char
      }
    }
  }
  return escaped
}

export function exportToMarkdownFiles(collection?: string): Array<{ filename: string; content: string }> {
  const prompts = listPrompts({ collection, limit: 10000 })
  return prompts.map((p) => ({
    filename: `${p.slug}.md`,
    content: promptToMarkdown(p),
  }))
}

// ── Markdown import ───────────────────────────────────────────────────────────
export function markdownToImportItem(content: string, filename?: string): ImportItem | null {
  const normalized = content.replace(/\r\n?/g, "\n")
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n+([\s\S]*)$/)
  if (!frontmatterMatch) {
    // No frontmatter — treat entire content as body, filename as title
    if (!filename) return null
    const title = filename.replace(/\.md$/, "").replace(/-/g, " ")
    return { title, body: normalized.trim() }
  }

  const frontmatter = frontmatterMatch[1] ?? ""
  const body = (frontmatterMatch[2] ?? "").trim()

  const get = (key: string): string | null => {
    const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
    return m ? parseFrontmatterScalar(m[1] ?? "") : null
  }

  const title = get("title") ?? (filename?.replace(/\.md$/, "").replace(/-/g, " ") ?? "Untitled")
  const slug = get("slug") ?? undefined
  const collection = get("collection") ?? undefined
  const description = get("description") ?? undefined

  const tagsStr = get("tags")
  let tags: string[] | undefined
  if (tagsStr) {
    tags = parseFrontmatterList(tagsStr)
  }

  return { title, slug, body, collection, tags, description }
}

function parseFrontmatterScalar(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length < 2) return trimmed

  const quote = trimmed[0]
  if ((quote !== "\"" && quote !== "'") || trimmed[trimmed.length - 1] !== quote) {
    return trimmed
  }

  const inner = trimmed.slice(1, -1)
  if (quote === "'") return inner.replace(/''/g, "'")
  return parseDoubleQuotedScalar(inner)
}

function parseDoubleQuotedScalar(value: string): string {
  let parsed = ""
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!
    if (char !== "\\" || i + 1 >= value.length) {
      parsed += char
      continue
    }

    const escaped = value[++i]!
    if (escaped === "n") parsed += "\n"
    else if (escaped === "r") parsed += "\r"
    else if (escaped === "t") parsed += "\t"
    else if (escaped === "0") parsed += "\0"
    else if (escaped === "b") parsed += "\b"
    else if (escaped === "f") parsed += "\f"
    else if (escaped === "e") parsed += "\x1B"
    else if (escaped === "\"") parsed += "\""
    else if (escaped === "\\") parsed += "\\"
    else if (escaped === "x") {
      const hex = parseHexEscape(value, i + 1, 2)
      if (!hex) parsed += "\\x"
      else {
        parsed += hex.char
        i += 2
      }
    }
    else if (escaped === "u") {
      const hex = parseHexEscape(value, i + 1, 4)
      if (!hex) parsed += "\\u"
      else {
        parsed += hex.char
        i += 4
      }
    }
    else if (escaped === "U") {
      const hex = parseHexEscape(value, i + 1, 8)
      if (!hex) parsed += "\\U"
      else {
        parsed += hex.char
        i += 8
      }
    }
    else parsed += `\\${escaped}`
  }
  return parsed
}

function parseHexEscape(value: string, start: number, length: number): { char: string } | null {
  const hex = value.slice(start, start + length)
  if (hex.length !== length || !/^[0-9a-fA-F]+$/.test(hex)) return null
  try {
    return { char: String.fromCodePoint(Number.parseInt(hex, 16)) }
  } catch {
    return null
  }
}

function parseFrontmatterList(value: string): string[] {
  const trimmed = value.trim()
  const inner = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed
  const items: string[] = []
  let current = ""
  let quote: "\"" | "'" | null = null

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i]!
    if (quote) {
      current += char
      if (char === "\\" && quote === "\"" && i + 1 < inner.length) {
        current += inner[++i]!
      } else if (char === quote) {
        quote = null
      }
      continue
    }

    if (char === "\"" || char === "'") {
      quote = char
      current += char
    } else if (char === ",") {
      items.push(current)
      current = ""
    } else {
      current += char
    }
  }
  items.push(current)

  return items.map(parseFrontmatterScalar).filter(Boolean)
}

export function importFromMarkdown(files: Array<{ filename: string; content: string }>, changedBy?: string): ImportResult {
  const items = files
    .map((f) => markdownToImportItem(f.content, f.filename))
    .filter((item): item is ImportItem => item !== null)
  return importFromJson(items, changedBy)
}

// ── Auto-scan slash commands from all agents ──────────────────────────────────
export interface SlashCommandScanResult {
  scanned: Array<{ source: string; file: string }>
  imported: ImportResult
}

export function scanAndImportSlashCommands(
  rootDir: string,
  changedBy?: string
): SlashCommandScanResult {
  const { existsSync, readdirSync, readFileSync } = require("fs") as typeof import("fs")
  const { join } = require("path") as typeof import("path")
  const home = process.env["HOME"] ?? "~"

  const sources: Array<{ dir: string; collection: string; tags: string[] }> = [
    { dir: join(rootDir, ".claude", "commands"), collection: "claude-commands", tags: ["claude", "slash-command"] },
    { dir: join(home, ".claude", "commands"), collection: "claude-commands", tags: ["claude", "slash-command"] },
    { dir: join(rootDir, ".codex", "skills"), collection: "codex-skills", tags: ["codex", "skill"] },
    { dir: join(home, ".codex", "skills"), collection: "codex-skills", tags: ["codex", "skill"] },
    { dir: join(rootDir, ".gemini", "extensions"), collection: "gemini-extensions", tags: ["gemini", "extension"] },
    { dir: join(home, ".gemini", "extensions"), collection: "gemini-extensions", tags: ["gemini", "extension"] },
  ]

  const files: Array<{ filename: string; content: string; collection: string; tags: string[] }> = []
  const scanned: Array<{ source: string; file: string }> = []

  for (const { dir, collection, tags } of sources) {
    if (!existsSync(dir)) continue
    let entries: string[]
    try {
      entries = readdirSync(dir) as string[]
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue
      const filePath = join(dir, entry)
      try {
        const content = readFileSync(filePath, "utf-8") as string
        files.push({ filename: entry, content, collection, tags })
        scanned.push({ source: dir, file: entry })
      } catch {
        // skip unreadable files
      }
    }
  }

  const items: ImportItem[] = files.map((f) => {
    const base = markdownToImportItem(f.content, f.filename)
    if (base) return { ...base, collection: base.collection ?? f.collection, tags: base.tags ?? f.tags }
    const name = f.filename.replace(/\.md$/, "")
    const title = name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    return { title, slug: name, body: f.content.trim(), collection: f.collection, tags: f.tags }
  })

  const imported = importFromJson(items, changedBy)
  return { scanned, imported }
}

// ── Claude Code slash commands import ────────────────────────────────────────
// Claude Code stores slash commands as .md files in .claude/commands/
// Each file's name becomes the command name, content is the prompt body
export function importFromClaudeCommands(
  files: Array<{ filename: string; content: string }>,
  changedBy?: string
): ImportResult {
  const items: ImportItem[] = files.map((f) => {
    const name = f.filename.replace(/\.md$/, "")
    const title = name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    return {
      title,
      slug: name,
      body: f.content.trim(),
      collection: "claude-commands",
      tags: ["claude", "slash-command"],
    }
  })
  return importFromJson(items, changedBy)
}
