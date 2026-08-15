import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase } from "../../db/database.js";
import { createLocalPrGroupLedger } from "../../pr-groups/index.js";
import { cloudGetPrGroup, cloudPrGroupEvents, getTodosCloudClient } from "../cloud-router.js";
import { handleError, output } from "../helpers.js";

function globalOptions(program: Command): Record<string, unknown> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, unknown> };
  return command.optsWithGlobals?.() ?? program.opts();
}

function parseInteger(value: string | undefined, field: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${field} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function registerPrGroupCommands(program: Command): void {
  const plans = program.commands.find((command) => command.name() === "plans");
  if (!plans) throw new Error("plans command must be registered before PR-group views");
  const prGroup = plans
    .command("pr-group")
    .description("Read authoritative PR-group execution state and event history");

  prGroup
    .command("show <group-id>")
    .description("Show the bounded authoritative state projection for a PR group")
    .option("-j, --json", "Output as JSON")
    .action(async (groupId: string, opts: { json?: boolean }) => {
      try {
        const remote = getTodosCloudClient();
        const view = remote
          ? await cloudGetPrGroup(remote, groupId)
          : await createLocalPrGroupLedger(getDatabase()).get(groupId);
        if (opts.json || globalOptions(program)["json"]) {
          output(view, true);
          return;
        }
        console.log(`${chalk.bold(view.group.id)} ${view.group.state} revision=${view.group.revision}`);
        console.log(`authority=${view.authority} attempts=${view.attempts.length} events=${view.diagnostics.event_count}`);
      } catch (error) {
        handleError(error);
      }
    });

  prGroup
    .command("events <group-id>")
    .description("Show a bounded page of authoritative PR-group events")
    .option("--after-sequence <n>", "Only return events after this sequence")
    .option("--limit <n>", "Maximum events to return (1-500)", "100")
    .option("-j, --json", "Output as JSON")
    .action(async (groupId: string, opts: { afterSequence?: string; limit?: string; json?: boolean }) => {
      try {
        const options = {
          limit: parseInteger(opts.limit, "--limit", 1, 500),
          after_sequence: parseInteger(opts.afterSequence, "--after-sequence", 0, Number.MAX_SAFE_INTEGER),
        };
        const remote = getTodosCloudClient();
        const history = remote
          ? await cloudPrGroupEvents(remote, groupId, options)
          : await createLocalPrGroupLedger(getDatabase()).events(groupId, options);
        if (opts.json || globalOptions(program)["json"]) {
          output(history, true);
          return;
        }
        console.log(`${chalk.bold(history.group_id)} events=${history.count} authority=${history.authority}`);
        for (const event of history.events) {
          console.log(`${String(event.sequence).padStart(4)} ${event.event_type} ${event.state}`);
        }
      } catch (error) {
        handleError(error);
      }
    });
}
