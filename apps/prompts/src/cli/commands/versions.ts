import { Command } from "commander"
import chalk from "chalk"
import { getPrompt } from "../../db/prompts.js"
import { listVersions, restoreVersion } from "../../db/versions.js"
import { diffTexts } from "../../lib/diff.js"
import { isJson, output, handleError } from "../utils.js"

export function registerVersionCommands(program: Command): void {

  // ── history ─────────────────────────────────────────────────────────────────
  program
    .command("history <id>")
    .description("Show version history for a prompt")
    .action((id: string) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        const versions = listVersions(prompt!.id)
        if (isJson(program)) {
          output(program, versions)
        } else {
          console.log(chalk.bold(`Version history for ${prompt!.slug}:`))
          for (const v of versions) {
            const current = v.version === prompt!.version ? chalk.green(" ← current") : ""
            const by = v.changed_by ? chalk.gray(` by ${v.changed_by}`) : ""
            console.log(`  v${v.version}  ${chalk.gray(v.created_at)}${by}${current}`)
          }
        }
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── restore ─────────────────────────────────────────────────────────────────
  program
    .command("restore <id> <version>")
    .description("Restore a prompt to a previous version")
    .option("--agent <name>")
    .action((id: string, version: string, opts: Record<string, string>) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        restoreVersion(prompt!.id, parseInt(version), opts["agent"])
        if (isJson(program)) output(program, { restored: true, id: prompt!.id, version: parseInt(version) })
        else console.log(chalk.green(`Restored ${prompt!.slug} to v${version}`))
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── diff ────────────────────────────────────────────────────────────────────
  program
    .command("diff <id> <v1> [v2]")
    .description("Show diff between two versions of a prompt (v2 defaults to current)")
    .action((id: string, v1: string, v2: string | undefined) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        const versions = listVersions(prompt!.id)
        const versionA = versions.find((v) => v.version === parseInt(v1))
        if (!versionA) handleError(program, `Version ${v1} not found`)
        const bodyB = v2 ? (versions.find((v) => v.version === parseInt(v2))?.body ?? null) : prompt!.body
        if (bodyB === null) handleError(program, `Version ${v2} not found`)
        const lines = diffTexts(versionA!.body, bodyB!)
        if (isJson(program)) { output(program, lines); return }
        const label2 = v2 ? `v${v2}` : "current"
        console.log(chalk.bold(`${prompt!.slug}: v${v1} → ${label2}`))
        for (const l of lines) {
          if (l.type === "added") console.log(chalk.green(`+ ${l.content}`))
          else if (l.type === "removed") console.log(chalk.red(`- ${l.content}`))
          else console.log(chalk.gray(`  ${l.content}`))
        }
      } catch (e) { handleError(program, e) }
    })
}
