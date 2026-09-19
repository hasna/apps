import type { Command } from "commander";
import chalk from "chalk";
import { getMemory } from "../../db/memories.js";
import { outputJson, outputJsonAndExit, makeHandleError, resolveMemoryId, type GlobalOpts } from "../helpers.js";
import { redactMemoryForOutput } from "../../lib/redact.js";

export function registerWhenToUseCommand(program: Command): void {
  const handleError = makeHandleError(program);

  program
    .command("when-to-use <memory_id>")
    .description("Show the when_to_use guidance for a memory")
    .action(async (memoryId: string) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const resolvedId = resolveMemoryId(memoryId);
        const memory = getMemory(resolvedId);

        if (!memory) {
          if (globalOpts.json) {
            await outputJsonAndExit({ error: `Memory not found: ${memoryId}` }, 1);
          } else {
            console.error(chalk.red(`Memory not found: ${memoryId}`));
          }
          if (!globalOpts.json) process.exit(1);
          return;
        }

        // Read-path redaction (todos e12c7659): this verb was missed by the
        // read-verb fix and rendered the raw stored key AND the raw when_to_use
        // text verbatim — a credential-shaped key or guidance reaches stdout in
        // both formats. Project the display copy once, before the format branch.
        const safe = redactMemoryForOutput(memory);
        const whenToUse = safe.when_to_use ?? null;

        if (globalOpts.json) {
          outputJson({ id: safe.id, key: safe.key, when_to_use: whenToUse });
          return;
        }

        console.log(chalk.bold(`${safe.key} (${safe.id.slice(0, 8)})`));
        if (whenToUse) {
          console.log(`  ${chalk.cyan("when_to_use:")} ${whenToUse}`);
        } else {
          console.log(chalk.dim("  (not set)"));
        }
      } catch (e) {
        handleError(e);
      }
    });
}
