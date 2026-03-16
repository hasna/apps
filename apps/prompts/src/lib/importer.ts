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
  const tags = prompt.tags.length > 0 ? `[${prompt.tags.join(", ")}]` : "[]"
  const desc = prompt.description ? `\ndescription: ${prompt.description}` : ""
  return `---
title: ${prompt.title}
slug: ${prompt.slug}
collection: ${prompt.collection}
tags: ${tags}${desc}
---

${prompt.body}
`
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
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n+([\s\S]*)$/)
  if (!frontmatterMatch) {
    // No frontmatter — treat entire content as body, filename as title
    if (!filename) return null
    const title = filename.replace(/\.md$/, "").replace(/-/g, " ")
    return { title, body: content.trim() }
  }

  const frontmatter = frontmatterMatch[1] ?? ""
  const body = (frontmatterMatch[2] ?? "").trim()

  const get = (key: string): string | null => {
    const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
    return m ? (m[1] ?? "").trim() : null
  }

  const title = get("title") ?? (filename?.replace(/\.md$/, "").replace(/-/g, " ") ?? "Untitled")
  const slug = get("slug") ?? undefined
  const collection = get("collection") ?? undefined
  const description = get("description") ?? undefined

  const tagsStr = get("tags")
  let tags: string[] | undefined
  if (tagsStr) {
    const inner = tagsStr.replace(/^\[/, "").replace(/\]$/, "")
    tags = inner.split(",").map((t) => t.trim()).filter(Boolean)
  }

  return { title, slug, body, collection, tags, description }
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
