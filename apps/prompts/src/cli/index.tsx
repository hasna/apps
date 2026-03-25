#!/usr/bin/env bun
import { Command } from "commander"
import chalk from "chalk"
import { createRequire } from "module"
import { listVersions, restoreVersion } from "../db/versions.js"
import { listCollections, movePrompt } from "../db/collections.js"
import { createProject, getProject, listProjects, deleteProject } from "../db/projects.js"
import { getPrompt, listPrompts, upsertPrompt, getPromptStats, pinPrompt, setNextPrompt, setExpiry, getTrending, deletePrompt, usePrompt } from "../db/prompts.js"
import { createSchedule, listSchedules, deleteSchedule, getDueSchedules } from "../db/schedules.js"
import { validateCron, getNextRunTime } from "../lib/cron.js"
import { runAudit } from "../lib/audit.js"
import { generateZshCompletion, generateBashCompletion } from "../lib/completion.js"
import { diffTexts } from "../lib/diff.js"
import { lintAll } from "../lib/lint.js"
import { importFromJson, exportToJson, scanAndImportSlashCommands } from "../lib/importer.js"
import { isJson, output, handleError, fmtPrompt } from "./utils.js"
import { registerPromptCommands } from "./commands/prompts.js"

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

// ── prompt CRUD + search commands ─────────────────────────────────────────────
registerPromptCommands(program)

// ── history ───────────────────────────────────────────────────────────────────
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

// ── restore ───────────────────────────────────────────────────────────────────
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

// ── collections ───────────────────────────────────────────────────────────────
program
  .command("collections")
  .description("List all collections")
  .action(() => {
    try {
      const cols = listCollections()
      if (isJson(program)) {
        output(program, cols)
      } else {
        for (const c of cols) {
          console.log(`${chalk.bold(c.name)}  ${chalk.gray(`${c.prompt_count} prompt(s)`)}`)
          if (c.description) console.log(chalk.gray("  " + c.description))
        }
      }
    } catch (e) {
      handleError(program, e)
    }
  })

// ── move ──────────────────────────────────────────────────────────────────────
program
  .command("move <id> <collection>")
  .description("Move a prompt to a different collection")
  .action((id: string, collection: string) => {
    try {
      movePrompt(id, collection)
      if (isJson(program)) output(program, { moved: true, id, collection })
      else console.log(`${chalk.green("Moved")} ${id} → ${chalk.bold(collection)}`)
    } catch (e) {
      handleError(program, e)
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
      handleError(program, e)
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
      if (isJson(program)) output(program, results)
      else {
        console.log(chalk.green(`Created: ${results.created}, Updated: ${results.updated}`))
        if (results.errors.length > 0) {
          console.error(chalk.red(`Errors: ${results.errors.length}`))
          for (const e of results.errors) console.error(chalk.red(`  ${e.item}: ${e.error}`))
        }
      }
    } catch (e) {
      handleError(program, e)
    }
  })

// ── stats ─────────────────────────────────────────────────────────────────────
program
  .command("stats")
  .description("Show usage statistics")
  .action(() => {
    try {
      const stats = getPromptStats()
      if (isJson(program)) {
        output(program, stats)
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
      handleError(program, e)
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
      if (isJson(program)) { output(program, prompts); return }
      if (prompts.length === 0) { console.log(chalk.gray("No recently used prompts.")); return }
      for (const p of prompts) {
        const ago = chalk.gray(new Date(p.last_used_at!).toLocaleString())
        console.log(`${chalk.bold(p.id)} ${chalk.green(p.slug)}  ${p.title}  ${ago}`)
      }
    } catch (e) { handleError(program, e) }
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
      if (isJson(program)) { output(program, results); return }
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
    } catch (e) { handleError(program, e) }
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
      const now = new Date().toISOString()
      const expired = all.filter((p) => p.expires_at !== null && p.expires_at < now)
      if (isJson(program)) { output(program, { stale, expired }); return }
      if (expired.length > 0) {
        console.log(chalk.red(`\nExpired (${expired.length}):`))
        for (const p of expired) console.log(chalk.red(`  ✗ ${p.slug}`) + chalk.gray(` expired ${new Date(p.expires_at!).toLocaleDateString()}`))
      }
      if (stale.length === 0 && expired.length === 0) { console.log(chalk.green(`No stale prompts (threshold: ${threshold} days).`)); return }
      if (stale.length > 0) {
        console.log(chalk.bold(`\nStale prompts (not used in ${threshold}+ days):`))
        for (const p of stale) {
          const last = p.last_used_at ? chalk.gray(new Date(p.last_used_at).toLocaleDateString()) : chalk.red("never")
          console.log(`  ${chalk.green(p.slug)}  ${chalk.gray(`${p.use_count}×`)}  last used: ${last}`)
        }
      }
      console.log(chalk.gray(`\n${stale.length} stale prompt(s)`))
    } catch (e) { handleError(program, e) }
  })

