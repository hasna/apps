#!/usr/bin/env bun
/**
 * workflows — the CLI surface of @hasna/workflows.
 *
 * Answers --version/--help before anything else and binds nothing. The full
 * command set (14 commands) lands with the CLI slice; this scaffold ships
 * the shell plus version/health/info, all backed by WorkflowsService.
 */
import { Command } from "commander";
import { createWorkflowsService, packageVersion } from "../service.js";

const program = new Command();

program
  .name("workflows")
  .description("Universal graph workflow app — CLI surface of @hasna/workflows")
  .version(packageVersion());

program
  .command("version")
  .description("Print the installed version")
  .action(() => {
    console.log(packageVersion());
  });

program
  .command("health")
  .description("Report service health")
  .option("-j, --json", "JSON output")
  .action((opts: { json?: boolean }) => {
    const service = createWorkflowsService();
    const report = service.health();
    if (opts.json) {
      console.log(JSON.stringify(report));
    } else {
      console.log(`ok ${report.service}@${report.version} pid=${report.pid} uptimeMs=${report.uptimeMs}`);
    }
  });

program
  .command("info")
  .description("Show service configuration (never credentials)")
  .action(() => {
    const service = createWorkflowsService();
    console.log(
      JSON.stringify(
        {
          name: service.name,
          version: service.version,
          dataDir: service.config.dataDir,
          port: service.config.port,
          host: service.config.host,
          apiUrl: service.config.apiUrl ?? null,
        },
        null,
        2,
      ),
    );
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(String(err instanceof Error ? err.message : err));
  process.exit(1);
});
