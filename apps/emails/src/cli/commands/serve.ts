import type { Command } from "commander";
import { resolveServerStorageBackend } from "../../server/storage-backend.js";
import { requestedCommand } from "../router.js";
import { registerServeCommands as registerSqlite } from "./serve.sqlite.js";
import { registerServeCommands as registerApi } from "./serve.api.js";

export function registerServeCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  // This module also owns `mcp`/`remove` and participates in the all-module fallback used
  // to render root help and unknown-command errors. Resolve the SERVER store only for an
  // actual `serve` invocation: a self-hosted CLIENT environment legitimately has no
  // HASNA_EMAILS_DATABASE_URL and must not fail while registering an unrelated command.
  const register = requestedCommand(process.argv.slice(2)) === "serve"
    ? (resolveServerStorageBackend() === "postgresql" ? registerApi : registerSqlite)
    : registerSqlite;
  return register(program, output);
}
