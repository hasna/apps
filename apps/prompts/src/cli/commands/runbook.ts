import { readdirSync, readFileSync } from "fs"
import { join } from "path"
import { Command } from "commander"
import chalk from "chalk"
import { analyzeRunbookPrompts, parseRunbookDetections, type RunbookPromptFile } from "../../lib/runbook-lint.js"
import { runbookPromptDir } from "../../lib/paths.js"
import { handleError, isJson } from "../utils.js"

function readPromptDirectory(directory: string): RunbookPromptFile[] {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
    .map((entry) => ({ path: entry.name, content: readFileSync(join(directory, entry.name), "utf8") }))
}

function printHumanReport(report: ReturnType<typeof analyzeRunbookPrompts>): void {
  if (report.findings.length === 0) {
    console.log(chalk.green(`No duplicated runbook blocks found in ${report.filesScanned} file(s).`))
    return
  }

  for (const finding of report.findings) {
    console.log(chalk.yellow(`${finding.kind}: ${finding.excerpt}`))
    for (const file of finding.files) {
      console.log(`  ${file.path}:${file.lines.start}-${file.lines.end}`)
    }
  }
  console.log(chalk.gray(`${report.findings.length} finding(s); no files were changed.`))
}

export function registerRunbookCommands(program: Command): void {
  const runbook = program.command("runbook").description("Inspect loop prompt runbooks")
  const lint = runbook
    .command("lint")
    .description("Report duplicated boilerplate, command inventories, and output schemas")
    .option("--dir <path>", "Prompt directory", runbookPromptDir())
    .option("--detect <kinds>", "Comma-separated: boilerplate,commands,outputs", "boilerplate,commands,outputs")
    .option("--json", "Output the stable JSON report")
    .option("--fail-on-findings", "Exit 1 when findings are reported")

  lint.action((opts: { dir: string; detect: string; json?: boolean; failOnFindings?: boolean }) => {
    try {
      const detections = parseRunbookDetections(opts.detect)
      const report = analyzeRunbookPrompts(readPromptDirectory(opts.dir), detections)
      if (opts.json || isJson(program)) console.log(JSON.stringify(report, null, 2))
      else printHumanReport(report)
      if (opts.failOnFindings && report.findings.length > 0) process.exitCode = 1
    } catch (error) {
      handleError(program, error)
    }
  })

  lint.addHelpText("after", `
Detection contract:
  Markdown sections headed SOP/procedure/instructions, commands/command inventory,
  or output/response schema are compared after case and whitespace normalization.
  Findings require the same block in at least two files. This command only reports;
  it never rewrites prompt files.

JSON contract (version 1):
  { "version": 1, "filesScanned": number, "detections": string[],
    "findings": [{ "kind": string, "files": [{ "path": string,
    "lines": { "start": number, "end": number } }], "excerpt": string }] }

Exit status:
  Findings exit 0 by default. --fail-on-findings changes that status to 1.`)
}
