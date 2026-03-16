#!/usr/bin/env bun
import { Command } from "commander"
import chalk from "chalk"
import { createRequire } from "module"
import { getPrompt, listPrompts, updatePrompt, deletePrompt, usePrompt, upsertPrompt, getPromptStats, pinPrompt } from "../db/prompts.js"
import { listVersions, restoreVersion } from "../db/versions.js"
import { listCollections, movePrompt } from "../db/collections.js"
import { createProject, getProject, listProjects, deleteProject } from "../db/projects.js"
import { resolveProject, getDatabase } from "../db/database.js"
import { searchPrompts } from "../lib/search.js"
import { renderTemplate, extractVariableInfo } from "../lib/template.js"
import { importFromJson, exportToJson } from "../lib/importer.js"
import { lintAll } from "../lib/lint.js"
import type { Prompt } from "../types/index.js"

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const pkg = require("../../package.json")

const program = new Command()
  .name("prompts")
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  .version(pkg.version as string)
  .description("Reusable prompt library — save, search, render prompts from any AI session")
  .option("--json", "Output as JSON")
  .option("--project <name>", "Active project (name, slug, or ID) for scoped operations")

function isJson(): boolean {
  return Boolean(program.opts()["json"])
}

function getActiveProjectId(): string | null {
  const projectName = (program.opts()["project"] as string | undefined) ?? process.env["PROMPTS_PROJECT"]
  if (!projectName) return null
  const db = getDatabase()
  return resolveProject(db, projectName)
}

function output(data: unknown): void {
  if (isJson()) {
    console.log(JSON.stringify(data, null, 2))
  } else {
    console.log(data)
  }
}

function handleError(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e)
  if (isJson()) {
    console.log(JSON.stringify({ error: msg }))
  } else {
    console.error(chalk.red("Error: " + msg))
  }
  process.exit(1)
}

function fmtPrompt(p: Prompt): string {
  const tags = p.tags.length > 0 ? chalk.gray(` [${p.tags.join(", ")}]`) : ""
  const template = p.is_template ? chalk.cyan(" ◇") : ""
  const pin = p.pinned ? chalk.yellow(" 📌") : ""
  return `${chalk.bold(p.id)} ${chalk.green(p.slug)}${template}${pin}  ${p.title}${tags}  ${chalk.gray(p.collection)}`
}

// ── save ──────────────────────────────────────────────────────────────────────
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
  .action(async (title: string, opts: Record<string, string>) => {
    try {
      let body = opts["body"] ?? ""
      if (opts["file"]) {
        const { readFileSync } = await import("fs")
        body = readFileSync(opts["file"], "utf-8")
      } else if (opts["body"] === "-" || (!opts["body"] && !opts["file"])) {
        // Read from stdin if no body given
        const chunks: Buffer[] = []
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
        body = Buffer.concat(chunks).toString("utf-8").trim()
      }
      if (!body) handleError("No body provided. Use --body, --file, or pipe via stdin.")

      const project_id = getActiveProjectId()
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
      if (duplicate_warning && !isJson()) {
        console.warn(chalk.yellow(`Warning: ${duplicate_warning}`))
      }

      if (isJson()) {
        output(prompt)
      } else {
        const action = created ? chalk.green("Created") : chalk.yellow("Updated")
        console.log(`${action} ${chalk.bold(prompt.id)} — ${chalk.green(prompt.slug)}`)
        console.log(chalk.gray(`  Title: ${prompt.title}`))
        console.log(chalk.gray(`  Collection: ${prompt.collection}`))
        if (prompt.is_template) {
          const vars = extractVariableInfo(prompt.body)
          console.log(chalk.cyan(`  Template vars: ${vars.map((v) => v.name).join(", ")}`))
        }
      }
    } catch (e) {
      handleError(e)
    }
  })

