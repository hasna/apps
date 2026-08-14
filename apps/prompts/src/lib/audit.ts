import { getDatabase } from "../db/database.js"

export interface AuditIssue {
  type: "orphaned-project" | "empty-collection" | "missing-version-history" | "near-duplicate-slug" | "expired"
  severity: "error" | "warn" | "info"
  prompt_id?: string
  slug?: string
  message: string
}

export interface AuditReport {
  issues: AuditIssue[]
  errors: number
  warnings: number
  info: number
  checked_at: string
}

export function runAudit(): AuditReport {
  const db = getDatabase()
  const issues: AuditIssue[] = []

  // 1. Orphaned project_ids (project deleted but prompt still references it)
  const orphaned = db.query(`
    SELECT p.id, p.slug FROM prompts p
    WHERE p.project_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM projects pr WHERE pr.id = p.project_id)
  `).all() as Array<{ id: string; slug: string }>
  for (const p of orphaned) {
    issues.push({
      type: "orphaned-project",
      severity: "error",
      prompt_id: p.id,
      slug: p.slug,
      message: `Prompt "${p.slug}" references a deleted project`,
    })
  }

  // 2. Empty collections (no prompts)
  const emptyCollections = db.query(`
    SELECT c.name FROM collections c
    WHERE NOT EXISTS (SELECT 1 FROM prompts p WHERE p.collection = c.name)
    AND c.name != 'default'
  `).all() as Array<{ name: string }>
  for (const c of emptyCollections) {
    issues.push({
      type: "empty-collection",
      severity: "info",
      message: `Collection "${c.name}" has no prompts`,
    })
  }

  // 3. Prompts missing version history
  const missingHistory = db.query(`
    SELECT p.id, p.slug FROM prompts p
    WHERE NOT EXISTS (SELECT 1 FROM prompt_versions v WHERE v.prompt_id = p.id)
  `).all() as Array<{ id: string; slug: string }>
  for (const p of missingHistory) {
    issues.push({
      type: "missing-version-history",
      severity: "warn",
      prompt_id: p.id,
      slug: p.slug,
      message: `Prompt "${p.slug}" has no version history entries`,
    })
  }

  // 4. Near-duplicate slugs (edit distance = 1 — prefix matches)
  const slugs = (db.query("SELECT id, slug FROM prompts").all() as Array<{ id: string; slug: string }>)
  const seen = new Map<string, string>()
  for (const { id, slug } of slugs) {
    // Check if slug minus trailing -2, -3 etc matches another slug
    const base = slug.replace(/-\d+$/, "")
    if (seen.has(base) && seen.get(base) !== id) {
      issues.push({
        type: "near-duplicate-slug",
        severity: "info",
        slug,
        message: `"${slug}" looks like a duplicate of "${base}" — consider merging`,
      })
    } else {
      seen.set(base, id)
    }
  }

  // 5. Expired prompts still active
  const now = new Date().toISOString()
  const expired = db.query(`
    SELECT id, slug FROM prompts WHERE expires_at IS NOT NULL AND expires_at < ?
  `).all(now) as Array<{ id: string; slug: string }>
  for (const p of expired) {
    issues.push({
      type: "expired",
      severity: "warn",
      prompt_id: p.id,
      slug: p.slug,
      message: `Prompt "${p.slug}" has expired`,
    })
  }

  const errors = issues.filter((i) => i.severity === "error").length
  const warnings = issues.filter((i) => i.severity === "warn").length
  const info = issues.filter((i) => i.severity === "info").length

  return { issues, errors, warnings, info, checked_at: new Date().toISOString() }
}
