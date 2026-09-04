import { Command } from "commander";
import { serviceDiagnostic } from "./service-diagnostic";

export function registerStatus(program: Command): void {
  program.command("status").description("Verify authenticated HTTPS service access").action(async () => {
    const result = await serviceDiagnostic();
    process.stdout.write(result.lines.join("\n") + "\n");
    if (!result.ok) process.exitCode = 1;
  });
}
