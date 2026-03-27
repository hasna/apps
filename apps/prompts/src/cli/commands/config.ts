import { Command } from "commander"
import chalk from "chalk"
import { homedir } from "os"
import { join, resolve } from "path"
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from "fs"
import { getPrompt } from "../../db/prompts.js"
import { isJson, output, handleError } from "../utils.js"

// Known AI agent config file locations
// Each entry: agent name -> { global: path-relative-to-home, local: path-relative-to-cwd }
const AGENT_CONFIGS: Record<string, { global: string; local: string; label: string }> = {
  claude: {
    global: ".claude/CLAUDE.md",
    local: "CLAUDE.md",
    label: "Claude Code",
  },
  agents: {
    global: ".agents/AGENTS.md",
    local: "AGENTS.md",
    label: "OpenAI Agents SDK",
  },
  gemini: {
    global: ".gemini/GEMINI.md",
    local: ".gemini/GEMINI.md",
    label: "Gemini CLI",
  },
  codex: {
    global: ".codex/CODEX.md",
    local: "CODEX.md",
    label: "OpenAI Codex CLI",
  },
  cursor: {
    global: ".cursor/rules",
    local: ".cursorrules",
    label: "Cursor",
  },
  aider: {
    global: ".aider/CONVENTIONS.md",
    local: ".aider.conventions.md",
    label: "Aider",
  },
}

function resolveConfigPath(agent: string, globalFlag: boolean): string | null {
  const cfg = AGENT_CONFIGS[agent.toLowerCase()]
  if (!cfg) return null
  if (globalFlag) return join(homedir(), cfg.global)
  return resolve(process.cwd(), cfg.local)
}

