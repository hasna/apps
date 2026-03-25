import { Command } from "commander"
import chalk from "chalk"
import { resolveProject, getDatabase } from "../db/database.js"
import type { Prompt } from "../types/index.js"

export function isJson(program: Command): boolean {
  return Boolean(program.opts()["json"])
}

export function getActiveProjectId(program: Command): string | null {
  const projectName = (program.opts()["project"] as string | undefined) ?? process.env["PROMPTS_PROJECT"]
  if (!projectName) return null
  const db = getDatabase()
  return resolveProject(db, projectName)
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

export function fmtPrompt(p: Prompt): string {
  const tags = p.tags.length > 0 ? chalk.gray(` [${p.tags.join(", ")}]`) : ""
  const template = p.is_template ? chalk.cyan(" ◇") : ""
  const pin = p.pinned ? chalk.yellow(" 📌") : ""
  return `${chalk.bold(p.id)} ${chalk.green(p.slug)}${template}${pin}  ${p.title}${tags}  ${chalk.gray(p.collection)}`
}
