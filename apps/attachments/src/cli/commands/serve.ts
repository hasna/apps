import { Command } from "commander";
import { startServer } from "../../api/server";
import { getConfig, validateStorageConfig } from "../../core/config";
import { resolveInternalBindHost } from "../../core/internal-link";
import { exitError } from "../utils";

async function waitForShutdown(): Promise<void> {
  if (process.env["ATTACHMENTS_SERVE_EXIT_AFTER_START"] === "1") {
    // Test/CI hook: report the bind, then exit deterministically (the live
    // server keeps the event loop busy otherwise).
    process.exit(0);
  }

  await new Promise<void>((resolve) => {
    const done = () => resolve();
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
  process.exit(0);
}

export function registerServe(program: Command): void {
  program
    .command("serve")
    .description("Start the app's HTTP server on the on-box store")
    .option("--port <number>", "Port to listen on (overrides config)")
    .option("--host <string>", "Host to bind to", "localhost")
    .option("--internal", "Bind to the local Tailscale address for internal-only sharing")
    .action(async (options: { port?: string; host?: string; internal?: boolean }) => {
      try {
        validateStorageConfig();
      } catch (err: unknown) {
        exitError(err instanceof Error ? err.message : String(err));
      }

      const config = getConfig();
      const port = options.port ? parseInt(options.port, 10) : config.server.port;
      const internal = options.internal ? resolveInternalBindHost({ ...config, server: { ...config.server, port } }) : null;
      const host = internal?.host ?? options.host ?? config.server.host;

      if (isNaN(port) || port <= 0 || port > 65535) {
        exitError(`Invalid port: ${options.port}`);
      }

      startServer(port, host);
      process.stdout.write(`✓ attachments server running at http://${host}:${port} (on-box store)\n`);
      if (internal) {
        process.stdout.write(`  Internal URL: ${internal.baseUrl}\n`);
        process.stdout.write(`  Access: Tailscale-only bind (${internal.source})\n`);
      }
      await waitForShutdown();
    });
}
