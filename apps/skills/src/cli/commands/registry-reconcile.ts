/**
 * The `cloud` group's `sync` verb — reconcile this machine's canonical corpus with the
 * hosted registry.
 *
 * The verb name is deliberate: `skills sync` (agent-sync.ts) already owns the last mile
 * into coding-agent folders, and this is the hosted-registry reconcile the plan calls the
 * missing unified state machine. It lives in the `cloud` group so the two can never be
 * confused in help output or muscle memory. The module name avoids the retired
 * direct-storage feature's identifiers, which the boundary tests ban from public sources
 * (see src/no-cloud-boundary.test.ts and src/lib/public-package-boundary.test.ts).
 */
import chalk from "chalk";
import type { Command } from "commander";

import {
  reconcileRegistry,
  ReconcileRegistryError,
  CONFLICT_POLICIES,
  DEFAULT_CONFLICT_POLICY,
  type ReconcileConflictPolicy,
  type ReconcileRegistryResult,
} from "../../lib/registry-reconcile.js";

export function registerRegistryReconcile(parent: Command) {
  const group = parent
    .command("cloud")
    .description("Synchronize this machine's skill corpus with the hosted registry");

  group
    .command("sync")
    .option("--push", "Push local changes to the registry (local-only, changed-locally, and conflicts won by local)", false)
    .option("--pull", "Pull registry changes into the local corpus (remote-only, changed-remotely, and conflicts won by remote)", false)
    .option("--all", "Both directions (the default when neither --push nor --pull is given)", false)
    .option("--dry-run", "Plan and report without writing anything", false)
    .option("--json", "Output the full result as JSON", false)
    .option(
      "--conflict <policy>",
      `Conflict policy: ${CONFLICT_POLICIES.join(" | ")}. Default: ${DEFAULT_CONFLICT_POLICY}.`,
      "skip",
    )
    .description("Two-way reconcile between the local corpus and the hosted registry")
    .action(async (options: { push: boolean; pull: boolean; all: boolean; dryRun: boolean; json: boolean; conflict: ReconcileConflictPolicy }) => {
      try {
        const result = await reconcileRegistry({
          push: options.push,
          pull: options.pull,
          all: options.all,
          dryRun: options.dryRun,
          conflict: options.conflict,
        });
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }
        printHuman(result);
      } catch (error) {
        if (options.json) {
          console.log(JSON.stringify({ error: (error as Error).message }, null, 2));
        } else {
          console.error(chalk.red((error as Error).message));
          if (error instanceof ReconcileRegistryError) for (const line of error.detail ?? []) console.error(chalk.dim(`  - ${line}`));
        }
        process.exitCode = 1;
      }
    });
}

function printHuman(result: ReconcileRegistryResult): void {
  const { summary } = result;
  const heading = result.dryRun ? "Dry run: what a sync would do" : "Sync complete";
  console.log(chalk.bold(`${heading} (${result.direction === "all" ? "all" : result.direction}${result.dryRun ? ", dry-run" : ""})`));
  console.log(`  ${chalk.dim("corpus")}    ${result.corpusRoot}`);
  console.log(`  ${chalk.dim("conflict")}  ${result.conflictPolicy}`);
  console.log(
    `  ${chalk.dim("summary")}  ${summary.pushed} pushed · ${summary.pulled} pulled · ${summary.inSync} in-sync · ${summary.conflicts} conflict(s) · ${summary.skipped} skipped · ${summary.errors} error(s)`,
  );
  const interesting = result.skills.filter((entry) => entry.action !== "none" || entry.state === "conflict");
  for (const entry of interesting) {
    const verb = entry.action === "push" ? chalk.green("push") : entry.action === "pull" ? chalk.cyan("pull") : chalk.yellow(entry.action);
    console.log(`  ${verb.padEnd(7)} ${entry.slug}${entry.reason ? chalk.dim(` — ${entry.reason}`) : ""}`);
    if (entry.result && !entry.result.ok) {
      console.log(chalk.dim(`         failed: ${entry.result.detail ?? "unknown error"}`));
    }
  }
  console.log("");
}
