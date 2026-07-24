import type { Command } from "commander";
import chalk from "chalk";
import { handleError, output, parseOptionalPositiveSafeInteger } from "../helpers.js";
import type { LocalSnapshotType } from "../../lib/local-snapshots.js";

function splitTypes(value?: string): LocalSnapshotType[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as LocalSnapshotType[];
}

function parseLimit(value?: string): number | undefined {
  return parseOptionalPositiveSafeInteger(value, "--limit");
}

export function registerLocalSnapshotCommands(program: Command) {
  program
    .command("snapshots")
    .alias("local-snapshots")
    .description("List, read, or poll local agent snapshots")
    .option("--show <type>", "Read one snapshot: projects, tasks, plans, runs, dependencies, events, or evidence")
    .option("--poll", "Poll snapshot resources and return only snapshots changed since --since")
    .option("--types <list>", "Comma-separated snapshot types for polling")
    .option("--project-id <id>", "Filter snapshots to one local project id")
    .option("--since <iso>", "Only include events or changed snapshots after this cursor")
    .option("--limit <n>", "Maximum items per snapshot", "100")
    .option("--markdown", "Render the selected snapshot as Markdown")
    .action(async (opts: {
      show?: LocalSnapshotType;
      poll?: boolean;
      types?: string;
      projectId?: string;
      since?: string;
      limit?: string;
      markdown?: boolean;
    }) => {
      const globalOpts = program.opts();
      try {
        const {
          getLocalSnapshot,
          listLocalSnapshotResources,
          pollLocalSnapshots,
          renderLocalSnapshotMarkdown,
        } = await import("../../lib/local-snapshots.js");
        const limit = parseLimit(opts.limit);

        if (opts.poll) {
          const result = pollLocalSnapshots({
            types: splitTypes(opts.types),
            project_id: opts.projectId,
            since: opts.since,
            limit,
          });
          if (globalOpts.json) {
            output(result, true);
            return;
          }
          console.log(chalk.bold(`Changed snapshots: ${result.snapshots.length}`));
          for (const snapshot of result.snapshots) {
            console.log(`  ${snapshot.type} ${chalk.dim(snapshot.cursor)} ${snapshot.fingerprint.slice(0, 12)}`);
          }
          return;
        }

        if (opts.show) {
          const snapshot = getLocalSnapshot({
            type: opts.show,
            project_id: opts.projectId,
            since: opts.since,
            limit,
          });
          if (opts.markdown) {
            process.stdout.write(renderLocalSnapshotMarkdown(snapshot));
            return;
          }
          if (globalOpts.json) {
            output(snapshot, true);
            return;
          }
          console.log(chalk.bold(`${snapshot.type} snapshot`));
          console.log(`  count: ${snapshot.count}`);
          console.log(`  cursor: ${snapshot.cursor}`);
          console.log(`  fingerprint: ${snapshot.fingerprint}`);
          return;
        }

        const resources = listLocalSnapshotResources();
        if (globalOpts.json) {
          output(resources, true);
          return;
        }
        console.log(chalk.bold(`${resources.length} local snapshot resources:\n`));
        for (const resource of resources) {
          console.log(`  ${chalk.bold(resource.type)} ${chalk.dim(resource.uri)}`);
          console.log(chalk.dim(`    ${resource.description}`));
        }
      } catch (e) {
        handleError(e);
      }
    });
}