// ── use ───────────────────────────────────────────────────────────────────────
program
  .command("use <id>")
  .description("Get a prompt's body and increment its use counter")
  .action((id: string) => {
    try {
      const prompt = usePrompt(id)
      if (isJson()) {
        output(prompt)
      } else {
        console.log(prompt.body)
      }
    } catch (e) {
      handleError(e)
    }
  })

// ── get ───────────────────────────────────────────────────────────────────────
program
  .command("get <id>")
  .description("Get prompt details without incrementing use counter")
  .action((id: string) => {
    try {
      const prompt = getPrompt(id)
      if (!prompt) handleError(`Prompt not found: ${id}`)
      output(isJson() ? prompt : fmtPrompt(prompt!))
    } catch (e) {
      handleError(e)
    }
  })

// ── list ──────────────────────────────────────────────────────────────────────
program
  .command("list")
  .description("List prompts")
  .option("-c, --collection <name>", "Filter by collection")
  .option("-t, --tags <tags>", "Filter by tags (comma-separated)")
  .option("--templates", "Show only templates")
  .option("--recent", "Sort by recently used")
  .option("-n, --limit <n>", "Max results", "50")
  .action((opts: Record<string, string | boolean>) => {
    try {
      const project_id = getActiveProjectId()
      let prompts = listPrompts({
        collection: opts["collection"] as string | undefined,
        tags: opts["tags"] ? (opts["tags"] as string).split(",").map((t) => t.trim()) : undefined,
        is_template: opts["templates"] ? true : undefined,
        limit: parseInt(opts["limit"] as string) || 50,
        ...(project_id !== null ? { project_id } : {}),
      })
      if (opts["recent"]) {
        prompts = prompts
          .filter((p) => p.last_used_at !== null)
          .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""))
      }
      if (isJson()) {
        output(prompts)
      } else if (prompts.length === 0) {
        console.log(chalk.gray("No prompts found."))
      } else {
        for (const p of prompts) console.log(fmtPrompt(p))
        console.log(chalk.gray(`\n${prompts.length} prompt(s)`))
      }
    } catch (e) {
      handleError(e)
    }
  })

// ── search ────────────────────────────────────────────────────────────────────
program
  .command("search <query>")
  .description("Full-text search across prompts (FTS5)")
  .option("-c, --collection <name>")
  .option("-t, --tags <tags>")
  .option("-n, --limit <n>", "Max results", "20")
  .action((query: string, opts: Record<string, string>) => {
    try {
      const project_id = getActiveProjectId()
      const results = searchPrompts(query, {
        collection: opts["collection"],
        tags: opts["tags"] ? opts["tags"].split(",").map((t) => t.trim()) : undefined,
        limit: parseInt(opts["limit"] ?? "20") || 20,
        ...(project_id !== null ? { project_id } : {}),
      })
      if (isJson()) {
        output(results)
      } else if (results.length === 0) {
        console.log(chalk.gray("No results."))
      } else {
        for (const r of results) {
          console.log(fmtPrompt(r.prompt))
          if (r.snippet) {
            // Highlight [matched] portions returned by FTS5 snippet()
            const highlighted = r.snippet.replace(/\[([^\]]+)\]/g, (_m: string, word: string) => chalk.yellowBright(word))
            console.log(chalk.gray("  ") + chalk.gray(highlighted))
          }
        }
        console.log(chalk.gray(`\n${results.length} result(s)`))
      }
    } catch (e) {
      handleError(e)
    }
  })

// ── render ────────────────────────────────────────────────────────────────────
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
        if (eq === -1) handleError(`Invalid var format: ${assignment}. Use key=value`)
        vars[assignment.slice(0, eq)] = assignment.slice(eq + 1)
      }
      const result = renderTemplate(prompt.body, vars)
      if (isJson()) {
        output(result)
      } else {
        console.log(result.rendered)
        if (result.missing_vars.length > 0)
          console.error(chalk.yellow(`\nWarning: missing vars: ${result.missing_vars.join(", ")}`))
        if (result.used_defaults.length > 0)
          console.error(chalk.gray(`Used defaults: ${result.used_defaults.join(", ")}`))
      }
    } catch (e) {
      handleError(e)
    }
  })

