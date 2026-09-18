import { Command } from "commander";
import { serviceDiagnostic, writeDiagnosticReport } from "./service-diagnostic";

export function registerStatus(program: Command): void {
  program.command("status").description("Verify authenticated HTTPS service access").action(async () => {
    writeDiagnosticReport(await serviceDiagnostic());
  });
}
