import { Command } from "commander"
import chalk from "chalk"
import { resolveProject, getDatabase } from "../db/database.js"
import { promptVariableNames, truncateText } from "../lib/compact.js"
import type { Prompt, SearchResult, SlimPrompt, SlimSearchResult } from "../types/index.js"

type PromptDisplay = Pick<Prompt | SlimPrompt | SlimSearchResult, "id" | "slug" | "title" | "description" | "collection" | "tags" | "is_template" | "use_count"> &
  Partial<Pick<Prompt | SlimPrompt, "pinned" | "updated_at">> & {
    variable_names?: string[]
    variables?: Array<{ name: string }>
  }

export function isJson(program: Command): boolean {
  return Boolean(program.opts()["json"])
}

export function getActiveProjectId(program: Command): string | null {
  const projectName = (program.opts()["project"] as string | undefined) ?? process.env["PROMPTS_PROJECT"]
  if (!projectName) return null
  const db = getDatabase()
  return resolveProject(db, projectName)
}

export async function writeToClipboard(text: string): Promise<void> {
  const run = async (cmd: string[]): Promise<void> => {
    const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "ignore", stderr: "ignore" })
    proc.stdin.write(text)
    proc.stdin.end()
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      throw new Error(`Clipboard command failed: ${cmd[0]}`)
    }
  }

  if (process.platform === "darwin") {
    await run(["pbcopy"])
    return
  }

  if (process.platform === "linux") {
    const candidates: string[][] = [
      ["xclip", "-selection", "clipboard"],
      ["xsel", "--clipboard", "--input"],
    ]

    const available = candidates.filter((cmd) => {
      const tool = cmd[0]
      if (!tool) return false
      if (typeof Bun.which !== "function") return true
      return Boolean(Bun.which(tool))
    })

    if (available.length === 0) {
      throw new Error("No clipboard tool found. Install xclip or xsel, or use `prompts use` / `prompts share` without clipboard.")
    }

    for (const cmd of available) {
      try {
        await run(cmd)
        return
      } catch {
        // Try next available clipboard command.
      }
    }

    throw new Error("Failed to copy to clipboard using available tools. Use `prompts use` or `prompts share` without clipboard.")
  }

  throw new Error("Clipboard is not supported on this platform. Use `prompts use` or `prompts share` without clipboard.")
}

export function output(program: Command, data: unknown): void {
  if (isJson(program)) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    console.log(data)
  }
}

export function handleError(program: Command, e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e)
  if (isJson(program)) {
    console.log(JSON.stringify({ error: msg }))
  } else {
    console.error(chalk.red("Error: " + msg))
  }
  process.exit(1)
}

export function parsePositiveInt(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== "string") return fallback
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function parseOffset(opts: Record<string, string | boolean | undefined>): number {
  const value = opts["cursor"] ?? opts["offset"]
  return parsePositiveInt(value, 0)
}

export function compactTags(tags: string[], maxTags = 3): string {
  if (tags.length === 0) return ""
  if (tags.length <= maxTags) return tags.join(", ")
  return `${tags.slice(0, maxTags).join(", ")} +${tags.length - maxTags}`
}

export function fmtPrompt(p: PromptDisplay, opts: { verbose?: boolean; titleWidth?: number; tagLimit?: number } = {}): string {
  const titleWidth = opts.titleWidth ?? (opts.verbose ? 120 : 72)
  const tagLimit = opts.tagLimit ?? (opts.verbose ? p.tags.length : 3)
  const tags = p.tags.length > 0 ? chalk.gray(` [${compactTags(p.tags, tagLimit)}]`) : ""
  const template = p.is_template ? chalk.cyan(" ◇") : ""
  const pin = p.pinned ? chalk.yellow(" *") : ""
  const vars = p.is_template ? chalk.cyan(` vars:${compactTags(promptVariableNames(p), opts.verbose ? 8 : 3)}`) : ""
  const usage = opts.verbose ? chalk.gray(` uses:${p.use_count}`) : ""
  const updated = opts.verbose && p.updated_at ? chalk.gray(` updated:${p.updated_at}`) : ""
  const description = opts.verbose && p.description ? `\n    ${chalk.gray(truncateText(p.description, 140))}` : ""
  return `${chalk.bold(p.id)} ${chalk.green(p.slug)}${template}${pin}  ${truncateText(p.title, titleWidth)}${tags}  ${chalk.gray(p.collection)}${vars}${usage}${updated}${description}`
}

export function fmtPromptDetail(p: Prompt, opts: { verbose?: boolean } = {}): string {
  const vars = promptVariableNames(p)
  const lines = [
    `${chalk.bold(p.id)} ${chalk.green(p.slug)}${p.pinned ? chalk.yellow(" *") : ""}`,
    `  Title:       ${p.title}`,
    `  Collection:  ${p.collection}`,
    `  Tags:        ${p.tags.length > 0 ? p.tags.join(", ") : "(none)"}`,
    `  Template:    ${p.is_template ? `yes (${vars.join(", ")})` : "no"}`,
    `  Source:      ${p.source}`,
    `  Version:     ${p.version}`,
    `  Uses:        ${p.use_count}`,
    `  Created:     ${p.created_at}`,
    `  Updated:     ${p.updated_at}`,
  ]
  if (p.description) lines.push(`  Description: ${p.description}`)
  lines.push(`  Body chars:  ${p.body.length}`)
  if (opts.verbose) {
    lines.push("", p.body)
  } else {
    lines.push(`  Body:        ${truncateText(p.body, 160)}`)
    lines.push(chalk.gray("  Use --verbose for the full body, `prompts body <id>` for body only, or --json for raw data."))
  }
  return lines.join("\n")
}

export function fmtSearchResult(result: SearchResult | SlimSearchResult, opts: { verbose?: boolean } = {}): string {
  const prompt = "prompt" in result ? result.prompt : result
  const lines = [fmtPrompt(prompt, opts)]
  if (result.snippet) {
    const highlighted = result.snippet.replace(/\[([^\]]+)\]/g, (_m: string, word: string) => chalk.yellowBright(word))
    lines.push(chalk.gray("  ") + chalk.gray(truncateText(highlighted, opts.verbose ? 220 : 120)))
  }
  if (opts.verbose) lines.push(chalk.gray(`  score:${result.score}`))
  return lines.join("\n")
}

export function printPageSummary(opts: {
  shown: number
  total?: number
  noun: string
  limit: number
  offset: number
  hasMore?: boolean
  detailHint?: string
}): void {
  const total = opts.total !== undefined ? ` of ${opts.total}` : ""
  const next = opts.hasMore ? ` Next: --offset ${opts.offset + opts.shown}` : ""
  console.log(chalk.gray(`\nShowing ${opts.shown}${total} ${opts.noun}(s).${next}`))
  if (opts.detailHint) console.log(chalk.gray(opts.detailHint))
}
