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

export function fmtPrompt(p: Prompt): string {
  const tags = p.tags.length > 0 ? chalk.gray(` [${p.tags.join(", ")}]`) : ""
  const template = p.is_template ? chalk.cyan(" ◇") : ""
  const pin = p.pinned ? chalk.yellow(" 📌") : ""
  return `${chalk.bold(p.id)} ${chalk.green(p.slug)}${template}${pin}  ${p.title}${tags}  ${chalk.gray(p.collection)}`
}
