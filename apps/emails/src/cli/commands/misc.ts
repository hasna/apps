import type { Command } from "commander";
import { isApiClientConfigured } from "../../store-resolution.js";
import {
  registerMiscCommands as registerSqlite,
  runSchedulerTick as runLocalSchedulerTick,
  type SchedulerTickResult,
} from "./misc.sqlite.js";
import {
  registerMiscCommands as registerApi,
  runSchedulerTick as runRemoteSchedulerTick,
} from "./misc.api.js";

export type { SchedulerTickResult } from "./misc.sqlite.js";

export async function runSchedulerTick(
  opts: Parameters<typeof runLocalSchedulerTick>[0] = {},
): Promise<SchedulerTickResult> {
  return isApiClientConfigured()
    ? runRemoteSchedulerTick(opts)
    : runLocalSchedulerTick(opts);
}

export function registerMiscCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  return (isApiClientConfigured() ? registerApi : registerSqlite)(program, output);
}
