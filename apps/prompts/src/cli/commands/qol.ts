import { Command } from "commander"
import chalk from "chalk"
import { getPrompt, updatePrompt } from "../../db/prompts.js"
import { movePrompt } from "../../db/collections.js"
import { extractVariableInfo, validateVars } from "../../lib/template.js"
import { lintPrompt } from "../../lib/lint.js"
import { isJson, output, handleError } from "../utils.js"

export function registerQolCommands(program: Command): void {

  // ── body ────────────────────────────────────────────────────────────────────
  program
    .command("body <id>")
    .description("Print prompt body without incrementing use counter (pipe-friendly)")
    .action((id: string) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        if (isJson(program)) output(program, { id: prompt!.id, slug: prompt!.slug, body: prompt!.body })
        else process.stdout.write(prompt!.body)
      } catch (e) { handleError(program, e) }
    })

  // ── edit ─────────────────────────────────────────────────────────────────────
  program
    .command("edit <id>")
    .description("Open a prompt in $EDITOR for full editing (title, body, description, tags, collection)")
    .option("--agent <name>", "Attribution")
    .action(async (id: string, opts: { agent?: string }) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        const p = prompt!

        const { writeFileSync, readFileSync, unlinkSync } = await import("fs")
        const { tmpdir } = await import("os")
        const { join } = await import("path")

        const frontmatter = [
          `---`,
          `title: ${p.title}`,
          `description: ${p.description ?? ""}`,
          `collection: ${p.collection}`,
          `tags: ${p.tags.join(", ")}`,
          `---`,
          ``,
          p.body,
        ].join("\n")

        const tmpFile = join(tmpdir(), `prompt-${p.id}.md`)
        writeFileSync(tmpFile, frontmatter)

        const editor = process.env["EDITOR"] ?? process.env["VISUAL"] ?? "vi"
        const proc = Bun.spawn([editor, tmpFile], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
        await proc.exited

        const edited = readFileSync(tmpFile, "utf-8")
        unlinkSync(tmpFile)

        // Parse frontmatter
        const fmMatch = edited.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/m)
        if (!fmMatch) {
          // No frontmatter — treat whole file as body
          updatePrompt(p.id, { body: edited.trim(), changed_by: opts.agent })
          if (!isJson(program)) console.log(chalk.green(`Updated ${chalk.bold(p.slug)} (body only)`))
          return
        }

        const fmLines = (fmMatch[1] ?? "").split("\n")
        const body = (fmMatch[2] ?? "").trimStart()

        const parsed: Record<string, string> = {}
        for (const line of fmLines) {
          const colon = line.indexOf(":")
          if (colon === -1) continue
          parsed[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
        }

        updatePrompt(p.id, {
          title: parsed["title"] ?? p.title,
          body: body || p.body,
          description: parsed["description"] || (p.description != null ? p.description : undefined),
          collection: parsed["collection"] ?? p.collection,
          tags: parsed["tags"] ? parsed["tags"].split(",").map((t) => t.trim()).filter(Boolean) : p.tags,
          changed_by: opts.agent,
        })

        if (isJson(program)) output(program, getPrompt(p.id))
        else console.log(chalk.green(`Updated ${chalk.bold(p.slug)}`))
      } catch (e) { handleError(program, e) }
    })

  // ── tag ──────────────────────────────────────────────────────────────────────
  program
    .command("tag <id>")
    .description("Patch tags on a prompt. Use --add/--remove, or --set to replace all.")
    .option("-a, --add <tags>", "Comma-separated tags to add")
    .option("-r, --remove <tags>", "Comma-separated tags to remove")
    .option("--set <tags>", "Replace all tags (comma-separated)")
    .action((id: string, opts: { add?: string; remove?: string; set?: string }) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        const p = prompt!

        let tags: string[]
        if (opts.set !== undefined) {
          tags = opts.set.split(",").map((t) => t.trim()).filter(Boolean)
        } else {
          tags = [...p.tags]
          if (opts.add) {
            for (const t of opts.add.split(",").map((x) => x.trim()).filter(Boolean)) {
              if (!tags.includes(t)) tags.push(t)
            }
          }
          if (opts.remove) {
            const toRemove = opts.remove.split(",").map((x) => x.trim())
            tags = tags.filter((t) => !toRemove.includes(t))
          }
        }

        updatePrompt(p.id, { tags })
        if (isJson(program)) output(program, { id: p.id, slug: p.slug, tags })
        else console.log(`${chalk.bold(p.slug)}  tags: ${tags.length > 0 ? chalk.cyan(tags.join(", ")) : chalk.gray("(none)")}`)
      } catch (e) { handleError(program, e) }
    })

  // ── share ────────────────────────────────────────────────────────────────────
  program
    .command("share <id>")
    .description("Export a single prompt as a clean markdown snippet")
    .option("--clipboard", "Copy to clipboard instead of printing")
    .action(async (id: string, opts: { clipboard?: boolean }) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        const p = prompt!

        const lines: string[] = [
          `# ${p.title}`,
          ``,
        ]
        if (p.description) lines.push(`> ${p.description}`, ``)
        if (p.tags.length > 0) lines.push(`**Tags:** ${p.tags.join(", ")}`, ``)
        if (p.collection !== "default") lines.push(`**Collection:** ${p.collection}`, ``)
        lines.push("```", p.body, "```")

        const markdown = lines.join("\n")

        if (opts.clipboard) {
          const { platform } = process
          if (platform === "darwin") {
            const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" })
            proc.stdin.write(markdown)
            proc.stdin.end()
            await proc.exited
          } else if (platform === "linux") {
            try {
              const proc = Bun.spawn(["xclip", "-selection", "clipboard"], { stdin: "pipe" })
              proc.stdin.write(markdown)
              proc.stdin.end()
              await proc.exited
            } catch {
              const proc = Bun.spawn(["xsel", "--clipboard", "--input"], { stdin: "pipe" })
              proc.stdin.write(markdown)
              proc.stdin.end()
              await proc.exited
            }
          } else {
            handleError(program, "Clipboard not supported on this platform.")
          }
          console.log(chalk.green(`Copied ${chalk.bold(p.slug)} to clipboard`))
        } else {
          if (isJson(program)) output(program, { id: p.id, slug: p.slug, markdown })
          else console.log(markdown)
        }
      } catch (e) { handleError(program, e) }
    })

  // ── validate ─────────────────────────────────────────────────────────────────
  program
    .command("validate <id>")
    .description("Run lint checks and validate template variables for a single prompt")
    .option("--var <kv>", "Simulate render with key=value (repeatable)", (val: string, acc: string[]) => { acc.push(val); return acc }, [] as string[])
    .option("--vars <json>", "Simulate render with JSON vars")
    .action((id: string, opts: { var: string[]; vars?: string }) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        const p = prompt!

        const lintIssues = lintPrompt(p)
        let exitCode = 0

        if (isJson(program)) {
          const result: Record<string, unknown> = { id: p.id, slug: p.slug, lint: lintIssues }

          if (p.is_template) {
            const vars: Record<string, string> = {}
            if (opts.vars) Object.assign(vars, JSON.parse(opts.vars) as Record<string, string>)
            for (const kv of opts.var) {
              const eq = kv.indexOf("=")
              if (eq !== -1) vars[kv.slice(0, eq)] = kv.slice(eq + 1)
            }
            result["vars"] = validateVars(p.body, vars)
          }
          output(program, result)
          return
        }

        console.log(chalk.bold(`Validating ${chalk.green(p.slug)}:`))

        if (lintIssues.length === 0) {
          console.log(chalk.green("  ✓ Lint: no issues"))
        } else {
          for (const issue of lintIssues) {
            if (issue.severity === "error") { console.log(chalk.red(`  ✗ [${issue.rule}] ${issue.message}`)); exitCode = 1 }
            else if (issue.severity === "warn") { console.log(chalk.yellow(`  ⚠ [${issue.rule}] ${issue.message}`)) }
            else { console.log(chalk.gray(`  ℹ [${issue.rule}] ${issue.message}`)) }
          }
        }

        if (p.is_template) {
          const vars: Record<string, string> = {}
          if (opts.vars) Object.assign(vars, JSON.parse(opts.vars) as Record<string, string>)
          for (const kv of opts.var) {
            const eq = kv.indexOf("=")
            if (eq !== -1) vars[kv.slice(0, eq)] = kv.slice(eq + 1)
          }
          const varInfo = extractVariableInfo(p.body)
          const { missing, extra, optional } = validateVars(p.body, vars)
          console.log(chalk.bold("\n  Template variables:"))
          for (const v of varInfo) {
            const provided = v.name in vars
            const sym = provided ? chalk.green("✓") : v.required ? chalk.red("✗") : chalk.yellow("○")
            const val = provided ? chalk.gray(` = "${vars[v.name]}"`) : v.default ? chalk.gray(` (default: "${v.default}")`) : ""
            console.log(`    ${sym} ${v.name}${val}`)
          }
          if (missing.length > 0) { console.log(chalk.red(`\n  Missing required vars: ${missing.join(", ")}`)); exitCode = 1 }
          if (extra.length > 0) console.log(chalk.yellow(`  Extra vars (not in template): ${extra.join(", ")}`))
          if (optional.length > 0 && Object.keys(vars).length === 0) console.log(chalk.gray(`  Optional vars: ${optional.join(", ")}`))
        }

        if (exitCode === 0) console.log(chalk.green("\n  ✓ All checks passed"))
        else process.exit(exitCode)
      } catch (e) { handleError(program, e) }
    })

  // ── bulk-move ────────────────────────────────────────────────────────────────
  program
    .command("bulk-move <collection> [ids...]")
    .description("Move multiple prompts to a collection. Pass IDs as args or pipe one per line via stdin.")
    .option("-y, --yes", "Skip confirmation")
    .action(async (collection: string, ids: string[], opts: { yes?: boolean }) => {
      try {
        let allIds = [...ids]
        if (process.stdin.isTTY === false && allIds.length === 0) {
          const chunks: Buffer[] = []
          for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
          allIds = Buffer.concat(chunks).toString("utf-8").split("\n").map((s) => s.trim()).filter(Boolean)
        }
        if (allIds.length === 0) handleError(program, "No IDs provided.")

        if (!opts.yes && !isJson(program)) {
          const { createInterface } = await import("readline")
          const rl = createInterface({ input: process.stdin, output: process.stdout })
          await new Promise<void>((resolve) => {
            rl.question(chalk.yellow(`Move ${allIds.length} prompt(s) to "${collection}"? [y/N] `), (ans) => {
              rl.close()
              if (ans.toLowerCase() !== "y") { console.log("Cancelled."); process.exit(0) }
              resolve()
            })
          })
        }

        const results: Array<{ id: string; slug: string; ok: boolean; error?: string }> = []
        for (const id of allIds) {
          try {
            movePrompt(id, collection)
            const p = getPrompt(id)
            results.push({ id, slug: p?.slug ?? id, ok: true })
          } catch (e) {
            results.push({ id, slug: id, ok: false, error: e instanceof Error ? e.message : String(e) })
          }
        }

        if (isJson(program)) { output(program, results); return }
        const ok = results.filter((r) => r.ok)
        const fail = results.filter((r) => !r.ok)
        if (ok.length > 0) console.log(chalk.green(`Moved ${ok.length} prompt(s) → ${chalk.bold(collection)}`))
        for (const f of fail) console.error(chalk.red(`  ✗ ${f.id}: ${f.error}`))
      } catch (e) { handleError(program, e) }
    })

  // ── bulk-tag ─────────────────────────────────────────────────────────────────
  program
    .command("bulk-tag [args...]")
    .description("Patch tags on multiple prompts. Args starting with +/- are tag ops; rest are IDs. Pipe IDs via stdin too.")
    .addHelpText("after", `
Examples:
  prompts bulk-tag +foo -bar PRMT-00001 PRMT-00002
  echo "PRMT-00001" | prompts bulk-tag +reviewed`)
    .action(async (args: string[]) => {
      try {
        const ops: string[] = []
        const ids: string[] = []
        for (const a of args) {
          if (a.startsWith("+") || a.startsWith("-")) ops.push(a)
          else ids.push(a)
        }

        let allIds = [...ids]
        if (process.stdin.isTTY === false && allIds.length === 0) {
          const chunks: Buffer[] = []
          for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
          allIds = Buffer.concat(chunks).toString("utf-8").split("\n").map((s) => s.trim()).filter(Boolean)
        }

        if (allIds.length === 0) handleError(program, "No IDs provided.")
        if (ops.length === 0) handleError(program, "No tag ops provided. Use +tag to add, -tag to remove.")

        const results: Array<{ id: string; slug: string; tags: string[] }> = []
        for (const id of allIds) {
          const prompt = getPrompt(id)
          if (!prompt) { console.error(chalk.red(`  ✗ Not found: ${id}`)); continue }
          let tags = [...prompt.tags]
          for (const op of ops) {
            if (op.startsWith("+")) { const t = op.slice(1); if (!tags.includes(t)) tags.push(t) }
            else if (op.startsWith("-")) { const t = op.slice(1); tags = tags.filter((x) => x !== t) }
          }
          updatePrompt(prompt.id, { tags })
          results.push({ id: prompt.id, slug: prompt.slug, tags })
        }

        if (isJson(program)) { output(program, results); return }
        console.log(chalk.green(`Updated ${results.length} prompt(s)`))
        for (const r of results) console.log(`  ${chalk.bold(r.slug)}  ${chalk.cyan(r.tags.join(", ") || "(no tags)")}`)
      } catch (e) { handleError(program, e) }
    })

  // ── bulk-delete ───────────────────────────────────────────────────────────────
  program
    .command("bulk-delete [ids...]")
    .alias("bulk-rm")
    .description("Delete multiple prompts. Pass IDs as args or pipe one per line via stdin.")
    .option("-y, --yes", "Skip confirmation")
    .action(async (ids: string[], opts: { yes?: boolean }) => {
      try {
        const { deletePrompt } = await import("../../db/prompts.js")

        let allIds = [...ids]
        if (process.stdin.isTTY === false && allIds.length === 0) {
          const chunks: Buffer[] = []
          for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
          allIds = Buffer.concat(chunks).toString("utf-8").split("\n").map((s) => s.trim()).filter(Boolean)
        }
        if (allIds.length === 0) handleError(program, "No IDs provided.")

        if (!opts.yes && !isJson(program)) {
          const { createInterface } = await import("readline")
          const rl = createInterface({ input: process.stdin, output: process.stdout })
          await new Promise<void>((resolve) => {
            rl.question(chalk.red(`Delete ${allIds.length} prompt(s)? This cannot be undone. [y/N] `), (ans) => {
              rl.close()
              if (ans.toLowerCase() !== "y") { console.log("Cancelled."); process.exit(0) }
              resolve()
            })
          })
        }

        let deleted = 0
        const errors: string[] = []
        for (const id of allIds) {
          try { deletePrompt(id); deleted++ }
          catch (e) { errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`) }
        }

        if (isJson(program)) { output(program, { deleted, errors }); return }
        console.log(chalk.red(`Deleted ${deleted} prompt(s)`))
        for (const e of errors) console.error(chalk.red(`  ✗ ${e}`))
      } catch (e) { handleError(program, e) }
    })
}
