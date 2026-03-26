import type { Command } from "commander";
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
    .action((opts) => {
      const alert = createAlert({
        domain_id: opts.domain,
        type: opts.type,
        trigger_days_before: opts.daysBefore ? parseInt(opts.daysBefore) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(alert, null, 2));
      } else {
        const daysBefore = alert.trigger_days_before ? ` (${alert.trigger_days_before} days before)` : "";
        console.log(`Created alert: ${alert.type}${daysBefore} for domain ${alert.domain_id} (${alert.id})`);
      }
    });

  alertCmd
    .command("list")
    .description("List alerts for a domain")
    .argument("<domain-id>", "Domain ID")
    .option("--json", "Output as JSON", false)
    .action((domainId, opts) => {
      const alerts = listAlerts(domainId);

      if (opts.json) {
        console.log(JSON.stringify(alerts, null, 2));
      } else {
        if (alerts.length === 0) {
          console.log("No alerts set.");
          return;
        }
        for (const a of alerts) {
          const daysBefore = a.trigger_days_before ? ` (${a.trigger_days_before} days before)` : "";
          const sent = a.sent_at ? ` — sent ${a.sent_at}` : "";
          console.log(`  ${a.type}${daysBefore}${sent}`);
        }
      }
    });

  alertCmd
    .command("remove")
    .description("Remove an alert")
    .argument("<id>", "Alert ID")
    .action((id) => {
      const deleted = deleteAlert(id);
      if (deleted) {
        console.log(`Deleted alert ${id}`);
      } else {
        console.error(`Alert '${id}' not found.`);
        process.exit(1);
      }
    });
}
