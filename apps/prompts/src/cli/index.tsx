#!/usr/bin/env bun
import { registerEventsCommands } from "@hasna/events/commander";
import { Command } from "commander"
import chalk from "chalk"
import { createRequire } from "module"
import { listCollections, movePrompt } from "../db/collections.js"
import { createProject, getProject, listProjects, deleteProject } from "../db/projects.js"
import { getPrompt, listPrompts, listPromptsSlim, upsertPrompt, getPromptStats, pinPrompt, setNextPrompt, setExpiry, getTrending, deletePrompt, usePrompt } from "../db/prompts.js"
import { createSchedule, listSchedules, deleteSchedule, getDueSchedules } from "../db/schedules.js"
import { validateCron, getNextRunTime } from "../lib/cron.js"
import { runAudit } from "../lib/audit.js"
import { generateZshCompletion, generateBashCompletion } from "../lib/completion.js"
import { lintAll } from "../lib/lint.js"
import { importFromJson, exportToJson, scanAndImportSlashCommands } from "../lib/importer.js"
import { isJson, output, handleError, fmtPrompt, getActiveProjectId, writeToClipboard, parseOffset, parsePositiveInt, printPageSummary } from "./utils.js"
import { registerPromptCommands } from "./commands/prompts.js"
import { registerVersionCommands } from "./commands/versions.js"
import { registerQolCommands } from "./commands/qol.js"
import { registerConfigCommands } from "./commands/config.js"

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

// ── version / history / diff commands ─────────────────────────────────────────
registerVersionCommands(program)

// ── qol commands ──────────────────────────────────────────────────────────────
registerQolCommands(program)

// ── config management commands ────────────────────────────────────────────────
registerConfigCommands(program)

