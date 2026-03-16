import type { Prompt } from "../types/index.js"

export type LintSeverity = "error" | "warn" | "info"

export interface LintIssue {
  prompt_id: string
  slug: string
  severity: LintSeverity
  rule: string
  message: string
}

export interface LintResult {
  prompt: Prompt
  issues: LintIssue[]
}

export function lintPrompt(p: Prompt): LintIssue[] {
  const issues: LintIssue[] = []

  const issue = (severity: LintSeverity, rule: string, message: string): LintIssue => ({
    prompt_id: p.id,
    slug: p.slug,
    severity,
    rule,
    message,
  })

  if (!p.description) {
    issues.push(issue("warn", "missing-description", "No description provided"))
  }

  if (p.body.trim().length < 10) {
    issues.push(issue("error", "body-too-short", `Body is only ${p.body.trim().length} characters`))
  }

  if (p.tags.length === 0) {
    issues.push(issue("info", "no-tags", "No tags — prompt will be harder to discover"))
  }

  if (p.is_template) {
    const undocumented = p.variables.filter(
      (v) => !v.description || v.description.trim() === ""
    )
    if (undocumented.length > 0) {
      issues.push(
        issue(
          "warn",
          "undocumented-vars",
          `Template variables without description: ${undocumented.map((v) => v.name).join(", ")}`
        )
      )
    }
  }

  if (p.collection === "default" && p.use_count === 0) {
    issues.push(issue("info", "uncollected", "In default collection and never used — consider organizing"))
  }

  return issues
}

export function lintAll(prompts: Prompt[]): LintResult[] {
  return prompts
    .map((p) => ({ prompt: p, issues: lintPrompt(p) }))
    .filter((r) => r.issues.length > 0)
}
