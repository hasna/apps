import type { Command } from "commander";
import chalk from "chalk";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start the web dashboard")
    .option("--port <port>", "Port number", "19428")
    .option("--host <host>", "Host to bind (default: 127.0.0.1; a remote bind requires SECURITY_API_KEY)")
    .action(async (options) => {
      const port = parseInt(options.port, 10);
      const host = options.host || undefined;
      console.log(chalk.bold(`\n  Starting security dashboard on port ${chalk.cyan(port.toString())}...\n`));

      try {
        const serverPath = "../server/index.js";
        const server = (await import(serverPath)) as Record<string, unknown>;
        if (typeof server.startServer === "function") {
          await (server.startServer as (port: number, host?: string) => Promise<void>)(port, host);
        } else if (typeof server.default === "function") {
          await (server.default as (port: number, host?: string) => Promise<void>)(port, host);
        } else {
          console.log(chalk.yellow("  Server module loaded but no startServer function found."));
          console.log(chalk.gray("  Ensure src/server/index.ts exports a startServer(port) function.\n"));
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`  Failed to start server: ${errMsg}\n`));
        process.exit(1);
      }
    });
}
