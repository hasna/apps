import type { Command } from "commander";
import chalk from "chalk";
import { getDatabase, resolvePartialId } from "../../db/database.js";
import { handleError, output } from "../helpers.js";

function splitDays(value?: string): number[] | undefined {
  return value?.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item));
}

function resolveOptional(table: string, value?: string): string | undefined {
  if (!value) return undefined;
  const resolved = resolvePartialId(getDatabase(), table, value);
  if (!resolved) throw new Error(`Could not resolve ${table} ID: ${value}`);
  return resolved;
}

function globalOptions(program: Command): Record<string, any> {
  const command = program as Command & { optsWithGlobals?: () => Record<string, any> };
  return command.optsWithGlobals?.() ?? program.opts();
}

export function registerCapacityCommands(program: Command) {
  const capacity = program
    .command("capacity")
    .description("Manage local capacity profiles and planning forecasts");

  capacity
    .command("set <agent>")
    .description("Create or update a local agent capacity profile")
    .requiredOption("--minutes-per-day <minutes>", "Available minutes per working day")
    .option("--project <id>", "Project ID")
    .option("--days <list>", "Working days as 0-6, where 0 is Sunday", "1,2,3,4,5")
    .option("--from <date>", "Effective date")
    .action(async (agent: string, opts: { minutesPerDay: string; project?: string; days?: string; from?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { upsertCapacityProfile } = await import("../../lib/capacity-forecasts.js");
        const profile = upsertCapacityProfile({
          agent_id: agent,
          project_id: resolveOptional("projects", opts.project || globalOpts.project),
          minutes_per_day: Number(opts.minutesPerDay),
          working_days: splitDays(opts.days),
          effective_from: opts.from,
        });
        if (globalOpts.json) { output(profile, true); return; }
        console.log(chalk.green(`Capacity saved: ${profile.agent_id} ${profile.minutes_per_day}m/day`));
      } catch (e) {
        handleError(e);
      }
    });

  capacity
    .command("list")
    .description("List local capacity profiles")
    .option("--agent <id>", "Filter by agent")
    .option("--project <id>", "Filter by project")
    .action(async (opts: { agent?: string; project?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { listCapacityProfiles } = await import("../../lib/capacity-forecasts.js");
        const profiles = listCapacityProfiles({
          agent_id: opts.agent || globalOpts.agent,
          project_id: resolveOptional("projects", opts.project || globalOpts.project),
        });
        if (globalOpts.json) { output(profiles, true); return; }
        if (profiles.length === 0) { console.log(chalk.dim("No capacity profiles.")); return; }
        for (const profile of profiles) {
          console.log(`${profile.agent_id.padEnd(16)} ${String(profile.minutes_per_day).padStart(4)}m/day ${profile.project_id ?? "global"}`);
        }
      } catch (e) {
        handleError(e);
      }
    });

  capacity
    .command("remove <agent-or-id>")
    .description("Remove a local capacity profile")
    .option("--project <id>", "Project ID for agent-scoped removal")
    .action(async (agentOrId: string, opts: { project?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { removeCapacityProfile } = await import("../../lib/capacity-forecasts.js");
        const removed = removeCapacityProfile(agentOrId, opts.project ? resolveOptional("projects", opts.project) : undefined);
        if (globalOpts.json) { output({ removed }, true); return; }
        console.log(removed ? chalk.green("Capacity profile removed.") : chalk.dim("No capacity profile matched."));
      } catch (e) {
        handleError(e);
      }
    });

  capacity
    .command("forecast")
    .description("Forecast local plan or project completion from estimates and capacity")
    .option("--project <id>", "Project ID")
    .option("--plan <id>", "Plan ID")
    .option("--agent <id>", "Agent filter")
    .option("--start-date <date>", "Forecast start date")
    .option("--format <format>", "json or markdown", "json")
    .action(async (opts: { project?: string; plan?: string; agent?: string; startDate?: string; format?: string }) => {
      const globalOpts = globalOptions(program);
      try {
        const { getPlanningForecast, renderPlanningForecastMarkdown } = await import("../../lib/capacity-forecasts.js");
        const forecast = getPlanningForecast({
          project_id: resolveOptional("projects", opts.project || globalOpts.project),
          plan_id: resolveOptional("plans", opts.plan),
          agent_id: opts.agent || globalOpts.agent,
          start_date: opts.startDate,
        });
        if (opts.format === "markdown") {
          console.log(renderPlanningForecastMarkdown(forecast));
          return;
        }
        if (globalOpts.json || opts.format === "json") { output(forecast, true); return; }
        console.log(`Forecast completion: ${forecast.forecast_completion_date ?? "unknown"} (${forecast.remaining_estimated_minutes}m remaining)`);
      } catch (e) {
        handleError(e);
      }
    });
}