// ── templates ─────────────────────────────────────────────────────────────────
program
  .command("templates")
  .description("List template prompts")
  .option("-c, --collection <name>")
  .action((opts: Record<string, string>) => {
    try {
      const prompts = listPrompts({ is_template: true, collection: opts["collection"] })
      if (isJson()) {
        output(prompts)
      } else if (prompts.length === 0) {
        console.log(chalk.gray("No templates found."))
      } else {
        for (const p of prompts) {
          const vars = extractVariableInfo(p.body)
          console.log(fmtPrompt(p))
          console.log(chalk.cyan(`  vars: ${vars.map((v) => (v.required ? v.name : `${v.name}?`)).join(", ")}`))
        }
      }
    } catch (e) {
      handleError(e)
    }
  })

// ── inspect ───────────────────────────────────────────────────────────────────
program
  .command("inspect <id>")
  .description("Show a prompt's variables (for templates)")
  .action((id: string) => {
    try {
      const prompt = getPrompt(id)
      if (!prompt) handleError(`Prompt not found: ${id}`)
      const vars = extractVariableInfo(prompt!.body)
      if (isJson()) {
        output(vars)
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
      handleError(e)
    }
  })

// ── update ────────────────────────────────────────────────────────────────────
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
      if (isJson()) output(prompt)
      else console.log(`${chalk.yellow("Updated")} ${chalk.bold(prompt.id)} — ${chalk.green(prompt.slug)}`)
    } catch (e) {
      handleError(e)
    }
  })