export function registerConfigCommands(program: Command): void {
  const configCmd = program.command("config").description("Manage AI agent config files (CLAUDE.md, AGENTS.md, GEMINI.md, etc.)")

  // ── config list ──────────────────────────────────────────────────────────────
  configCmd
    .command("list")
    .description("List all known config files (global + project)")
    .action(() => {
      try {
        const rows: Array<{
          agent: string
          label: string
          scope: string
          path: string
          exists: boolean
          size?: number
        }> = []

        for (const [key, cfg] of Object.entries(AGENT_CONFIGS)) {
          const globalPath = join(homedir(), cfg.global)
          const localPath = resolve(process.cwd(), cfg.local)

          const globalExists = existsSync(globalPath)
          const localExists = existsSync(localPath)

          rows.push({
            agent: key,
            label: cfg.label,
            scope: "global",
            path: globalPath,
            exists: globalExists,
            size: globalExists ? statSync(globalPath).size : undefined,
          })

          if (globalPath !== localPath) {
            rows.push({
              agent: key,
              label: cfg.label,
              scope: "project",
              path: localPath,
              exists: localExists,
              size: localExists ? statSync(localPath).size : undefined,
            })
          }
        }

        if (isJson(program)) { output(program, rows); return }

        const existingRows = rows.filter((r) => r.exists)
        const missingRows = rows.filter((r) => !r.exists)

        if (existingRows.length > 0) {
          console.log(chalk.bold("Found:"))
          for (const r of existingRows) {
            const size = r.size !== undefined ? chalk.gray(` (${r.size}B)`) : ""
            const scope = r.scope === "global" ? chalk.blue("[global]") : chalk.cyan("[project]")
            console.log(`  ${scope} ${chalk.bold(r.label)}  ${chalk.gray(r.path)}${size}`)
          }
        }

        if (missingRows.length > 0) {
          console.log(chalk.dim("\nNot present:"))
          for (const r of missingRows) {
            const scope = r.scope === "global" ? chalk.blue("[global]") : chalk.cyan("[project]")
            console.log(chalk.gray(`  ${scope} ${r.label}  ${r.path}`))
          }
        }
      } catch (e) { handleError(program, e) }
    })

  // ── config get ───────────────────────────────────────────────────────────────
  configCmd
    .command("get <agent>")
    .description("Print the contents of an agent config file")
    .option("-g, --global", "Use global (~/) config instead of project-local")
    .action((agent: string, opts: { global?: boolean }) => {
      try {
        const path = resolveConfigPath(agent, Boolean(opts.global))
        if (!path) handleError(program, `Unknown agent "${agent}". Known: ${Object.keys(AGENT_CONFIGS).join(", ")}`)
        if (!existsSync(path!)) handleError(program, `Config file not found: ${path}`)
        const content = readFileSync(path!, "utf-8")
        if (isJson(program)) output(program, { agent, path, content })
        else console.log(content)
      } catch (e) { handleError(program, e) }
    })

  // ── config edit ──────────────────────────────────────────────────────────────
  configCmd
    .command("edit <agent>")
    .description("Open an agent config file in $EDITOR (creates if missing)")
    .option("-g, --global", "Edit global (~/) config instead of project-local")
    .action(async (agent: string, opts: { global?: boolean }) => {
      try {
        const path = resolveConfigPath(agent, Boolean(opts.global))
        if (!path) handleError(program, `Unknown agent "${agent}". Known: ${Object.keys(AGENT_CONFIGS).join(", ")}`)

        // Ensure directory exists
        const { mkdirSync } = await import("fs")
        const { dirname } = await import("path")
        mkdirSync(dirname(path!), { recursive: true })

        if (!existsSync(path!)) writeFileSync(path!, "", "utf-8")

        const editor = process.env["EDITOR"] ?? process.env["VISUAL"] ?? "vi"
        const proc = Bun.spawn([editor, path!], { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
        await proc.exited
        console.log(chalk.green(`Saved ${path}`))
      } catch (e) { handleError(program, e) }
    })

  // ── config inject ────────────────────────────────────────────────────────────
  configCmd
    .command("inject <slug> <agent>")
    .description("Append a saved prompt's body into an agent config file")
    .option("-g, --global", "Inject into global (~/) config instead of project-local")
    .option("--section <heading>", "Append under a markdown heading (creates if missing)")
    .option("--replace", "Replace section content instead of appending")
    .action(async (slug: string, agent: string, opts: { global?: boolean; section?: string; replace?: boolean }) => {
      try {
        const prompt = getPrompt(slug)
        if (!prompt) handleError(program, `Prompt not found: ${slug}`)

        const path = resolveConfigPath(agent, Boolean(opts.global))
        if (!path) handleError(program, `Unknown agent "${agent}". Known: ${Object.keys(AGENT_CONFIGS).join(", ")}`)

        const { mkdirSync } = await import("fs")
        const { dirname } = await import("path")
        mkdirSync(dirname(path!), { recursive: true })

        let existing = existsSync(path!) ? readFileSync(path!, "utf-8") : ""
        const injection = `\n${prompt!.body}\n`

        if (opts.section) {
          const heading = `## ${opts.section}`
          const idx = existing.indexOf(heading)
          if (idx === -1) {
            existing = existing.trimEnd() + `\n\n${heading}\n${injection}`
          } else if (opts.replace) {
            // Find end of section (next ## or EOF)
            const afterHeading = idx + heading.length
            const nextSection = existing.indexOf("\n## ", afterHeading)
            const sectionEnd = nextSection === -1 ? existing.length : nextSection
            existing = existing.slice(0, afterHeading) + `\n${injection}` + existing.slice(sectionEnd)
          } else {
            const afterHeading = idx + heading.length
            const nextSection = existing.indexOf("\n## ", afterHeading)
            const insertAt = nextSection === -1 ? existing.length : nextSection
            existing = existing.slice(0, insertAt).trimEnd() + `\n${injection}\n` + existing.slice(insertAt)
          }
        } else {
          existing = existing.trimEnd() + `\n${injection}`
        }

        writeFileSync(path!, existing)
        if (isJson(program)) output(program, { injected: true, slug: prompt!.slug, path, section: opts.section })
        else console.log(chalk.green(`Injected "${chalk.bold(prompt!.slug)}" into ${path}`))
      } catch (e) { handleError(program, e) }
    })

  // ── config set ───────────────────────────────────────────────────────────────
  configCmd
    .command("set <agent>")
    .description("Write content to an agent config file (reads from stdin or --body)")
    .option("-g, --global", "Write to global (~/) config instead of project-local")
    .option("--body <content>", "Content to write (use - or omit for stdin)")
    .option("-y, --yes", "Skip confirmation when overwriting existing file")
    .action(async (agent: string, opts: { global?: boolean; body?: string; yes?: boolean }) => {
      try {
        const path = resolveConfigPath(agent, Boolean(opts.global))
        if (!path) handleError(program, `Unknown agent "${agent}". Known: ${Object.keys(AGENT_CONFIGS).join(", ")}`)

        let content = opts.body ?? ""
        if (!content) {
          const chunks: Buffer[] = []
          for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
          content = Buffer.concat(chunks).toString("utf-8")
        }

        if (existsSync(path!) && !opts.yes && !isJson(program)) {
          const { createInterface } = await import("readline")
          const rl = createInterface({ input: process.stdin, output: process.stdout })
          await new Promise<void>((resolve) => {
            rl.question(chalk.yellow(`Overwrite existing ${path}? [y/N] `), (ans) => {
              rl.close()
              if (ans.toLowerCase() !== "y") { console.log("Cancelled."); process.exit(0) }
              resolve()
            })
          })
        }

        const { mkdirSync } = await import("fs")
        const { dirname } = await import("path")
        mkdirSync(dirname(path!), { recursive: true })
        writeFileSync(path!, content)

        if (isJson(program)) output(program, { written: true, agent, path })
        else console.log(chalk.green(`Wrote ${path}`))
      } catch (e) { handleError(program, e) }
    })

  // ── config scan ───────────────────────────────────────────────────────────────
  configCmd
    .command("scan [workspace]")
    .description("Scan repos in a workspace directory for missing/present agent config files")
    .option("--depth <n>", "Max directory depth to search for git repos", "3")
    .option("--agents <list>", "Comma-separated agents to check (default: all)")
    .option("--missing-only", "Only show repos with missing configs")
    .action((workspace: string | undefined, opts: { depth?: string; agents?: string; missingOnly?: boolean }) => {
      try {
        const wsDir = workspace ? resolve(workspace) : resolve(homedir(), "workspace")
        if (!existsSync(wsDir)) handleError(program, `Workspace not found: ${wsDir}`)

        const maxDepth = parseInt(opts.depth ?? "3") || 3
        const agentFilter = opts.agents ? opts.agents.split(",").map((a) => a.trim().toLowerCase()) : Object.keys(AGENT_CONFIGS)

        // Find git repos up to maxDepth
        const repos: string[] = []
        function scanDir(dir: string, depth: number) {
          if (depth > maxDepth) return
          try {
            const entries = readdirSync(dir, { withFileTypes: true })
            if (entries.some((e) => e.name === ".git" && e.isDirectory())) {
              repos.push(dir)
              return // don't recurse into a git repo's subdirectories
            }
            for (const entry of entries) {
              if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
                scanDir(join(dir, entry.name), depth + 1)
              }
            }
          } catch { /* skip unreadable dirs */ }
        }
        scanDir(wsDir, 0)

        type RepoReport = {
          repo: string
          configs: Record<string, { present: boolean; path: string; size?: number }>
          missing_count: number
          present_count: number
        }

        const reports: RepoReport[] = []
        for (const repo of repos) {
          const configs: RepoReport["configs"] = {}
          let missingCount = 0
          let presentCount = 0
          for (const agentKey of agentFilter) {
            const cfg = AGENT_CONFIGS[agentKey]
            if (!cfg) continue
            const localPath = join(repo, cfg.local)
            const exists = existsSync(localPath)
            configs[agentKey] = {
              present: exists,
              path: localPath,
              size: exists ? statSync(localPath).size : undefined,
            }
            if (exists) presentCount++
            else missingCount++
          }
          if (!opts.missingOnly || missingCount > 0) {
            reports.push({ repo, configs, missing_count: missingCount, present_count: presentCount })
          }
        }

        if (isJson(program)) { output(program, { workspace: wsDir, repos_scanned: repos.length, reports }); return }

        console.log(chalk.bold(`Scanned ${repos.length} repo(s) in ${wsDir}\n`))

        if (reports.length === 0) {
          console.log(chalk.green("✓ All repos have all config files."))
          return
        }

        for (const r of reports) {
          const rel = r.repo.replace(wsDir + "/", "")
          const status = r.missing_count === 0
            ? chalk.green(`✓ ${rel}`)
            : chalk.yellow(`△ ${rel}`)
          console.log(status + chalk.gray(` (${r.present_count} present, ${r.missing_count} missing)`))
          for (const [agent, info] of Object.entries(r.configs)) {
            const sym = info.present ? chalk.green("  ✓") : chalk.red("  ✗")
            const label = AGENT_CONFIGS[agent]?.label ?? agent
            const detail = info.present ? chalk.gray(` ${info.size}B`) : chalk.gray(` ${info.path}`)
            console.log(`${sym} ${label}${detail}`)
          }
          console.log()
        }

        const totalMissing = reports.reduce((s, r) => s + r.missing_count, 0)
        if (totalMissing > 0) {
          console.log(chalk.yellow(`${totalMissing} config file(s) missing across ${reports.filter((r) => r.missing_count > 0).length} repo(s)`))
          console.log(chalk.gray(`Use \`prompts config inject <slug> <agent>\` to add config content from your saved prompts.`))
        } else {
          console.log(chalk.green("✓ All checked repos have all config files."))
        }
      } catch (e) { handleError(program, e) }
    })
}
