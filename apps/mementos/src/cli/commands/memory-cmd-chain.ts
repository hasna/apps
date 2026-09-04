import type { Command } from "commander";
import chalk from "chalk";
import { getMemoryChain } from "../../db/memories.js";
import { outputJson, makeHandleError, type GlobalOpts } from "../helpers.js";
import { redactMemoryForOutput } from "../../lib/redact.js";

export function registerChainCommand(program: Command): void {
  const handleError = makeHandleError(program);

  program
    .command("chain <sequence_group>")
    .description("Show a memory chain (memories linked by sequence_group, ordered by sequence_order)")
    .action((sequenceGroup: string) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();

        const memories = getMemoryChain(sequenceGroup);
        // Read-path redaction (todos e12c7659): the write path redacts
        // value/summary but never the KEY, so a credential-shaped key stored
        // by any write path reaches stdout verbatim on this read. Project the
        // chain once, before the format branch.
        const safe = memories.map(redactMemoryForOutput);

        if (globalOpts.json) {
          outputJson(safe);
          return;
        }

        if (safe.length === 0) {
          console.log(chalk.yellow(`No chain found for sequence group: ${sequenceGroup}`));
          return;
        }

        console.log(chalk.bold(`Chain: ${sequenceGroup} (${safe.length} step${safe.length === 1 ? "" : "s"}):\n`));
        for (let i = 0; i < safe.length; i++) {
          const m = safe[i]!;
          const order = m.sequence_order !== null && m.sequence_order !== undefined ? m.sequence_order : i + 1;
          const value = m.value.length > 120 ? m.value.slice(0, 120) + "..." : m.value;
          console.log(`  ${chalk.cyan(String(order) + ".")} ${chalk.bold(`${m.key}:`)} ${value}`);
        }
      } catch (e) {
        handleError(e);
      }
    });
}
