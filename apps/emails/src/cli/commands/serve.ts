import type { Command } from "commander";
import { resolveServerStorageBackend, type ServerStorageBackend } from "../../server/storage-backend.js";
import { requestedCommand } from "../router.js";
import { registerServeCommands as registerLocal } from "./serve.local.js";
import { registerServeCommands as registerRemote } from "./serve.remote.js";

/**
 * Which serve variant to register, for the CURRENT invocation.
 *
 * CONTROL SURFACES ANSWER BEFORE CONFIG VALIDATION (T-00101 class, row O15-04143):
 * `emails serve --help` / `--version` previously exited rc=1 with the retired-mode
 * refusal whenever the legacy deployment-mode word was present in the environment — the
 * storage resolution THROWS on a mode/store contradiction, and the throw landed
 * before commander ever got to answer the control surface. When resolution succeeds
 * the correct variant is still selected, so help text reflects the configured store
 * (e.g. the PostgreSQL service when EMAILS_DATABASE_URL is set); when it throws, the
 * control surface answers with the local variant rather than being refused. An
 * ACTUAL `serve` invocation still resolves the store and still refuses a
 * contradictory configuration.
 */
function serveVariantForInvocation(args: string[], isServe: boolean): ServerStorageBackend {
  if (!isServe) return "sqlite";
  if (args.some((arg) => arg === "--help" || arg === "-h" || arg === "--version" || arg === "-V")) {
    try {
      return resolveServerStorageBackend();
    } catch {
      return "sqlite";
    }
  }
  return resolveServerStorageBackend();
}

export function registerServeCommands(program: Command, output: (data: unknown, formatted: string) => void): void {
  // This module also owns `mcp`/`remove` and participates in the all-module fallback used
  // to render root help and unknown-command errors. Resolve the SERVER store only for an
  // actual `serve` invocation: a self-hosted CLIENT environment legitimately has no
  // EMAILS_DATABASE_URL and must not fail while registering an unrelated command.
  const args = process.argv.slice(2);
  const register = serveVariantForInvocation(args, requestedCommand(args) === "serve") === "postgresql"
    ? registerRemote
    : registerLocal;
  return register(program, output);
}