// ── pin / unpin ───────────────────────────────────────────────────────────────
program
  .command("pin <id>")
  .description("Pin a prompt so it always appears first in lists")
  .action((id: string) => {
    try {
      const p = pinPrompt(id, true)
      if (isJson(program)) output(program, p)
      else console.log(chalk.yellow(`📌 Pinned ${chalk.bold(p.slug)}`))
    } catch (e) { handleError(program, e) }
  })

program
  .command("unpin <id>")
  .description("Unpin a prompt")
  .action((id: string) => {
    try {
      const p = pinPrompt(id, false)
      if (isJson(program)) output(program, p)
      else console.log(chalk.gray(`Unpinned ${chalk.bold(p.slug)}`))
    } catch (e) { handleError(program, e) }
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
        handleError(program, "Clipboard not supported on this platform. Use `prompts use` instead.")
      }
      if (isJson(program)) output(program, { copied: true, id: prompt.id, slug: prompt.slug })
      else console.log(chalk.green(`Copied ${chalk.bold(prompt.slug)} to clipboard`))
    } catch (e) {
      handleError(program, e)
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
      if (isJson(program)) output(program, project)
      else {
        console.log(`${chalk.green("Created")} project ${chalk.bold(project.name)} — ${chalk.gray(project.slug)}`)
        if (project.description) console.log(chalk.gray(`  ${project.description}`))
      }
    } catch (e) { handleError(program, e) }
  })

projectCmd
  .command("list")
  .description("List all projects")
  .action(() => {
    try {
      const projects = listProjects()
      if (isJson(program)) { output(program, projects); return }
      if (projects.length === 0) { console.log(chalk.gray("No projects.")); return }
      for (const p of projects) {
        console.log(`${chalk.bold(p.name)}  ${chalk.gray(p.slug)}  ${chalk.cyan(`${p.prompt_count} prompt(s)`)}`)
        if (p.description) console.log(chalk.gray(`  ${p.description}`))
      }
    } catch (e) { handleError(program, e) }
  })

projectCmd
  .command("get <id>")
  .description("Get project details")
  .action((id: string) => {
    try {
      const project = getProject(id)
      if (!project) handleError(program, `Project not found: ${id}`)
      output(program, isJson(program) ? project : `${chalk.bold(project!.name)}  ${chalk.gray(project!.slug)}  ${chalk.cyan(`${project!.prompt_count} prompt(s)`)}`)
    } catch (e) { handleError(program, e) }
  })

projectCmd
  .command("prompts <id>")
  .description("List all prompts for a project (project-scoped + globals)")
  .option("-n, --limit <n>", "Max results", "100")
  .action((id: string, opts: Record<string, string>) => {
    try {
      const project = getProject(id)
      if (!project) handleError(program, `Project not found: ${id}`)
      const prompts = listPrompts({ project_id: project!.id, limit: parseInt(opts["limit"] ?? "100") || 100 })
      if (isJson(program)) { output(program, prompts); return }
      if (prompts.length === 0) { console.log(chalk.gray("No prompts.")); return }
      console.log(chalk.bold(`Prompts for project: ${project!.name}`))
      for (const p of prompts) {
        const scope = p.project_id ? chalk.cyan(" [project]") : chalk.gray(" [global]")
        console.log(fmtPrompt(p) + scope)
      }
      console.log(chalk.gray(`\n${prompts.length} prompt(s)`))
    } catch (e) { handleError(program, e) }
  })

