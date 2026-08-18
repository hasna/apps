import type { Command } from "commander";
import { isApiClientConfigured } from "../../store-resolution.js";
import { registerDaemonCommands as registerSqlite } from "./daemon.sqlite.js";
import { registerDaemonCommands as registerApi } from "./daemon.api.js";

export function registerDaemonCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  return (isApiClientConfigured() ? registerApi : registerSqlite)(program, output);
}
