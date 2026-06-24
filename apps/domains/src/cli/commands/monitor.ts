import type { Command } from "commander";
import { monitorBrand, getSimilarDomains, getThreatAssessment } from "../../lib/brandsight.js";
import { compactHint, pageItemsOrExit, truncateText } from "../../lib/compact-output.js";

export function registerMonitorCommand(program: Command): void {
  const monitor = program.command("monitor").description("Brand monitoring and threat detection (Brandsight)");

  monitor
    .command("watch <brand>")
    .description("Monitor a brand for new lookalike domain registrations")
    .option("--limit <n>", "Limit number of displayed alerts")
    .option("--all", "Show all returned alerts")
    .option("--json", "Output JSON")
    .action(async (brand: string, opts: { limit?: string; all?: boolean; json?: boolean }) => {
      try {
        const result = await monitorBrand(brand);
        if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
        const page = pageItemsOrExit(result.alerts, { limit: opts.limit, all: opts.all });
        console.log(`Monitor: ${result.brand}${result.stub ? " [stub]" : ""}`);
        if (page.items.length === 0) {
          console.log("No alerts.");
          return;
        }
        for (const alert of page.items) {
          console.log(`  ${alert.domain} [${alert.type}] registered:${alert.registered_at}`);
        }
        console.log(`\n${compactHint(page, "alert(s)", "Use --all for every alert or --json for full monitor details.", { paging: "limit" })}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  monitor
    .command("similar <domain>")
    .description("Find typosquat and competing domains similar to a domain")
    .option("--limit <n>", "Limit number of displayed domains")
    .option("--all", "Show all returned domains")
    .option("--json", "Output JSON")
    .action(async (domain: string, opts: { limit?: string; all?: boolean; json?: boolean }) => {
      try {
        const result = await getSimilarDomains(domain);
        if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
        const page = pageItemsOrExit(result.similar, { limit: opts.limit, all: opts.all });
        console.log(`Similar domains for ${result.domain}${result.stub ? " [stub]" : ""}:`);
        if (page.items.length === 0) {
          console.log("No similar domains found.");
          return;
        }
        for (const name of page.items) console.log(`  ${name}`);
        console.log(`\n${compactHint(page, "domain(s)", "Use --all for every result or --json for full response metadata.", { paging: "limit" })}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  monitor
    .command("threats <domain>")
    .description("Get a threat assessment for a domain (risk level, threats, recommendation)")
    .option("--limit <n>", "Limit number of displayed threats")
    .option("--all", "Show all returned threats")
    .option("--json", "Output JSON")
    .action(async (domain: string, opts: { limit?: string; all?: boolean; json?: boolean }) => {
      try {
        const result = await getThreatAssessment(domain);
        if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
        const page = pageItemsOrExit(result.threats, { limit: opts.limit, all: opts.all });
        console.log(`Threat assessment for ${result.domain}${result.stub ? " [stub]" : ""}: ${result.risk_level}`);
        if (page.items.length === 0) {
          console.log("No immediate threats detected.");
        } else {
          for (const threat of page.items) console.log(`  - ${truncateText(threat, 100)}`);
        }
        console.log(`Recommendation: ${truncateText(result.recommendation, 140)}`);
        console.log(`\n${compactHint(page, "threat(s)", "Use --all for every threat or --json for the full assessment.", { paging: "limit" })}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });
}