// ── delete ────────────────────────────────────────────────────────────────────
program
  .command("delete <id>")
  .description("Delete a prompt")
  .option("-y, --yes", "Skip confirmation")
  .action(async (id: string, opts: { yes?: boolean }) => {
    try {
      const prompt = getPrompt(id)
      if (!prompt) handleError(`Prompt not found: ${id}`)
      if (!opts.yes && !isJson()) {
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
      if (isJson()) output({ deleted: true, id: prompt!.id })
      else console.log(chalk.red(`Deleted ${prompt!.slug}`))
    } catch (e) {
      handleError(e)
    }
  })

// ── history ───────────────────────────────────────────────────────────────────
program
  .command("history <id>")
  .description("Show version history for a prompt")
  .action((id: string) => {
    try {
      const prompt = getPrompt(id)
      if (!prompt) handleError(`Prompt not found: ${id}`)
      const versions = listVersions(prompt!.id)
      if (isJson()) {
        output(versions)
      } else {
        console.log(chalk.bold(`Version history for ${prompt!.slug}:`))
        for (const v of versions) {
          const current = v.version === prompt!.version ? chalk.green(" ← current") : ""
          const by = v.changed_by ? chalk.gray(` by ${v.changed_by}`) : ""
          console.log(`  v${v.version}  ${chalk.gray(v.created_at)}${by}${current}`)
        }
      }
    } catch (e) {
      handleError(e)
    }
  })

// ── restore ───────────────────────────────────────────────────────────────────
program
  .command("restore <id> <version>")
  .description("Restore a prompt to a previous version")
  .option("--agent <name>")
  .action((id: string, version: string, opts: Record<string, string>) => {
    try {
      const prompt = getPrompt(id)
      if (!prompt) handleError(`Prompt not found: ${id}`)
      restoreVersion(prompt!.id, parseInt(version), opts["agent"])
      if (isJson()) output({ restored: true, id: prompt!.id, version: parseInt(version) })
      else console.log(chalk.green(`Restored ${prompt!.slug} to v${version}`))
    } catch (e) {
      handleError(e)
    }
  })

// ── collections ───────────────────────────────────────────────────────────────
program
  .command("collections")
  .description("List all collections")
  .action(() => {
    try {
      const cols = listCollections()
      if (isJson()) {
        output(cols)
      } else {
        for (const c of cols) {
          console.log(`${chalk.bold(c.name)}  ${chalk.gray(`${c.prompt_count} prompt(s)`)}`)
          if (c.description) console.log(chalk.gray("  " + c.description))
        }
      }
    } catch (e) {
      handleError(e)
    }
  })

// ── move ──────────────────────────────────────────────────────────────────────
program
  .command("move <id> <collection>")
  .description("Move a prompt to a different collection")
  .action((id: string, collection: string) => {
    try {
      movePrompt(id, collection)
      if (isJson()) output({ moved: true, id, collection })
      else console.log(`${chalk.green("Moved")} ${id} → ${chalk.bold(collection)}`)
    } catch (e) {
      handleError(e)
    }
  })

// ── export ────────────────────────────────────────────────────────────────────
program
  .command("export")
  .description("Export prompts as JSON")
  .option("-c, --collection <name>")
  .option("-o, --output <file>", "Write to file instead of stdout")
  .action(async (opts: Record<string, string>) => {
    try {
      const data = exportToJson(opts["collection"])
      const json = JSON.stringify(data, null, 2)
      if (opts["output"]) {
        const { writeFileSync } = await import("fs")
        writeFileSync(opts["output"], json)
        console.log(chalk.green(`Exported ${data.prompts.length} prompt(s) to ${opts["output"]}`))
      } else {
        console.log(json)
      }
    } catch (e) {
      handleError(e)
    }
  })

// ── import ────────────────────────────────────────────────────────────────────
program
  .command("import <file>")
  .description("Import prompts from a JSON file")
  .option("--agent <name>")
  .action(async (file: string, opts: Record<string, string>) => {
    try {
      const { readFileSync } = await import("fs")
      const raw = JSON.parse(readFileSync(file, "utf-8")) as unknown
      const items = Array.isArray(raw) ? raw : (raw as { prompts: unknown[] }).prompts ?? []
      const results = importFromJson(items as Parameters<typeof importFromJson>[0], opts["agent"])
      if (isJson()) output(results)
      else {
        console.log(chalk.green(`Created: ${results.created}, Updated: ${results.updated}`))
        if (results.errors.length > 0) {
          console.error(chalk.red(`Errors: ${results.errors.length}`))
          for (const e of results.errors) console.error(chalk.red(`  ${e.item}: ${e.error}`))
        }
      }
    } catch (e) {
      handleError(e)
    }
  })

// ── stats ─────────────────────────────────────────────────────────────────────
program
  .command("stats")
  .description("Show usage statistics")
  .action(() => {
    try {
      const stats = getPromptStats()
      if (isJson()) {
        output(stats)
      } else {
        console.log(chalk.bold("Prompt Stats"))
        console.log(`  Total: ${stats.total_prompts}  Templates: ${stats.total_templates}  Collections: ${stats.total_collections}`)
        if (stats.most_used.length > 0) {
          console.log(chalk.bold("\nMost used:"))
          for (const p of stats.most_used)
            console.log(`  ${chalk.green(p.slug)}  ${chalk.gray(`${p.use_count}×`)}`)
        }
        if (stats.by_collection.length > 0) {
          console.log(chalk.bold("\nBy collection:"))
          for (const c of stats.by_collection)
            console.log(`  ${chalk.bold(c.collection)}  ${chalk.gray(`${c.count}`)}`)
        }
      }
    } catch (e) {
      handleError(e)
    }
  })

// ── recent ────────────────────────────────────────────────────────────────────
program
  .command("recent [n]")
  .description("Show recently used prompts (default: 10)")
  .action((n: string | undefined) => {
    try {
      const limit = parseInt(n ?? "10") || 10
      const prompts = listPrompts({ limit })
        .filter((p) => p.last_used_at !== null)
        .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""))
        .slice(0, limit)
      if (isJson()) { output(prompts); return }
      if (prompts.length === 0) { console.log(chalk.gray("No recently used prompts.")); return }
      for (const p of prompts) {
        const ago = chalk.gray(new Date(p.last_used_at!).toLocaleString())
        console.log(`${chalk.bold(p.id)} ${chalk.green(p.slug)}  ${p.title}  ${ago}`)
      }
    } catch (e) { handleError(e) }
  })

