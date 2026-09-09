import type { Command } from "commander";

/** Run the canonical authenticated service, never an account-key proxy. */
export function registerServeCommand(program: Command): void {
  program.command("serve")
    .description("Start the authenticated PostgreSQL API service")
    .option("--port <n>", "Port to listen on", "3000")
    .option("--host <h>", "Host to bind to", "127.0.0.1")
    .action(async (opts: { port: string; host: string }) => {
      const { startDomainsServer } = await import("../../server/index.js");
      await startDomainsServer({ port: Number(opts.port), host: opts.host });
    });
}
