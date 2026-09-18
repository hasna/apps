import { Command } from "commander";
import { serviceDiagnostic, writeDiagnosticReport } from "./service-diagnostic";

export function registerDoctor(program: Command): void {
  program.command("doctor").description("Verify authenticated HTTPS service access").action(async () => {
    writeDiagnosticReport(await serviceDiagnostic());
  });
}
