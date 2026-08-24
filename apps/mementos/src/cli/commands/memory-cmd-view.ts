import type { Command } from "commander";
import chalk from "chalk";
import {
  getMemory,
  getMemoryVersions,
  touchMemory,
  updateMemory,
} from "../../db/memories.js";
import {
  outputJson,
  formatMemoryDetail,
  makeHandleError,
  resolveKeyOrId,
  resolveMemoryId,
  type GlobalOpts,
} from "../helpers.js";
import { redactMemoryForOutput, redactTextFragment } from "../../lib/redact.js";

export function registerViewCommands(program: Command): void {
  const handleError = makeHandleError(program);

  // ============================================================================
  // show <id>
  // ============================================================================

  program
    .command("show <id>")
    .description("Show full detail of a memory by ID (supports partial IDs)")
    .action((id: string) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const resolvedId = resolveMemoryId(id);
        const memory = getMemory(resolvedId);

        if (!memory) {
          if (globalOpts.json) {
            outputJson({ error: `Memory not found: ${id}` });
          } else {
            console.error(chalk.red(`Memory not found: ${id}`));
          }
          process.exit(1);
        }

        touchMemory(memory.id);

        // Read-path redaction (todos e12c7659): the write path redacts
        // value/summary but never the KEY, so a credential-shaped key stored
        // by any write path reaches stdout verbatim on this read. Project the
        // display copy once, before the format branch, so JSON and human both
        // emit value-safe text while coordination metadata survives.
        const safe = redactMemoryForOutput(memory);

        if (globalOpts.json) {
          outputJson(safe);
        } else {
          console.log(formatMemoryDetail(safe));
        }
      } catch (e) {
        handleError(e);
      }
    });

  // ============================================================================
  // pin <keyOrId>
  // ============================================================================

  program
    .command("pin <keyOrId>")
    .description("Pin a memory by key or partial ID")
    .option("--scope <scope>", "Scope filter for key lookup")
    .option("--agent <name>", "Agent filter for key lookup")
    .option("--project <path>", "Project filter for key lookup")
    .action((keyOrId: string, opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const memory = resolveKeyOrId(keyOrId, opts, globalOpts);
        if (!memory) {
          if (globalOpts.json) {
            outputJson({ error: `No memory found: ${keyOrId}` });
          } else {
            console.error(chalk.red(`No memory found: ${keyOrId}`));
          }
          process.exit(1);
        }

        const updated = updateMemory(memory.id, {
          version: memory.version,
          pinned: true,
        });

        if (globalOpts.json) {
          outputJson(updated);
        } else {
          console.log(chalk.green(`Pinned: ${updated.key} (${updated.id.slice(0, 8)})`));
        }
      } catch (e) {
        handleError(e);
      }
    });

  // ============================================================================
  // unpin <keyOrId>
  // ============================================================================

  program
    .command("unpin <keyOrId>")
    .description("Unpin a memory by key or partial ID")
    .option("--scope <scope>", "Scope filter for key lookup")
    .option("--agent <name>", "Agent filter for key lookup")
    .option("--project <path>", "Project filter for key lookup")
    .action((keyOrId: string, opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const memory = resolveKeyOrId(keyOrId, opts, globalOpts);
        if (!memory) {
          if (globalOpts.json) {
            outputJson({ error: `No memory found: ${keyOrId}` });
          } else {
            console.error(chalk.red(`No memory found: ${keyOrId}`));
          }
          process.exit(1);
        }

        const updated = updateMemory(memory.id, {
          version: memory.version,
          pinned: false,
        });

        if (globalOpts.json) {
          outputJson(updated);
        } else {
          console.log(chalk.green(`Unpinned: ${updated.key} (${updated.id.slice(0, 8)})`));
        }
      } catch (e) {
        handleError(e);
      }
    });

  // ============================================================================
  // archive <keyOrId>
  // ============================================================================

  program
    .command("archive <keyOrId>")
    .description("Archive a memory by key or ID (hides from lists, keeps history)")
    .option("--scope <scope>", "Scope filter for key lookup")
    .action((keyOrId: string, opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const memory = resolveKeyOrId(keyOrId, opts, globalOpts);
        if (!memory) {
          console.error(chalk.red(`No memory found: ${keyOrId}`));
          process.exit(1);
        }
        updateMemory(memory.id, { status: "archived", version: memory.version });
        if (globalOpts.json) {
          outputJson({ archived: true, id: memory.id, key: memory.key });
        } else {
          console.log(chalk.green(`✓ Archived: ${chalk.bold(memory.key)} (${memory.id.slice(0, 8)})`));
        }
      } catch (e) {
        console.error(chalk.red(`archive failed: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
      }
    });

  // ============================================================================
  // versions <keyOrId>
  // ============================================================================

  program
    .command("versions <keyOrId>")
    .description("Show version history for a memory")
    .option("--scope <scope>", "Scope filter for key lookup")
    .action((keyOrId: string, opts) => {
      try {
        const globalOpts = program.opts<GlobalOpts>();
        const memory = resolveKeyOrId(keyOrId, opts, globalOpts);
        if (!memory) {
          console.error(chalk.red(`No memory found: ${keyOrId}`));
          process.exit(1);
        }
        const versions = getMemoryVersions(memory.id);
        // Read-path redaction (todos e12c7659): the version history is a read
        // surface; redact the echoed key and every version's value the same
        // way show does.
        const safeKey = redactTextFragment(memory.key);
        const safeVersions = versions.map((v) => ({
          ...v,
          value: redactTextFragment(v.value),
          summary: v.summary ? redactTextFragment(v.summary) : null,
        }));
        if (globalOpts.json) {
          outputJson({ memory: { id: memory.id, key: safeKey, current_version: memory.version }, versions: safeVersions });
          return;
        }
        console.log(chalk.bold(`\nVersion history: ${safeKey} (current: v${memory.version})\n`));
        if (safeVersions.length === 0) {
          console.log(chalk.dim("  No previous versions."));
          return;
        }
        for (const v of safeVersions) {
          console.log(`  ${chalk.cyan(`v${v.version}`)} ${chalk.dim(v.created_at.slice(0, 16))} scope=${v.scope} imp=${v.importance}`);
          console.log(`    ${v.value.slice(0, 120)}${v.value.length > 120 ? "..." : ""}`);
        }
        console.log("");
      } catch (e) {
        console.error(chalk.red(`versions failed: ${e instanceof Error ? e.message : String(e)}`));
        process.exit(1);
      }
    });
}
