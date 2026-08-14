import type { Command } from "commander";
import {
  monitorBrand,
  getSimilarDomains,
  getThreatAssessment,
} from "../../lib/brandsight.js";
import { compactHint, pageItemsOrExit, truncateText } from "../../lib/compact-output.js";

import { printLine, printErrorLine } from "../../lib/stdout.js";
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
          printLine(JSON.stringify(result, null, 2));
        } else {
          const page = pageItemsOrExit(result.alerts, { limit: opts.limit, all: opts.all });
          if (result.stub) printLine("(stub data — Brandsight API unreachable)");
          printLine(`Brand monitoring for "${result.brand}":`);
          if (page.items.length === 0) {
            printLine("  No alerts.");
          } else {
            for (const a of page.items) {
              printLine(`  [${a.type}] ${a.domain} — registered ${a.registered_at}`);
            }
          }
          printLine(`\n${compactHint(page, "alert(s)", "Use --all for every alert or --json for full monitor details.", { paging: "limit" })}`);
        }
      } catch (error: unknown) {
        printErrorLine(`Monitor failed: ${error instanceof Error ? error.message : String(error)}`);
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
          printLine(JSON.stringify(result, null, 2));
        } else {
          const page = pageItemsOrExit(result.similar, { limit: opts.limit, all: opts.all });
          if (result.stub) printLine("(stub data — Brandsight API unreachable)");
          printLine(`Similar domains for ${result.domain}:`);
          for (const d of page.items) {
            printLine(`  ${d}`);
          }
          printLine(`\n${compactHint(page, "similar domain(s)", "Use --all for every result or --json for full response metadata.", { paging: "limit" })}`);
        }
      } catch (error: unknown) {
        printErrorLine(`Similar domains check failed: ${error instanceof Error ? error.message : String(error)}`);
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
          printLine(JSON.stringify(result, null, 2));
        } else {
          const page = pageItemsOrExit(result.threats, { limit: opts.limit, all: opts.all });
          if (result.stub) printLine("(stub data — Brandsight API unreachable)");
          printLine(`Threat Assessment for ${result.domain}:`);
          printLine(`  Risk Level: ${result.risk_level}`);
          if (page.items.length > 0) {
            printLine("  Threats:");
            for (const t of page.items) {
              printLine(`    - ${truncateText(t, 100)}`);
            }
          } else {
            printLine("  Threats: none detected");
          }
          printLine(`  Recommendation: ${truncateText(result.recommendation, 140)}`);
          printLine(`\n${compactHint(page, "threat(s)", "Use --all for every threat or --json for the full assessment.", { paging: "limit" })}`);
        }
      } catch (error: unknown) {
        printErrorLine(`Threat assessment failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });
}