// ── collections ───────────────────────────────────────────────────────────────
program
  .command("collections")
  .description("List all collections")
  .option("-n, --limit <n>", "Max collections to show in human output", "20")
  .option("-o, --offset <n>", "Skip first N collections", "0")
  .option("--cursor <n>", "Alias for --offset")
  .action((opts: Record<string, string | boolean>) => {
    try {
      const cols = listCollections()
      if (isJson(program)) {
        output(program, cols)
      } else {
        const limit = parsePositiveInt(opts["limit"], 20)
        const offset = parseOffset(opts)
        const shown = cols.slice(offset, offset + limit)
        for (const c of shown) {
          console.log(`${chalk.bold(c.name)}  ${chalk.gray(`${c.prompt_count} prompt(s)`)}`)
          if (c.description) console.log(chalk.gray("  " + c.description))
        }
        printPageSummary({
          shown: shown.length,
          total: cols.length,
          noun: "collection",
          limit,
          offset,
          hasMore: offset + shown.length < cols.length,
          detailHint: "Use --json for full collection records.",
        })
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
  .option("-o, --offset <n>", "Skip first N recent prompts", "0")
  .option("--cursor <n>", "Alias for --offset")
  .option("--verbose", "Show more metadata per prompt")
  .action((n: string | undefined, opts: Record<string, string | boolean>) => {
    try {
      const limit = parseInt(n ?? "10") || 10
      const offset = parseOffset(opts)
      const project_id = getActiveProjectId(program)
      const json = isJson(program)
      const prompts = (json ? listPrompts : listPromptsSlim)({
        limit: json ? offset + limit : Math.max(100, offset + limit + 1),
        ...(project_id !== null ? { project_id } : {}),
      })
        .filter((p) => p.last_used_at !== null)
        .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""))
      if (json) { output(program, prompts.slice(offset, offset + limit)); return }
      if (prompts.length === 0) { console.log(chalk.gray("No recently used prompts.")); return }
      const shown = prompts.slice(offset, offset + limit)
      for (const p of shown) {
        const ago = chalk.gray(new Date(p.last_used_at!).toLocaleString())
        console.log(`${fmtPrompt(p, { verbose: Boolean(opts["verbose"]) })}  ${ago}`)
      }
      printPageSummary({
        shown: shown.length,
        noun: "prompt",
        limit,
        offset,
        hasMore: prompts.length > offset + shown.length,
        detailHint: "Use --verbose for more metadata, --json for raw records, or `prompts show <id>` / `prompts body <id>` for details.",
      })
    } catch (e) { handleError(program, e) }
  })

// ── lint ──────────────────────────────────────────────────────────────────────
program
  .command("lint")
  .description("Check prompt quality: missing descriptions, undocumented vars, short bodies, no tags")
  .option("-c, --collection <name>", "Lint only this collection")
  .option("-n, --limit <n>", "Max prompts with issues to show in human output", "20")
  .option("--verbose", "Show all issue details up to --limit")
  .action((opts: Record<string, string | boolean>) => {
    try {
      const project_id = getActiveProjectId(program)
      const prompts = listPrompts({
        collection: typeof opts["collection"] === "string" ? opts["collection"] : undefined,
        limit: 10000,
        ...(project_id !== null ? { project_id } : {}),
      })
      const results = lintAll(prompts)
      if (isJson(program)) { output(program, results); return }
      if (results.length === 0) { console.log(chalk.green("✓ All prompts pass lint.")); return }

      const allIssues = results.flatMap((r) => r.issues)
      const errors = allIssues.filter((issue) => issue.severity === "error").length
      const warns = allIssues.filter((issue) => issue.severity === "warn").length
      const infos = allIssues.filter((issue) => issue.severity === "info").length
      const limit = parsePositiveInt(opts["limit"], 20)
      const shown = results.slice(0, limit)
      for (const { prompt: p, issues } of shown) {
        console.log(`\n${chalk.bold(p.slug)}  ${chalk.gray(p.id)}`)
        for (const issue of issues.slice(0, opts["verbose"] ? issues.length : 3)) {
          if (issue.severity === "error") console.log(chalk.red(`  ✗ [${issue.rule}] ${issue.message}`))
          else if (issue.severity === "warn") console.log(chalk.yellow(`  ⚠ [${issue.rule}] ${issue.message}`))
          else console.log(chalk.gray(`  ℹ [${issue.rule}] ${issue.message}`))
        }
        if (!opts["verbose"] && issues.length > 3) console.log(chalk.gray(`  ... ${issues.length - 3} more issue(s); use --verbose`))
      }
      console.log(chalk.bold(`\nShowing ${shown.length} of ${results.length} prompt(s) with issues — ${errors} errors, ${warns} warnings, ${infos} info`))
      if (results.length > shown.length) console.log(chalk.gray(`Use --limit ${results.length} or --json for the full lint result.`))
      if (errors > 0) process.exit(1)
    } catch (e) { handleError(program, e) }
  })

// ── stale ─────────────────────────────────────────────────────────────────────
program
  .command("stale [days]")
  .description("List prompts not used in N days (default: 30)")
  .option("-n, --limit <n>", "Max stale prompts to show in human output", "20")
  .option("-o, --offset <n>", "Skip first N stale prompts", "0")
  .option("--cursor <n>", "Alias for --offset")
  .option("--verbose", "Show more metadata per prompt")
  .action((days: string | undefined, opts: Record<string, string | boolean>) => {
    try {
      const threshold = parseInt(days ?? "30") || 30
      const project_id = getActiveProjectId(program)
      const cutoff = new Date(Date.now() - threshold * 24 * 60 * 60 * 1000).toISOString()
      const json = isJson(program)
      const all = (json ? listPrompts : listPromptsSlim)({
        limit: 10000,
        ...(project_id !== null ? { project_id } : {}),
      })
      const stale = all.filter(
        (p) => p.last_used_at === null || p.last_used_at < cutoff
      ).sort((a, b) => (a.last_used_at ?? "").localeCompare(b.last_used_at ?? ""))
      const now = new Date().toISOString()
      const expired = all.filter((p) => p.expires_at !== null && p.expires_at < now)
      if (isJson(program)) { output(program, { stale, expired }); return }
      if (expired.length > 0) {
        console.log(chalk.red(`\nExpired (${expired.length}):`))
        for (const p of expired.slice(0, 10)) console.log(chalk.red(`  ✗ ${p.slug}`) + chalk.gray(` expired ${new Date(p.expires_at!).toLocaleDateString()}`))
        if (expired.length > 10) console.log(chalk.gray(`  ... ${expired.length - 10} more expired prompt(s); use --json`))
      }
      if (stale.length === 0 && expired.length === 0) { console.log(chalk.green(`No stale prompts (threshold: ${threshold} days).`)); return }
      if (stale.length > 0) {
        const limit = parsePositiveInt(opts["limit"], 20)
        const offset = parseOffset(opts)
        const shown = stale.slice(offset, offset + limit)
        console.log(chalk.bold(`\nStale prompts (not used in ${threshold}+ days):`))
        for (const p of shown) {
          const last = p.last_used_at ? chalk.gray(new Date(p.last_used_at).toLocaleDateString()) : chalk.red("never")
          console.log(`  ${fmtPrompt(p, { verbose: Boolean(opts["verbose"]) })}  last used: ${last}`)
        }
        printPageSummary({
          shown: shown.length,
          total: stale.length,
          noun: "stale prompt",
          limit,
          offset,
          hasMore: offset + shown.length < stale.length,
          detailHint: "Use --verbose for more metadata, --json for raw records, or `prompts show <id>` / `prompts body <id>` for details.",
        })
      }
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
      await writeToClipboard(prompt.body)
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
  .option("-n, --limit <n>", "Max projects to show in human output", "20")
  .option("-o, --offset <n>", "Skip first N projects", "0")
  .option("--cursor <n>", "Alias for --offset")
  .action((opts: Record<string, string | boolean>) => {
    try {
      const projects = listProjects()
      if (isJson(program)) { output(program, projects); return }
      if (projects.length === 0) { console.log(chalk.gray("No projects.")); return }
      const limit = parsePositiveInt(opts["limit"], 20)
      const offset = parseOffset(opts)
      const shown = projects.slice(offset, offset + limit)
      for (const p of shown) {
        console.log(`${chalk.bold(p.name)}  ${chalk.gray(p.slug)}  ${chalk.cyan(`${p.prompt_count} prompt(s)`)}`)
        if (p.description) console.log(chalk.gray(`  ${p.description}`))
      }
      printPageSummary({
        shown: shown.length,
        total: projects.length,
        noun: "project",
        limit,
        offset,
        hasMore: offset + shown.length < projects.length,
        detailHint: "Use --json for full project records or `prompts project get <id>` for one project.",
      })
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
  .option("-n, --limit <n>", "Max results (default: 20 human, 100 JSON)")
  .option("-o, --offset <n>", "Skip first N results", "0")
  .option("--cursor <n>", "Alias for --offset")
  .option("--verbose", "Show more metadata per prompt")
  .action((id: string, opts: Record<string, string | boolean>) => {
    try {
      const project = getProject(id)
      if (!project) handleError(program, `Project not found: ${id}`)
      const json = isJson(program)
      const limit = parsePositiveInt(opts["limit"], json ? 100 : 20)
      const offset = parseOffset(opts)
      const prompts = (json ? listPrompts : listPromptsSlim)({ project_id: project!.id, limit: json ? limit : limit + 1, offset })
      if (isJson(program)) { output(program, prompts); return }
      if (prompts.length === 0) { console.log(chalk.gray("No prompts.")); return }
      console.log(chalk.bold(`Prompts for project: ${project!.name}`))
      const shown = prompts.slice(0, limit)
      for (const p of shown) {
        const scope = p.project_id ? chalk.cyan(" [project]") : chalk.gray(" [global]")
        console.log(fmtPrompt(p, { verbose: Boolean(opts["verbose"]) }) + scope)
      }
      printPageSummary({
        shown: shown.length,
        noun: "prompt",
        limit,
        offset,
        hasMore: prompts.length > limit,
        detailHint: "Use --verbose for more metadata, --json for raw records, or `prompts show <id>` / `prompts body <id>` for details.",
      })
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
      const all = (json ? listPrompts : listPromptsSlim)({
        collection: typeof opts["collection"] === "string" ? opts["collection"] : undefined,
        limit: 10000,
        ...(project_id !== null ? { project_id } : {}),
      })
      const unused = all.filter((p) => p.use_count === 0).sort((a, b) => a.created_at.localeCompare(b.created_at))
      if (isJson(program)) { output(program, unused.slice(offset, offset + limit)); return }
      if (unused.length === 0) { console.log(chalk.green("All prompts have been used at least once.")); return }
      console.log(chalk.bold(`Unused prompts (${unused.length}):`))
      const shown = unused.slice(offset, offset + limit)
      for (const p of shown) {
        console.log(`  ${fmtPrompt(p, { verbose: Boolean(opts["verbose"]) })}  ${chalk.gray(`created ${new Date(p.created_at).toLocaleDateString()}`)}`)
      }
      printPageSummary({
        shown: shown.length,
        total: unused.length,
        noun: "unused prompt",
        limit,
        offset,
        hasMore: offset + shown.length < unused.length,
        detailHint: "Use --verbose for more metadata, --json for raw records, or `prompts show <id>` / `prompts body <id>` for details.",
      })
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
      const project_id = getActiveProjectId(program)
      const results = getTrending(parseInt(opts["days"] ?? "7") || 7, parseInt(opts["limit"] ?? "10") || 10, project_id)
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
    const { existsSync, mkdirSync, readFileSync, statSync } = await import("fs")
    const { resolve, join, basename } = await import("path")
    const watchDir = resolve(dir ?? join(process.cwd(), ".prompts"))
    if (!existsSync(watchDir)) mkdirSync(watchDir, { recursive: true })
    console.log(chalk.bold(`Watching ${watchDir} for .md changes…`) + chalk.gray(" (Ctrl+C to stop)"))

    const { importFromMarkdown } = await import("../lib/importer.js")
    const { getPrompt } = await import("../db/prompts.js")
    const { searchPrompts } = await import("../lib/search.js")

    // Track known files so we can detect renames/deletes
    const knownFiles = new Map<string, string>() // filename -> slug
    // Seed with existing .md files
    try {
      const { readdirSync } = await import("fs")
      for (const f of readdirSync(watchDir)) {
        if (f.endsWith(".md")) knownFiles.set(f, f.replace(/\.md$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-"))
      }
    } catch { /* ignore */ }

    const fsWatch = (await import("fs")).watch
    fsWatch(watchDir, { persistent: true }, async (_event, filename) => {
      if (!filename?.endsWith(".md")) return
      const filePath = join(watchDir, filename)
      const ts = chalk.gray(new Date().toLocaleTimeString())

      try {
        const exists = existsSync(filePath) && (() => { try { statSync(filePath); return true } catch { return false } })()

        if (!exists) {
          // File was deleted or renamed away — archive the prompt
          const slug = knownFiles.get(filename)
          if (slug) {
            const prompt = getPrompt(slug) ?? searchPrompts(slug).find((r) => r.prompt.slug === slug)?.prompt
            if (prompt) {
              // Mark as stale by noting deletion in description rather than hard-deleting
              const { updatePrompt } = await import("../db/prompts.js")
              updatePrompt(prompt.id, {
                description: `[watch: source file deleted at ${new Date().toISOString()}] ${prompt.description ?? ""}`.trim(),
                tags: [...new Set([...prompt.tags, "watch-deleted"])],
              })
              console.log(`${chalk.red("Deleted")} ${chalk.bold(filename.replace(".md", ""))}  ${ts}`)
            }
            knownFiles.delete(filename)
          }
          return
        }

        const content = readFileSync(filePath, "utf-8")
        const result = importFromMarkdown([{ filename, content }], opts["agent"])
        const action = result.created > 0 ? chalk.green("Created") : chalk.yellow("Updated")
        // Track this file's slug
        if (result.created > 0 || result.updated > 0) {
          const slug = basename(filename, ".md").toLowerCase().replace(/[^a-z0-9]+/g, "-")
          knownFiles.set(filename, slug)
        }
        console.log(`${action}: ${chalk.bold(filename.replace(".md", ""))}  ${ts}`)
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
  .option("-n, --limit <n>", "Max scanned files to show in human output", "50")
  .action((opts: Record<string, string>) => {
    try {
      const { scanned, imported } = scanAndImportSlashCommands(opts["dir"] ?? process.cwd(), opts["agent"])
      if (isJson(program)) { output(program, { scanned, imported }); return }
      if (scanned.length === 0) { console.log(chalk.gray("No slash command files found.")); return }
      console.log(chalk.bold(`Scanned ${scanned.length} file(s):`))
      const limit = parsePositiveInt(opts["limit"], 50)
      for (const s of scanned.slice(0, limit)) console.log(chalk.gray(`  ${s.source}/${s.file}`))
      if (scanned.length > limit) console.log(chalk.gray(`  ... ${scanned.length - limit} more file(s); use --limit or --json`))
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
  .option("-n, --limit <n>", "Max schedules to show in human output", "20")
  .option("-o, --offset <n>", "Skip first N schedules", "0")
  .option("--cursor <n>", "Alias for --offset")
  .action((id: string | undefined, opts: Record<string, string | boolean>) => {
    try {
      const schedules = listSchedules(id)
      if (isJson(program)) { output(program, schedules); return }
      if (!schedules.length) { console.log(chalk.gray("No schedules.")); return }
      const limit = parsePositiveInt(opts["limit"], 20)
      const offset = parseOffset(opts)
      const shown = schedules.slice(offset, offset + limit)
      for (const s of shown) {
        console.log(`${chalk.bold(s.id)}  ${chalk.cyan(s.prompt_slug)}  cron:${s.cron}  next:${s.next_run_at}  runs:${s.run_count}`)
      }
      printPageSummary({
        shown: shown.length,
        total: schedules.length,
        noun: "schedule",
        limit,
        offset,
        hasMore: offset + shown.length < schedules.length,
        detailHint: "Use --json for full schedule records.",
      })
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
registerEventsCommands(program, { source: "prompts" });

program.parse()
