import { Command } from "commander";
import { serviceDiagnostic, writeDiagnosticReport } from "./service-diagnostic";

export function registerWhoami(program: Command): void {
  program.command("whoami").description("Verify authenticated HTTPS service access").action(async () => {
    writeDiagnosticReport(await serviceDiagnostic());
  });
}
