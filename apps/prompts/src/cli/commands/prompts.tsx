import { Command } from "commander"
import chalk from "chalk"
import { getPrompt, listPrompts, listPromptsSlim, updatePrompt, deletePrompt, usePrompt, upsertPrompt, pinPrompt } from "../../db/prompts.js"
import { searchPrompts, searchPromptsSlim, findSimilar } from "../../lib/search.js"
import { renderTemplate, extractVariableInfo } from "../../lib/template.js"
import { isJson, output, handleError, fmtPrompt, fmtPromptDetail, fmtSearchResult, getActiveProjectId, parseOffset, parsePositiveInt, printPageSummary } from "../utils.js"
import type { Prompt, SlimPrompt } from "../../types/index.js"

export function registerPromptCommands(program: Command): void {

  // ── save ────────────────────────────────────────────────────────────────────
  program
    .command("save <title>")
    .description("Save a new prompt (or update existing by slug)")
    .option("-b, --body <body>", "Prompt body (use - to read from stdin)")
    .option("-f, --file <path>", "Read body from file")
    .option("-s, --slug <slug>", "Custom slug")
    .option("-d, --description <desc>", "Short description")
    .option("-c, --collection <name>", "Collection", "default")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .option("--source <source>", "Source: manual|ai-session|imported", "manual")
    .option("--agent <name>", "Agent name (for attribution)")
    .option("--force", "Save even if a similar prompt already exists")
    .option("--pin", "Pin immediately so it appears first in all lists")
    .action(async (title: string, opts: Record<string, string>) => {
      try {
        let body = opts["body"] ?? ""
        if (opts["file"]) {
          const { readFileSync } = await import("fs")
          body = readFileSync(opts["file"], "utf-8")
        } else if (opts["body"] === "-" || (!opts["body"] && !opts["file"])) {
          const chunks: Buffer[] = []
          for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
          body = Buffer.concat(chunks).toString("utf-8").trim()
        }
        if (!body) handleError(program, "No body provided. Use --body, --file, or pipe via stdin.")

        const project_id = getActiveProjectId(program)
        const { prompt, created, duplicate_warning } = upsertPrompt({
          title,
          body,
          slug: opts["slug"],
          description: opts["description"],
          collection: opts["collection"],
          tags: opts["tags"] ? opts["tags"].split(",").map((t) => t.trim()) : [],
          source: (opts["source"] as "manual" | "ai-session" | "imported") || "manual",
          changed_by: opts["agent"],
          project_id,
        }, Boolean(opts["force"]))
        if (duplicate_warning && !isJson(program)) {
          console.warn(chalk.yellow(`Warning: ${duplicate_warning}`))
        }
        if (opts["pin"]) pinPrompt(prompt.id, true)

        if (isJson(program)) {
          output(program, opts["pin"] ? { ...prompt, pinned: true } : prompt)
        } else {
          const action = created ? chalk.green("Created") : chalk.yellow("Updated")
          console.log(`${action} ${chalk.bold(prompt.id)} — ${chalk.green(prompt.slug)}`)
          console.log(chalk.gray(`  Title: ${prompt.title}`))
          console.log(chalk.gray(`  Collection: ${prompt.collection}`))
          if (opts["pin"]) console.log(chalk.yellow("  📌 Pinned"))
          if (prompt.is_template) {
            const vars = extractVariableInfo(prompt.body)
            console.log(chalk.cyan(`  Template vars: ${vars.map((v) => v.name).join(", ")}`))
          }
        }
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── use ─────────────────────────────────────────────────────────────────────
  program
    .command("use <id>")
    .description("Get a prompt's body and increment its use counter")
    .option("--edit", "Open in $EDITOR for quick tweaks before printing")
    .action(async (id: string, opts: { edit?: boolean }) => {
      try {
        const prompt = usePrompt(id)
        let body = prompt.body

        if (opts.edit) {
          const editor = process.env["EDITOR"] ?? process.env["VISUAL"] ?? "nano"
          const { writeFileSync, readFileSync, unlinkSync } = await import("fs")
          const { tmpdir } = await import("os")
          const { join } = await import("path")
          const tmp = join(tmpdir(), `prompts-${prompt.id}-${Date.now()}.md`)
          writeFileSync(tmp, body)
          const proc = Bun.spawnSync([editor, tmp], { stdio: ["inherit", "inherit", "inherit"] })
          if (proc.exitCode === 0) {
            body = readFileSync(tmp, "utf-8")
          }
          try { unlinkSync(tmp) } catch { /* ignore */ }
        }

        if (isJson(program)) {
          output(program, { ...prompt, body })
        } else {
          console.log(body)
          if (prompt.next_prompt) {
            console.error(chalk.gray(`\n→ next: ${chalk.bold(prompt.next_prompt)}`))
          }
        }
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── get ─────────────────────────────────────────────────────────────────────
  program
    .command("get <id>")
    .alias("show")
    .description("Get prompt details without incrementing use counter")
    .option("--verbose", "Show the full body in human output")
    .action((id: string, opts: { verbose?: boolean }) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        output(program, isJson(program) ? prompt : fmtPromptDetail(prompt!, { verbose: opts.verbose }))
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── list ────────────────────────────────────────────────────────────────────
  program
    .command("list")
    .description("List prompts")
    .option("-c, --collection <name>", "Filter by collection")
    .option("-t, --tags <tags>", "Filter by tags (comma-separated)")
    .option("--templates", "Show only templates")
    .option("--recent", "Sort by recently used")
    .option("-n, --limit <n>", "Max results (default: 20 human, 50 JSON)")
    .option("-o, --offset <n>", "Skip first N results", "0")
    .option("--cursor <n>", "Alias for --offset")
    .option("--verbose", "Show more metadata per prompt")
    .action((opts: Record<string, string | boolean>) => {
      try {
        const project_id = getActiveProjectId(program)
        const json = isJson(program)
        const limit = parsePositiveInt(opts["limit"], json ? 50 : 20)
        const offset = parseOffset(opts)
        const filter = {
          collection: opts["collection"] as string | undefined,
          tags: opts["tags"] ? (opts["tags"] as string).split(",").map((t) => t.trim()) : undefined,
          is_template: opts["templates"] ? true : undefined,
          limit: json ? limit : limit + 1,
          offset,
          ...(project_id !== null ? { project_id } : {}),
        }
        let prompts: Array<Prompt | SlimPrompt> = json ? listPrompts(filter) : listPromptsSlim(filter)
        if (opts["recent"]) {
          prompts = prompts
            .filter((p) => p.last_used_at !== null)
            .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""))
        }
        if (json) {
          output(program, prompts)
        } else if (prompts.length === 0) {
          console.log(chalk.gray("No prompts found."))
        } else {
          const shown = prompts.slice(0, limit)
          for (const p of shown) console.log(fmtPrompt(p, { verbose: Boolean(opts["verbose"]) }))
          printPageSummary({
            shown: shown.length,
            noun: "prompt",
            limit,
            offset,
            hasMore: prompts.length > limit,
            detailHint: "Use --verbose for more metadata, --json for raw records, or `prompts show <id>` / `prompts body <id>` for details.",
          })
        }
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── search ──────────────────────────────────────────────────────────────────
  program
    .command("search <query>")
    .description("Full-text search across prompts (FTS5)")
    .option("-c, --collection <name>")
    .option("-t, --tags <tags>")
    .option("-n, --limit <n>", "Max results (default: 10 human, 20 JSON)")
    .option("-o, --offset <n>", "Skip first N results", "0")
    .option("--cursor <n>", "Alias for --offset")
    .option("--verbose", "Show more metadata and longer snippets")
    .action((query: string, opts: Record<string, string>) => {
      try {
        const project_id = getActiveProjectId(program)
        const json = isJson(program)
        const limit = parsePositiveInt(opts["limit"], json ? 20 : 10)
        const offset = parseOffset(opts)
        const filter = {
          collection: opts["collection"],
          tags: opts["tags"] ? opts["tags"].split(",").map((t) => t.trim()) : undefined,
          limit: json ? limit : limit + 1,
          offset,
          ...(project_id !== null ? { project_id } : {}),
        }
        const results = json ? searchPrompts(query, filter) : searchPromptsSlim(query, filter)
        if (json) {
          output(program, results)
        } else if (results.length === 0) {
          console.log(chalk.gray("No results."))
        } else {
          const shown = results.slice(0, limit)
          for (const r of shown) console.log(fmtSearchResult(r, { verbose: Boolean(opts["verbose"]) }))
          printPageSummary({
            shown: shown.length,
            noun: "result",
            limit,
            offset,
            hasMore: results.length > limit,
            detailHint: "Use --verbose for longer snippets, --json for raw search records, or `prompts show <id>` / `prompts body <id>` for details.",
          })
        }
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── render ──────────────────────────────────────────────────────────────────
  program
    .command("render <id>")
    .description("Render a template prompt by filling in {{variables}}")
    .option("-v, --var <assignments...>", "Variable assignments as key=value")
    .action((id: string, opts: { var?: string[] }) => {
      try {
        const prompt = usePrompt(id)
        const vars: Record<string, string> = {}
        for (const assignment of opts.var ?? []) {
          const eq = assignment.indexOf("=")
          if (eq === -1) handleError(program, `Invalid var format: ${assignment}. Use key=value`)
          vars[assignment.slice(0, eq)] = assignment.slice(eq + 1)
        }
        const result = renderTemplate(prompt.body, vars)
        if (isJson(program)) {
          output(program, result)
        } else {
          console.log(result.rendered)
          if (result.missing_vars.length > 0)
            console.error(chalk.yellow(`\nWarning: missing vars: ${result.missing_vars.join(", ")}`))
          if (result.used_defaults.length > 0)
            console.error(chalk.gray(`Used defaults: ${result.used_defaults.join(", ")}`))
        }
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── templates ───────────────────────────────────────────────────────────────
  program
    .command("templates")
    .description("List template prompts")
    .option("-c, --collection <name>")
    .option("-n, --limit <n>", "Max results (default: 20 human, 50 JSON)")
    .option("-o, --offset <n>", "Skip first N results", "0")
    .option("--cursor <n>", "Alias for --offset")
    .option("--verbose", "Show more metadata per template")
    .action((opts: Record<string, string>) => {
      try {
        const project_id = getActiveProjectId(program)
        const json = isJson(program)
        const limit = parsePositiveInt(opts["limit"], json ? 50 : 20)
        const offset = parseOffset(opts)
        const filter = {
          is_template: true,
          collection: opts["collection"],
          limit: json ? limit : limit + 1,
          offset,
          ...(project_id !== null ? { project_id } : {}),
        }
        const prompts = json ? listPrompts(filter) : listPromptsSlim(filter)
        if (json) {
          output(program, prompts)
        } else if (prompts.length === 0) {
          console.log(chalk.gray("No templates found."))
        } else {
          const shown = prompts.slice(0, limit)
          for (const p of shown) {
            const vars = "body" in p ? extractVariableInfo(p.body).map((v) => (v.required ? v.name : `${v.name}?`)) : p.variable_names
            console.log(fmtPrompt(p))
            if (vars.length > 0 || opts["verbose"]) console.log(chalk.cyan(`  vars: ${vars.join(", ") || "(none)"}`))
          }
          printPageSummary({
            shown: shown.length,
            noun: "template",
            limit,
            offset,
            hasMore: prompts.length > limit,
            detailHint: "Use --verbose for more metadata, --json for raw records, or `prompts show <id>` / `prompts body <id>` for details.",
          })
        }
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── inspect ─────────────────────────────────────────────────────────────────
  program
    .command("inspect <id>")
    .description("Show a prompt's variables (for templates)")
    .action((id: string) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        const vars = extractVariableInfo(prompt!.body)
        if (isJson(program)) {
          output(program, vars)
        } else if (vars.length === 0) {
          console.log(chalk.gray("No template variables found."))
        } else {
          console.log(chalk.bold(`Variables for ${prompt!.slug}:`))
          for (const v of vars) {
            const req = v.required ? chalk.red("required") : chalk.green("optional")
            const def = v.default !== null ? chalk.gray(` (default: "${v.default}")`) : ""
            console.log(`  ${chalk.bold(v.name)}  ${req}${def}`)
          }
        }
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── update ──────────────────────────────────────────────────────────────────
  program
    .command("update <id>")
    .description("Update a prompt's fields")
    .option("--title <title>")
    .option("-b, --body <body>")
    .option("-d, --description <desc>")
    .option("-c, --collection <name>")
    .option("-t, --tags <tags>")
    .option("--agent <name>")
    .action((id: string, opts: Record<string, string>) => {
      try {
        const prompt = updatePrompt(id, {
          title: opts["title"] ?? undefined,
          body: opts["body"] ?? undefined,
          description: opts["description"] ?? undefined,
          collection: opts["collection"] ?? undefined,
          tags: opts["tags"] ? opts["tags"].split(",").map((t) => t.trim()) : undefined,
          changed_by: opts["agent"] ?? undefined,
        })
        if (isJson(program)) output(program, prompt)
        else console.log(`${chalk.yellow("Updated")} ${chalk.bold(prompt.id)} — ${chalk.green(prompt.slug)}`)
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── delete ──────────────────────────────────────────────────────────────────
  program
    .command("delete <id>")
    .description("Delete a prompt")
    .option("-y, --yes", "Skip confirmation")
    .action(async (id: string, opts: { yes?: boolean }) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        if (!opts.yes && !isJson(program)) {
          const { createInterface } = await import("readline")
          const rl = createInterface({ input: process.stdin, output: process.stdout })
          await new Promise<void>((resolve) => {
            rl.question(chalk.yellow(`Delete "${prompt!.slug}"? [y/N] `), (ans) => {
              rl.close()
              if (ans.toLowerCase() !== "y") {
                console.log("Cancelled.")
                process.exit(0)
              }
              resolve()
            })
          })
        }
        deletePrompt(id)
        if (isJson(program)) output(program, { deleted: true, id: prompt!.id })
        else console.log(chalk.red(`Deleted ${prompt!.slug}`))
      } catch (e) {
        handleError(program, e)
      }
    })

  // ── similar ─────────────────────────────────────────────────────────────────
  program
    .command("similar <id>")
    .description("Find prompts similar to a given prompt (by tag overlap and collection)")
    .option("-n, --limit <n>", "Max results", "5")
    .option("--verbose", "Show more metadata per prompt")
    .action((id: string, opts: Record<string, string>) => {
      try {
        const prompt = getPrompt(id)
        if (!prompt) handleError(program, `Prompt not found: ${id}`)
        const results = findSimilar(prompt!.id, parseInt(opts["limit"] ?? "5") || 5)
        if (isJson(program)) { output(program, results); return }
        if (results.length === 0) { console.log(chalk.gray("No similar prompts found.")); return }
        for (const r of results) {
          const score = chalk.gray(`${Math.round(r.score * 100)}%`)
          console.log(`${fmtPrompt(r.prompt, { verbose: Boolean(opts["verbose"]) })}  ${score}`)
        }
      } catch (e) { handleError(program, e) }
    })
}