// ── lint ──────────────────────────────────────────────────────────────────────
program
  .command("lint")
  .description("Check prompt quality: missing descriptions, undocumented vars, short bodies, no tags")
  .option("-c, --collection <name>", "Lint only this collection")
  .action((opts: Record<string, string>) => {
    try {
      const prompts = listPrompts({ collection: opts["collection"], limit: 10000 })
      const results = lintAll(prompts)
      if (isJson()) { output(results); return }
      if (results.length === 0) { console.log(chalk.green("✓ All prompts pass lint.")); return }

      let errors = 0, warns = 0, infos = 0
      for (const { prompt: p, issues } of results) {
        console.log(`\n${chalk.bold(p.slug)}  ${chalk.gray(p.id)}`)
        for (const issue of issues) {
          if (issue.severity === "error") { console.log(chalk.red(`  ✗ [${issue.rule}] ${issue.message}`)); errors++ }
          else if (issue.severity === "warn") { console.log(chalk.yellow(`  ⚠ [${issue.rule}] ${issue.message}`)); warns++ }
          else { console.log(chalk.gray(`  ℹ [${issue.rule}] ${issue.message}`)); infos++ }
        }
      }
      console.log(chalk.bold(`\n${results.length} prompt(s) with issues — ${errors} errors, ${warns} warnings, ${infos} info`))
      if (errors > 0) process.exit(1)
    } catch (e) { handleError(e) }
  })

// ── stale ─────────────────────────────────────────────────────────────────────
program
  .command("stale [days]")
  .description("List prompts not used in N days (default: 30)")
  .action((days: string | undefined) => {
    try {
      const threshold = parseInt(days ?? "30") || 30
      const cutoff = new Date(Date.now() - threshold * 24 * 60 * 60 * 1000).toISOString()
      const all = listPrompts({ limit: 10000 })
      const stale = all.filter(
        (p) => p.last_used_at === null || p.last_used_at < cutoff
      ).sort((a, b) => (a.last_used_at ?? "").localeCompare(b.last_used_at ?? ""))
      if (isJson()) { output(stale); return }
      if (stale.length === 0) { console.log(chalk.green(`No stale prompts (threshold: ${threshold} days).`)); return }
      console.log(chalk.bold(`Stale prompts (not used in ${threshold}+ days):`))
      for (const p of stale) {
        const last = p.last_used_at ? chalk.gray(new Date(p.last_used_at).toLocaleDateString()) : chalk.red("never")
        console.log(`  ${chalk.green(p.slug)}  ${chalk.gray(`${p.use_count}×`)}  last used: ${last}`)
      }
      console.log(chalk.gray(`\n${stale.length} stale prompt(s)`))
    } catch (e) { handleError(e) }
  })

// ── pin / unpin ───────────────────────────────────────────────────────────────
program
  .command("pin <id>")
  .description("Pin a prompt so it always appears first in lists")
  .action((id: string) => {
    try {
      const p = pinPrompt(id, true)
      if (isJson()) output(p)
      else console.log(chalk.yellow(`📌 Pinned ${chalk.bold(p.slug)}`))
    } catch (e) { handleError(e) }
  })

program
  .command("unpin <id>")
  .description("Unpin a prompt")
  .action((id: string) => {
    try {
      const p = pinPrompt(id, false)
      if (isJson()) output(p)
      else console.log(chalk.gray(`Unpinned ${chalk.bold(p.slug)}`))
    } catch (e) { handleError(e) }
  })

