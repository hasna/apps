import type { Command } from "commander";
import { COMPLETION_SHELLS, createCliManual, generateCompletionScript, renderCliManualMarkdown, type CompletionShell } from "../../lib/cli-help.js";
import { handleError } from "../helpers.js";

function globalOptions(program: Command): Record<string, any> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, any> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function parseShell(value: string): CompletionShell {
  if (COMPLETION_SHELLS.includes(value as CompletionShell)) return value as CompletionShell;
  throw new Error(`Unsupported shell: ${value}. Expected one of: ${COMPLETION_SHELLS.join(", ")}`);
}

export function registerHelpCommands(program: Command) {
  program
    .command("completions")
    .alias("completion")
    .description("Generate shell completions for bash, zsh, or fish")
    .argument("<shell>", "Shell to generate: bash, zsh, or fish")
    .action((shell: string) => {
      try {
        console.log(generateCompletionScript(program, parseShell(shell)));
      } catch (error) {
        handleError(error);
      }
    });

  program
    .command("manual")
    .description("Print the complete local CLI manual")
    .option("--format <format>", "markdown or json", "markdown")
    .option("-j, --json", "Output as JSON")
    .action((opts: { format?: string; json?: boolean }) => {
      try {
        const globalOpts = globalOptions(program);
        const manual = createCliManual(program);
        const format = (opts.json || globalOpts.json) ? "json" : opts.format || "markdown";
        if (format === "json") {
          console.log(JSON.stringify(manual));
          return;
        }
        if (format !== "markdown") throw new Error("--format must be markdown or json");
        console.log(renderCliManualMarkdown(manual));
      } catch (error) {
        handleError(error);
      }
    });
}
