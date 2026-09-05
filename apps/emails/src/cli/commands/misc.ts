import type { Command } from "commander";
import { getClientMode } from "../../lib/mode.js";
import {
  registerMiscCommands as registerLocal,
  runSchedulerTick as runLocalSchedulerTick,
  type SchedulerTickResult,
} from "./misc.local.js";
import {
  registerMiscCommands as registerRemote,
  runSchedulerTick as runRemoteSchedulerTick,
} from "./misc.remote.js";

export type { SchedulerTickResult } from "./misc.local.js";

export async function runSchedulerTick(
  opts: Parameters<typeof runLocalSchedulerTick>[0] = {},
): Promise<SchedulerTickResult> {
  return getClientMode() === "self_hosted"
    ? runRemoteSchedulerTick(opts)
    : runLocalSchedulerTick(opts);
}

export function registerMiscCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  return (getClientMode() === "self_hosted" ? registerRemote : registerLocal)(program, output);
}
