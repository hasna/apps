import type { Command } from "commander";
import { checkSsl, listSslExpiring } from "../../db/domains.js";

export function registerSslCommand(program: Command): void {
  const ssl = program.command("ssl").description("SSL certificate management");

  ssl
    .command("check <domain>")
    .description("Check SSL certificate for a domain and update the local DB record")
    .option("--json", "Output JSON")
    .action((domain: string, opts: { json?: boolean }) => {
      const result = checkSsl(domain);
      if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
      console.log(`\nSSL Certificate for ${result.domain}:`);
      if (result.error) {
        console.log(`  Error: ${result.error}`);
      } else {
        console.log(`  Issuer:  ${result.issuer ?? "unknown"}`);
        console.log(`  Expires: ${result.expires_at ? result.expires_at.split("T")[0] : "unknown"}`);
      }
      console.log();
    });

  ssl
    .command("expiring")
    .description("List domains with SSL certificates expiring soon")
    .option("--days <n>", "Days threshold", "30")
    .option("--json", "Output JSON")
    .action((opts: { days: string; json?: boolean }) => {
      const domains = listSslExpiring(parseInt(opts.days));
      if (opts.json) { console.log(JSON.stringify(domains, null, 2)); return; }
      if (domains.length === 0) {
        console.log(`No SSL certificates expiring within ${opts.days} days.`);
        return;
      }
      console.log(`\nSSL expiring within ${opts.days} days:`);
      for (const d of domains) {
        const exp = d.ssl_expires_at ? d.ssl_expires_at.split("T")[0] : "unknown";
        console.log(`  ${d.name.padEnd(40)} expires ${exp}`);
      }
      console.log();
    });
}
