import type { Command } from "commander";
import { printLine, printErrorLine } from "../../lib/stdout.js";
import {
  createAlert,
  listAlerts,
  deleteAlert,
} from "../../db/domains.js";

export function registerAlertCommands(program: Command): void {
  const alertCmd = program
    .command("alert")
    .description("Alert management");

  alertCmd
    .command("set")
    .description("Set an alert for a domain")
    .requiredOption("--domain <id>", "Domain ID")
    .requiredOption("--type <type>", "Alert type (expiry/ssl_expiry/dns_change)")
    .option("--days-before <n>", "Trigger N days before")
    .option("--json", "Output as JSON", false)
    .action(async (opts) => {
      const alert = await createAlert({
        domain_id: opts.domain,
        type: opts.type,
        trigger_days_before: opts.daysBefore ? parseInt(opts.daysBefore) : undefined,
      });

      if (opts.json) {
        printLine(JSON.stringify(alert, null, 2));
      } else {
        const daysBefore = alert.trigger_days_before ? ` (${alert.trigger_days_before} days before)` : "";
        printLine(`Created alert: ${alert.type}${daysBefore} for domain ${alert.domain_id} (${alert.id})`);
      }
    });

  alertCmd
    .command("list")
    .description("List alerts for a domain")
    .argument("<domain-id>", "Domain ID")
    .option("--json", "Output as JSON", false)
    .action(async (domainId, opts) => {
      const alerts = await listAlerts(domainId);

      if (opts.json) {
        printLine(JSON.stringify(alerts, null, 2));
      } else {
        if (alerts.length === 0) {
          printLine("No alerts set.");
          return;
        }
        for (const a of alerts) {
          const daysBefore = a.trigger_days_before ? ` (${a.trigger_days_before} days before)` : "";
          const sent = a.sent_at ? ` — sent ${a.sent_at}` : "";
          printLine(`  ${a.type}${daysBefore}${sent}`);
        }
      }
    });

  alertCmd
    .command("remove")
    .description("Remove an alert")
    .argument("<id>", "Alert ID")
    .action(async (id) => {
      const deleted = await deleteAlert(id);
      if (deleted) {
        printLine(`Deleted alert ${id}`);
      } else {
        printErrorLine(`Alert '${id}' not found.`);
        process.exit(1);
      }
    });
}
