import type { Command } from "commander";
import { monitorBrand, getSimilarDomains, getThreatAssessment } from "../../lib/brandsight.js";

export function registerMonitorCommand(program: Command): void {
  const monitor = program.command("monitor").description("Brand monitoring and threat detection (Brandsight)");

  monitor
    .command("watch <brand>")
    .description("Monitor a brand for new lookalike domain registrations")
    .option("--json", "Output JSON")
    .action(async (brand: string, opts: { json?: boolean }) => {
      try {
        const result = await monitorBrand(brand);
        if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  monitor
    .command("similar <domain>")
    .description("Find typosquat and competing domains similar to a domain")
    .option("--json", "Output JSON")
    .action(async (domain: string, opts: { json?: boolean }) => {
      try {
        const result = await getSimilarDomains(domain);
        if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  monitor
    .command("threats <domain>")
    .description("Get a threat assessment for a domain (risk level, threats, recommendation)")
    .option("--json", "Output JSON")
    .action(async (domain: string, opts: { json?: boolean }) => {
      try {
        const result = await getThreatAssessment(domain);
        if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });
}
