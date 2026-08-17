import { Command } from "commander"
import chalk from "chalk"
import { existsSync, readFileSync } from "fs"
import {
  cancelDispatchRun,
  defaultRunsDir,
  dispatchPrompt,
  getDispatchRun,
  mergeVars,
} from "../../lib/dispatch/index.js"
import { discoverTargets, resolveBin } from "../../lib/dispatch/codewith.js"
import { capturePaths } from "../../lib/dispatch/capture-helper.js"
import { DispatchError, type DispatchRuntime } from "../../lib/dispatch/types.js"
import { handleError, isJson, output } from "../utils.js"

function failWithCode(program: Command, error: unknown): never {
  handleError(program, error instanceof DispatchError ? `${error.code}: ${error.message}` : error)
}

function parseVarAssignments(assignments: string[] | undefined): Array<[string, string]> {
  const result: Array<[string, string]> = []
  for (const assignment of assignments ?? []) {
    const eq = assignment.indexOf("=")
    if (eq === -1) {
      throw new Error(`Invalid var format: ${assignment}. Use key=value`)
    }
    result.push([assignment.slice(0, eq), assignment.slice(eq + 1)])
  }
  return result
}

function humanRunSummary(run: {
  id: string
  runtime: string
  status: string
  target: string | null
  prompt_slug: string
  exit_code: number | null
  error_code: string | null
}): string {
  const lines = [
    `Run ${chalk.bold(run.id)} — ${chalk.green(run.prompt_slug)} → ${chalk.cyan(run.runtime)}${run.target ? `/${run.target}` : ""}  ${chalk.bold(run.status)}`,
  ]
  if (run.exit_code !== null) lines.push(`  Exit code: ${run.exit_code}`)
  if (run.error_code !== null) lines.push(`  Error code: ${run.error_code}`)
  return lines.join("\n")
}

export function registerDispatchCommands(program: Command): void {
  const dispatchCmd = program
    .command("dispatch [id]")
    .description(
      "Render a prompt strictly and dispatch it to a runtime (emit | codewith, read-only)"
    )
    .option("--runtime <runtime>", "Runtime: emit (default) | codewith (read-only)")
    .option("--target <profile>", "Codewith target profile name")
    .option("-v, --var <assignments...>", "Variable assignments as key=value")
    .option("--vars-json <json>", "JSON object of template variables")
    .option("--cwd <dir>", "Working directory for the dispatched runtime")
    .option("--wait", "Wait for a codewith run to finish (default: fire and forget)")

  // ── dispatch <id> (no subcommand match) ──────────────────────────────────────
  dispatchCmd.action(async (id: string | undefined, opts: Record<string, string | string[] | boolean | undefined>) => {
    try {
      if (!id) {
        throw new Error("Missing prompt id. Usage: prompts dispatch <id> [options]")
      }
      const receipt = await dispatchPrompt(id, {
        runtime: (opts["runtime"] as DispatchRuntime | undefined) ?? "emit",
        target: typeof opts["target"] === "string" ? opts["target"] : undefined,
        vars: mergeVars(
          parseVarAssignments(opts["var"] as string[] | undefined),
          opts["varsJson"] as string | undefined
        ),
        cwd: typeof opts["cwd"] === "string" ? opts["cwd"] : undefined,
        wait: Boolean(opts["wait"]),
      })
      if (isJson(program)) {
        output(program, receipt)
      } else if (receipt.run.runtime === "emit" && receipt.rendered !== undefined) {
        console.log(receipt.rendered)
        console.error(
          chalk.gray(
            `\n[${receipt.run.id}] rendered from ${receipt.run.prompt_slug} (strict), status ${receipt.run.status}`
          )
        )
      } else {
        console.log(humanRunSummary(receipt.run))
        if (!opts["wait"] && receipt.run.status === "running") {
          console.log(
            chalk.gray("  Run continues in the background. Use `prompts dispatch get <run-id>` to poll.")
          )
        }
      }
    } catch (e) {
      failWithCode(program, e)
    }
  })

  // ── dispatch get ────────────────────────────────────────────────────────────
  dispatchCmd
    .command("get <run-id>")
    .description("Get dispatch run status and bounded result/log pointers (metadata only by default)")
    .option("--include-output", "Include the bounded, redacted output captures")
    .action((runId: string, opts: { includeOutput?: boolean }) => {
      try {
        const run = getDispatchRun(runId)
        if (!run) {
          throw new Error(`Dispatch run not found: ${runId}`)
        }
        if (opts.includeOutput) {
          const paths = capturePaths(defaultRunsDir(), runId)
          const read = (path: string): string | null => {
            try {
              return existsSync(path) ? readFileSync(path, "utf8") : null
            } catch {
              return null
            }
          }
          const payload = {
            run,
            output: {
              out: read(paths.out),
              err: read(paths.err),
              last: read(paths.last),
            },
          }
          if (isJson(program)) {
            output(program, payload)
          } else {
            console.log(humanRunSummary(run))
            if (payload.output.last !== null) console.log(`\n${payload.output.last}`)
          }
          return
        }
        if (isJson(program)) {
          output(program, run)
        } else {
          console.log(humanRunSummary(run))
          if (run.output_pointer) {
            console.log(chalk.gray(`  Output: ${run.output_pointer} (${run.output_bytes} bytes)`))
          }
          console.log(chalk.gray("  Use --include-output for the bounded captures."))
        }
      } catch (e) {
        failWithCode(program, e)
      }
    })

  // ── dispatch cancel ─────────────────────────────────────────────────────────
  dispatchCmd
    .command("cancel <run-id>")
    .description("Cancel a running codewith dispatch run")
    .action((runId: string) => {
      try {
        const result = cancelDispatchRun(runId)
        if (isJson(program)) output(program, result)
        else console.log(chalk.yellow(`Cancelling ${chalk.bold(runId)} — status will finalize as cancelled.`))
      } catch (e) {
        failWithCode(program, e)
      }
    })

  // ── targets ─────────────────────────────────────────────────────────────────
  const targetsCmd = program
    .command("targets")
    .description("Codewith dispatch target discovery (read-only; safe profile names and availability only)")

  targetsCmd
    .command("list")
    .description("List discoverable codewith targets with availability")
    .action(async () => {
      try {
        const bin = resolveBin("codewith", process.env["HASNA_PROMPTS_DISPATCH_CODEMITH_BIN"], "CODEMITH")
        const { targets, examined, warning } = await discoverTargets(bin)
        if (isJson(program)) {
          output(program, { targets, examined, warning })
          return
        }
        if (targets.length === 0) {
          console.log(chalk.gray("No codewith targets discovered."))
          return
        }
        for (const t of targets) {
          const availability = t.available
            ? chalk.green("healthy")
            : t.ok
              ? chalk.yellow(`not healthy (${t.health_status ?? "unknown"})`)
              : chalk.red(`unavailable (${t.health_reason ?? "no auth or provider failure"})`)
          const plan = t.plan ? chalk.gray(` plan:${t.plan}`) : ""
          console.log(
            `${chalk.bold(t.name)}  ${availability}${plan}  ${chalk.gray(t.provider ?? "unknown provider")}`
          )
        }
        console.log(
          chalk.gray(
            `\n${examined} target(s). A target is usable only when the provider reports it healthy now.`
          )
        )
        if (warning) {
          console.log(
            chalk.gray("Some targets could not be verified against the provider; see --json for details.")
          )
        }
      } catch (e) {
        failWithCode(program, e)
      }
    })
}
