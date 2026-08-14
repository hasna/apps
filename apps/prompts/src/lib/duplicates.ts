import { listPrompts } from "../db/prompts.js"
import type { Prompt } from "../types/index.js"

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  )
}

function similarity(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  for (const word of ta) {
    if (tb.has(word)) shared++
  }
  return shared / Math.max(ta.size, tb.size)
}

export interface DuplicateMatch {
  prompt: Prompt
  score: number
}

export function findDuplicates(body: string, threshold = 0.8, excludeSlug?: string): DuplicateMatch[] {
  const all = listPrompts({ limit: 10000 })
  const matches: DuplicateMatch[] = []

  for (const p of all) {
    if (excludeSlug && p.slug === excludeSlug) continue
    const score = similarity(body, p.body)
    if (score >= threshold) {
      matches.push({ prompt: p, score })
    }
  }

  return matches.sort((a, b) => b.score - a.score)
}
