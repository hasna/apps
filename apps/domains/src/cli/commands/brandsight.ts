import type { Command } from "commander";
import {
  monitorBrand,
  getSimilarDomains,
  getThreatAssessment,
} from "../../lib/brandsight.js";
import { compactHint, pageItemsOrExit, truncateText } from "../../lib/compact-output.js";

export function registerBrandsightCommands(program: Command): void {
  program
    .command("monitor")
    .description("Monitor a brand for similar domain registrations (Brandsight)")
    .argument("<brand>", "Brand name to monitor")
    .option("--limit <n>", "Limit number of displayed alerts")
    .option("--all", "Show all returned alerts")
    .option("--json", "Output as JSON", false)
    .action(async (brand, opts) => {
      try {
        const result = await monitorBrand(brand);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const page = pageItemsOrExit(result.alerts, { limit: opts.limit, all: opts.all });
          if (result.stub) console.log("(stub data — Brandsight API unreachable)");
          console.log(`Brand monitoring for "${result.brand}":`);
          if (page.items.length === 0) {
            console.log("  No alerts.");
          } else {
            for (const a of page.items) {
              console.log(`  [${a.type}] ${a.domain} — registered ${a.registered_at}`);
            }
          }
          console.log(`\n${compactHint(page, "alert(s)", "Use --all for every alert or --json for full monitor details.", { paging: "limit" })}`);
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
    .option("--limit <n>", "Limit number of displayed domains")
    .option("--all", "Show all returned domains")
    .option("--json", "Output as JSON", false)
    .action(async (domain, opts) => {
      try {
        const result = await getSimilarDomains(domain);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const page = pageItemsOrExit(result.similar, { limit: opts.limit, all: opts.all });
          if (result.stub) console.log("(stub data — Brandsight API unreachable)");
          console.log(`Similar domains for ${result.domain}:`);
          for (const d of page.items) {
            console.log(`  ${d}`);
          }
          console.log(`\n${compactHint(page, "similar domain(s)", "Use --all for every result or --json for full response metadata.", { paging: "limit" })}`);
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
    .option("--limit <n>", "Limit number of displayed threats")
    .option("--all", "Show all returned threats")
    .option("--json", "Output as JSON", false)
    .action(async (domain, opts) => {
      try {
        const result = await getThreatAssessment(domain);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const page = pageItemsOrExit(result.threats, { limit: opts.limit, all: opts.all });
          if (result.stub) console.log("(stub data — Brandsight API unreachable)");
          console.log(`Threat Assessment for ${result.domain}:`);
          console.log(`  Risk Level: ${result.risk_level}`);
          if (page.items.length > 0) {
            console.log("  Threats:");
            for (const t of page.items) {
              console.log(`    - ${truncateText(t, 100)}`);
            }
          } else {
            console.log("  Threats: none detected");
          }
          console.log(`  Recommendation: ${truncateText(result.recommendation, 140)}`);
          console.log(`\n${compactHint(page, "threat(s)", "Use --all for every threat or --json for the full assessment.", { paging: "limit" })}`);
        }
      } catch (error: unknown) {
        console.error(`Threat assessment failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
