import type { Command } from "commander";
import { isApiClientConfigured } from "../../store-resolution.js";
import { registerEmailLogCommands as registerSqlite } from "./email-log.sqlite.js";
import { registerEmailLogCommands as registerApi } from "./email-log.api.js";

export function registerEmailLogCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  return (isApiClientConfigured() ? registerApi : registerSqlite)(program, output);
}
