import type { Command } from "commander";
import {
  monitorBrand,
  getSimilarDomains,
  getThreatAssessment,
} from "../../lib/brandsight.js";

export function registerBrandsightCommands(program: Command): void {
  program
    .command("monitor")
    .description("Monitor a brand for similar domain registrations (Brandsight)")
    .argument("<brand>", "Brand name to monitor")
    .option("--json", "Output as JSON", false)
    .action(async (brand, opts) => {
      try {
        const result = await monitorBrand(brand);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.stub) console.log("(stub data — Brandsight API unreachable)");
          console.log(`Brand monitoring for "${result.brand}":`);
          if (result.alerts.length === 0) {
            console.log("  No alerts.");
          } else {
            for (const a of result.alerts) {
              console.log(`  [${a.type}] ${a.domain} — registered ${a.registered_at}`);
            }
          }
          console.log(`\n${result.alerts.length} alert(s)`);
        }
      } catch (error: unknown) {
        console.error(`Monitor failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command("similar")
    .description("Find typosquat/competing domains similar to a domain (Brandsight)")
    .argument("<domain>", "Domain to check")
    .option("--json", "Output as JSON", false)
    .action(async (domain, opts) => {
      try {
        const result = await getSimilarDomains(domain);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.stub) console.log("(stub data — Brandsight API unreachable)");
          console.log(`Similar domains for ${result.domain}:`);
          for (const d of result.similar) {
            console.log(`  ${d}`);
          }
          console.log(`\n${result.similar.length} similar domain(s)`);
        }
      } catch (error: unknown) {
        console.error(`Similar domains check failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command("threats")
    .description("Get threat assessment for a domain (Brandsight)")
    .argument("<domain>", "Domain to assess")
    .option("--json", "Output as JSON", false)
    .action(async (domain, opts) => {
      try {
        const result = await getThreatAssessment(domain);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.stub) console.log("(stub data — Brandsight API unreachable)");
          console.log(`Threat Assessment for ${result.domain}:`);
          console.log(`  Risk Level: ${result.risk_level}`);
          if (result.threats.length > 0) {
            console.log("  Threats:");
            for (const t of result.threats) {
              console.log(`    - ${t}`);
            }
          } else {
            console.log("  Threats: none detected");
          }
          console.log(`  Recommendation: ${result.recommendation}`);
        }
      } catch (error: unknown) {
        console.error(`Threat assessment failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
