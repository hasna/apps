import type { Command } from "commander";
import { isApiClientConfigured } from "../../store-resolution.js";
import { registerSyncCommands as registerSqlite } from "./sync.sqlite.js";
import { registerSyncCommands as registerApi } from "./sync.api.js";

export function registerSyncCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  return (isApiClientConfigured() ? registerApi : registerSqlite)(program, output);
}