// ── copy ──────────────────────────────────────────────────────────────────────
program
  .command("copy <id>")
  .description("Copy prompt body to clipboard and increment use counter")
  .action(async (id: string) => {
    try {
      const prompt = usePrompt(id)
      const { platform } = process
      if (platform === "darwin") {
        const proc = Bun.spawn(["pbcopy"], { stdin: "pipe" })
        proc.stdin.write(prompt.body)
        proc.stdin.end()
        await proc.exited
      } else if (platform === "linux") {
        // Try xclip then xsel
        try {
          const proc = Bun.spawn(["xclip", "-selection", "clipboard"], { stdin: "pipe" })
          proc.stdin.write(prompt.body)
          proc.stdin.end()
          await proc.exited
        } catch {
          const proc = Bun.spawn(["xsel", "--clipboard", "--input"], { stdin: "pipe" })
          proc.stdin.write(prompt.body)
          proc.stdin.end()
          await proc.exited
        }
      } else {
        handleError("Clipboard not supported on this platform. Use `prompts use` instead.")
      }
      if (isJson()) output({ copied: true, id: prompt.id, slug: prompt.slug })
      else console.log(chalk.green(`Copied ${chalk.bold(prompt.slug)} to clipboard`))
    } catch (e) {
      handleError(e)
    }
  })

// ── project ───────────────────────────────────────────────────────────────────
const projectCmd = program.command("project").description("Manage projects")

projectCmd
  .command("create <name>")
  .description("Create a new project")
  .option("-d, --description <desc>", "Short description")
  .option("--path <path>", "Filesystem path this project maps to")
  .action((name: string, opts: Record<string, string>) => {
    try {
      const project = createProject({ name, description: opts["description"], path: opts["path"] })
      if (isJson()) output(project)
      else {
        console.log(`${chalk.green("Created")} project ${chalk.bold(project.name)} — ${chalk.gray(project.slug)}`)
        if (project.description) console.log(chalk.gray(`  ${project.description}`))
      }
    } catch (e) { handleError(e) }
  })

projectCmd
  .command("list")
  .description("List all projects")
  .action(() => {
    try {
      const projects = listProjects()
      if (isJson()) { output(projects); return }
      if (projects.length === 0) { console.log(chalk.gray("No projects.")); return }
      for (const p of projects) {
        console.log(`${chalk.bold(p.name)}  ${chalk.gray(p.slug)}  ${chalk.cyan(`${p.prompt_count} prompt(s)`)}`)
        if (p.description) console.log(chalk.gray(`  ${p.description}`))
      }
    } catch (e) { handleError(e) }
  })

projectCmd
  .command("get <id>")
  .description("Get project details")
  .action((id: string) => {
    try {
      const project = getProject(id)
      if (!project) handleError(`Project not found: ${id}`)
      output(isJson() ? project : `${chalk.bold(project!.name)}  ${chalk.gray(project!.slug)}  ${chalk.cyan(`${project!.prompt_count} prompt(s)`)}`)
    } catch (e) { handleError(e) }
  })

projectCmd
  .command("delete <id>")
  .description("Delete a project (prompts become global)")
  .option("-y, --yes", "Skip confirmation")
  .action(async (id: string, opts: { yes?: boolean }) => {
    try {
      const project = getProject(id)
      if (!project) handleError(`Project not found: ${id}`)
      if (!opts.yes && !isJson()) {
        const { createInterface } = await import("readline")
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        await new Promise<void>((resolve) => {
          rl.question(chalk.yellow(`Delete project "${project!.name}"? Prompts will become global. [y/N] `), (ans) => {
            rl.close()
            if (ans.toLowerCase() !== "y") { console.log("Cancelled."); process.exit(0) }
            resolve()
          })
        })
      }
      deleteProject(id)
      if (isJson()) output({ deleted: true, id: project!.id })
      else console.log(chalk.red(`Deleted project ${project!.name}`))
    } catch (e) { handleError(e) }
  })

program.parse()