projectCmd
  .command("delete <id>")
  .description("Delete a project (prompts become global)")
  .option("-y, --yes", "Skip confirmation")
  .action(async (id: string, opts: { yes?: boolean }) => {
    try {
      const project = getProject(id)
      if (!project) handleError(program, `Project not found: ${id}`)
      if (!opts.yes && !isJson(program)) {
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
      if (isJson(program)) output(program, { deleted: true, id: project!.id })
      else console.log(chalk.red(`Deleted project ${project!.name}`))
    } catch (e) { handleError(program, e) }
  })

// ── audit ─────────────────────────────────────────────────────────────────────
program
  .command("audit")
  .description("Check for orphaned project refs, empty collections, missing history, near-duplicate slugs, expired prompts")
  .action(() => {
    try {
      const report = runAudit()
      if (isJson(program)) { output(program, report); return }
      if (report.issues.length === 0) { console.log(chalk.green("✓ No audit issues found.")); return }
      for (const issue of report.issues) {
        const sym = issue.severity === "error" ? chalk.red("✗") : issue.severity === "warn" ? chalk.yellow("⚠") : chalk.gray("ℹ")
        const slug = issue.slug ? chalk.green(` ${issue.slug}`) : ""
        console.log(`${sym}${slug}  ${issue.message}`)
      }
      console.log(chalk.bold(`\n${report.issues.length} issue(s) — ${report.errors} errors, ${report.warnings} warnings, ${report.info} info`))
      if (report.errors > 0) process.exit(1)
    } catch (e) { handleError(program, e) }
  })

// ── unused ────────────────────────────────────────────────────────────────────
program
  .command("unused")
  .description("List prompts that have never been used (use_count = 0)")
  .option("-c, --collection <name>")
  .option("-n, --limit <n>", "Max results", "50")
  .action((opts: Record<string, string>) => {
    try {
      const all = listPrompts({ collection: opts["collection"], limit: parseInt(opts["limit"] ?? "50") || 50 })
      const unused = all.filter((p) => p.use_count === 0).sort((a, b) => a.created_at.localeCompare(b.created_at))
      if (isJson(program)) { output(program, unused); return }
      if (unused.length === 0) { console.log(chalk.green("All prompts have been used at least once.")); return }
      console.log(chalk.bold(`Unused prompts (${unused.length}):`))
      for (const p of unused) {
        console.log(`  ${fmtPrompt(p)}  ${chalk.gray(`created ${new Date(p.created_at).toLocaleDateString()}`)}`)
      }
    } catch (e) { handleError(program, e) }
  })

// ── trending ──────────────────────────────────────────────────────────────────
program
  .command("trending")
  .description("Most used prompts in the last N days")
  .option("--days <n>", "Lookback window in days", "7")
  .option("-n, --limit <n>", "Max results", "10")
  .action((opts: Record<string, string>) => {
    try {
      const results = getTrending(parseInt(opts["days"] ?? "7") || 7, parseInt(opts["limit"] ?? "10") || 10)
      if (isJson(program)) { output(program, results); return }
      if (results.length === 0) { console.log(chalk.gray("No usage data yet.")); return }
      console.log(chalk.bold(`Trending (last ${opts["days"] ?? "7"} days):`))
      for (const r of results) {
        console.log(`  ${chalk.green(r.slug)}  ${chalk.bold(String(r.uses))}×  ${chalk.gray(r.title)}`)
      }
    } catch (e) { handleError(program, e) }
  })

// ── expire ────────────────────────────────────────────────────────────────────
program
  .command("expire <id> [date]")
  .description("Set expiry date for a prompt (ISO date, e.g. 2026-12-31). Use 'none' to clear.")
  .action((id: string, date: string | undefined) => {
    try {
      const expiresAt = (!date || date === "none") ? null : new Date(date).toISOString()
      const p = setExpiry(id, expiresAt)
      if (isJson(program)) output(program, p)
      else console.log(expiresAt ? chalk.yellow(`Expires ${p.slug} on ${new Date(expiresAt).toLocaleDateString()}`) : chalk.gray(`Cleared expiry for ${p.slug}`))
    } catch (e) { handleError(program, e) }
  })

// ── duplicate ─────────────────────────────────────────────────────────────────
program
  .command("duplicate <id>")
  .description("Clone a prompt with a new slug")
  .option("-s, --to <slug>", "New slug (auto-generated if omitted)")
  .option("--title <title>", "New title (defaults to 'Copy of <original>')")
  .action((id: string, opts: Record<string, string>) => {
    try {
      const source = getPrompt(id)
      if (!source) handleError(program, `Prompt not found: ${id}`)
      const p = source!
      const { prompt } = upsertPrompt({
        title: opts["title"] ?? `Copy of ${p.title}`,
        slug: opts["to"],
        body: p.body,
        description: p.description ?? undefined,
        collection: p.collection,
        tags: p.tags,
        source: "manual",
      })
      if (isJson(program)) output(program, prompt)
      else console.log(`${chalk.green("Duplicated")} ${chalk.bold(p.slug)} → ${chalk.bold(prompt.slug)}`)
    } catch (e) { handleError(program, e) }
  })

// ── diff ──────────────────────────────────────────────────────────────────────
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

// ── chain ─────────────────────────────────────────────────────────────────────
program
  .command("chain <id> [next]")
  .description("Set the next prompt in a chain, or show the chain for a prompt. Use 'none' to clear.")
  .action((id: string, next: string | undefined) => {
    try {
      if (next !== undefined) {
        const nextSlug = next === "none" ? null : next
        const p = setNextPrompt(id, nextSlug)
        if (isJson(program)) output(program, p)
        else console.log(nextSlug ? `${chalk.green(p.slug)} → ${chalk.bold(nextSlug)}` : chalk.gray(`Cleared chain for ${p.slug}`))
        return
      }
      const prompt = getPrompt(id)
      if (!prompt) handleError(program, `Prompt not found: ${id}`)
      const chain: Array<{ slug: string; title: string }> = []
      let cur = prompt
      const seen = new Set<string>()
      while (cur && !seen.has(cur.id)) {
        chain.push({ slug: cur.slug, title: cur.title })
        seen.add(cur.id)
        cur = cur.next_prompt ? getPrompt(cur.next_prompt)! : null!
      }
      if (isJson(program)) { output(program, chain); return }
      console.log(chain.map((c) => chalk.green(c.slug)).join(chalk.gray(" → ")))
    } catch (e) { handleError(program, e) }
  })

// ── completion ────────────────────────────────────────────────────────────────
program
  .command("completion [shell]")
  .description("Output shell completion script (zsh or bash)")
  .action((shell: string | undefined) => {
    const sh = shell ?? (process.env["SHELL"]?.includes("zsh") ? "zsh" : "bash")
    if (sh === "zsh") {
      console.log(generateZshCompletion())
    } else if (sh === "bash") {
      console.log(generateBashCompletion())
    } else {
      handleError(program, `Unknown shell: ${sh}. Use 'zsh' or 'bash'.`)
    }
  })

// ── watch ─────────────────────────────────────────────────────────────────────
program
  .command("watch [dir]")
  .description("Watch a directory for .md changes and auto-import prompts (default: .prompts/)")
  .option("-c, --collection <name>", "Collection to import into", "watched")
  .option("--agent <name>", "Attribution")
  .action(async (dir: string | undefined, opts: Record<string, string>) => {
    const { existsSync, mkdirSync } = await import("fs")
    const { resolve, join } = await import("path")
    const watchDir = resolve(dir ?? join(process.cwd(), ".prompts"))
    if (!existsSync(watchDir)) mkdirSync(watchDir, { recursive: true })
    console.log(chalk.bold(`Watching ${watchDir} for .md changes…`) + chalk.gray(" (Ctrl+C to stop)"))

    const { importFromMarkdown } = await import("../lib/importer.js")
    const { readFileSync } = await import("fs")

    const fsWatch = (await import("fs")).watch
    fsWatch(watchDir, { persistent: true }, async (_event, filename) => {
      if (!filename?.endsWith(".md")) return
      const filePath = join(watchDir, filename)
      try {
        const content = readFileSync(filePath, "utf-8")
        const result = importFromMarkdown([{ filename, content }], opts["agent"])
        const action = result.created > 0 ? chalk.green("Created") : chalk.yellow("Updated")
        console.log(`${action}: ${chalk.bold(filename.replace(".md", ""))}  ${chalk.gray(new Date().toLocaleTimeString())}`)
      } catch {
        console.error(chalk.red(`Failed to import: ${filename}`))
      }
    })

    await new Promise(() => {})
  })

// ── import-slash-commands ─────────────────────────────────────────────────────
program
  .command("import-slash-commands")
  .description("Auto-scan .claude/commands, .codex/skills, .gemini/extensions and import all prompts")
  .option("--dir <path>", "Root dir to scan (default: cwd)", process.cwd())
  .option("--agent <name>", "Attribution")
  .action((opts: Record<string, string>) => {
    try {
      const { scanned, imported } = scanAndImportSlashCommands(opts["dir"] ?? process.cwd(), opts["agent"])
      if (isJson(program)) { output(program, { scanned, imported }); return }
      if (scanned.length === 0) { console.log(chalk.gray("No slash command files found.")); return }
      console.log(chalk.bold(`Scanned ${scanned.length} file(s):`))
      for (const s of scanned) console.log(chalk.gray(`  ${s.source}/${s.file}`))
      console.log(`\n${chalk.green(`Created: ${imported.created}`)}  ${chalk.yellow(`Updated: ${imported.updated}`)}`)
      if (imported.errors.length > 0) {
        for (const e of imported.errors) console.error(chalk.red(`  ✗ ${e.item}: ${e.error}`))
      }
    } catch (e) { handleError(program, e) }
  })

// ── remove (alias for delete) ─────────────────────────────────────────────────
program
  .command("remove <id>")
  .alias("rm")
  .alias("uninstall")
  .description("Remove a prompt (alias for delete)")
  .option("-y, --yes", "Skip confirmation")
  .action(async (id: string, opts: { yes?: boolean }) => {
    try {
      const prompt = getPrompt(id)
      if (!prompt) handleError(program, `Prompt not found: ${id}`)
      if (!opts.yes && !isJson(program)) {
        const { createInterface } = await import("readline")
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        await new Promise<void>((resolve) => {
          rl.question(chalk.yellow(`Remove "${prompt!.slug}"? [y/N] `), (ans) => {
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
      else console.log(chalk.red(`Removed ${prompt!.slug}`))
    } catch (e) {
      handleError(program, e)
    }
  })

// ── schedule ──────────────────────────────────────────────────────────────────
const scheduleCmd = program.command("schedule").description("Manage prompt schedules")

scheduleCmd
  .command("add <id> <cron>")
  .description("Schedule a prompt to run on a cron (5-field: min hour dom mon dow)")
  .option("--vars <json>", "JSON object of template variables, e.g. '{\"name\":\"Alice\"}'")
  .option("--agent <id>", "Agent ID to associate")
  .action((id: string, cron: string, opts: { vars?: string; agent?: string }) => {
    try {
      const cronError = validateCron(cron)
      if (cronError) handleError(program, `Invalid cron: ${cronError}`)
      const prompt = getPrompt(id)
      if (!prompt) handleError(program, `Prompt not found: ${id}`)
      const vars = opts.vars ? JSON.parse(opts.vars) as Record<string, string> : undefined
      const schedule = createSchedule({ prompt_id: prompt!.id, prompt_slug: prompt!.slug, cron, vars, agent_id: opts.agent })
      if (isJson(program)) { output(program, schedule); return }
      console.log(chalk.green(`Scheduled "${prompt!.slug}" [${schedule.id}]`))
      console.log(`  Cron:     ${cron}`)
      console.log(`  Next run: ${schedule.next_run_at}`)
    } catch (e) { handleError(program, e) }
  })

scheduleCmd
  .command("list [id]")
  .description("List schedules, optionally filtered by prompt ID")
  .action((id?: string) => {
    try {
      const schedules = listSchedules(id)
      if (isJson(program)) { output(program, schedules); return }
      if (!schedules.length) { console.log(chalk.gray("No schedules.")); return }
      for (const s of schedules) {
        console.log(`${chalk.bold(s.id)}  ${chalk.cyan(s.prompt_slug)}  cron:${s.cron}  next:${s.next_run_at}  runs:${s.run_count}`)
      }
    } catch (e) { handleError(program, e) }
  })

scheduleCmd
  .command("remove <scheduleId>")
  .alias("delete")
  .description("Remove a prompt schedule")
  .action((scheduleId: string) => {
    try {
      deleteSchedule(scheduleId)
      if (isJson(program)) output(program, { deleted: true, id: scheduleId })
      else console.log(chalk.red(`Removed schedule ${scheduleId}`))
    } catch (e) { handleError(program, e) }
  })

scheduleCmd
  .command("due")
  .description("Show and execute all due schedules")
  .option("--dry-run", "Show due prompts without marking them as ran")
  .action((opts: { dryRun?: boolean }) => {
    try {
      const due = getDueSchedules()
      if (!due.length) { console.log(chalk.gray("No prompts due.")); return }
      if (isJson(program)) { output(program, due); return }
      for (const d of due) {
        console.log(chalk.bold(`\n[${d.id}] ${d.prompt_slug}`))
        console.log(chalk.gray(`Next run: ${d.next_run_at}  |  Runs: ${d.run_count}`))
        console.log(chalk.white(d.rendered))
      }
      if (!opts.dryRun) console.log(chalk.green(`\n✓ Marked ${due.length} schedule(s) as ran.`))
    } catch (e) { handleError(program, e) }
  })

scheduleCmd
  .command("next <cron>")
  .description("Preview when a cron expression will fire")
  .option("-n, --count <n>", "Number of runs to show", "5")
  .action((cron: string, opts: { count?: string }) => {
    try {
      const cronError = validateCron(cron)
      if (cronError) handleError(program, `Invalid cron: ${cronError}`)
      const count = parseInt(opts.count ?? "5", 10)
      const runs: string[] = []
      let from = new Date()
      for (let i = 0; i < count; i++) {
        const next = getNextRunTime(cron, from)
        runs.push(next.toISOString())
        from = next
      }
      if (isJson(program)) { output(program, { cron, next_runs: runs }); return }
      console.log(chalk.bold(`Next ${count} runs for "${cron}":`))
      for (const r of runs) console.log(`  ${r}`)
    } catch (e) { handleError(program, e) }
  })

program.parse()
