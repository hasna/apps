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

const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789"

function nanoid(len: number): string {
  let id = ""
  for (let i = 0; i < len; i++) {
    id += CHARS[Math.floor(Math.random() * CHARS.length)]
  }
  return id
}

export function generatePromptId(): string {
  const db = getDatabase()
  let id: string
  do {
    id = `prmt-${nanoid(8)}`
  } while (db.query("SELECT 1 FROM prompts WHERE id = ?").get(id))
  return id
}

export function generateId(prefix: string): string {
  return `${prefix}-${nanoid(8)}`
}
