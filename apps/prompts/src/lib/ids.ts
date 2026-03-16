import { getDatabase } from "../db/database.js"

export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 80)
}

export function uniqueSlug(baseSlug: string): string {
  const db = getDatabase()
  let slug = baseSlug
  let i = 2
  while (db.query("SELECT 1 FROM prompts WHERE slug = ?").get(slug)) {
    slug = `${baseSlug}-${i}`
    i++
  }
  return slug
}

export function generatePromptId(): string {
  const db = getDatabase()
  const row = db
    .query("SELECT id FROM prompts ORDER BY rowid DESC LIMIT 1")
    .get() as { id: string } | null

  let next = 1
  if (row) {
    const match = row.id.match(/PRMT-(\d+)/)
    if (match && match[1]) {
      next = parseInt(match[1], 10) + 1
    }
  }

  return `PRMT-${String(next).padStart(5, "0")}`
}

export function generateId(prefix: string): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = prefix + "-"
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}
