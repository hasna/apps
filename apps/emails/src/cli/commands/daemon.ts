import type { Command } from "commander";
import { getClientMode } from "../../lib/mode.js";
import { registerDaemonCommands as registerLocal } from "./daemon.local.js";
import { registerDaemonCommands as registerRemote } from "./daemon.remote.js";

export function registerDaemonCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  return (getClientMode() === "self_hosted" ? registerRemote : registerLocal)(program, output);
}
