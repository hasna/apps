import type { Command } from "commander";
import { getClientMode } from "../../lib/mode.js";
import { registerInboxCommands as registerLocal } from "./inbox.local.js";
import { registerInboxCommands as registerRemote } from "./inbox.remote.js";

export function registerInboxCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  return (getClientMode() === "self_hosted" ? registerRemote : registerLocal)(program, output);
}
