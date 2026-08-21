import type { Command } from "commander";
import { isApiClientConfigured } from "../../store-resolution.js";
import { registerInboxCommands as registerSqlite } from "./inbox.sqlite.js";
import { registerInboxCommands as registerApi } from "./inbox.api.js";

export function registerInboxCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  return (isApiClientConfigured() ? registerApi : registerSqlite)(program, output);
}
