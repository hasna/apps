import type { Command } from "commander";
import {
  createDnsRecord,
  listDnsRecords,
  updateDnsRecord,
  deleteDnsRecord,
  checkDnsPropagation,
  exportZoneFile,
  importZoneFile,
  discoverSubdomains,
  validateDns,
  getDomainByName,
  createDomain,
  updateDomain,
} from "../../db/domains.js";
import { readFileSync, writeFileSync } from "node:fs";
import { getDnsProvider } from "../../lib/registrar.js";
import { loadConfig } from "../../lib/config.js";

export function registerDnsCommands(program: Command): void {
  const dnsCmd = program
    .command("dns")
    .description("DNS record management");

  dnsCmd
    .command("list")
    .description("List DNS records for a domain")
    .argument("<domain-id>", "Domain ID")
    .option("--type <type>", "Filter by record type (A/AAAA/CNAME/MX/TXT/NS/SRV)")
    .option("--json", "Output as JSON", false)
    .action((domainId, opts) => {
      const records = listDnsRecords(domainId, opts.type);

      if (opts.json) {
        console.log(JSON.stringify(records, null, 2));
      } else {
        if (records.length === 0) {
          console.log("No DNS records found.");
          return;
        }
        for (const r of records) {
          const priority = r.priority !== null ? ` (priority: ${r.priority})` : "";
          console.log(`  ${r.type}\t${r.name}\t${r.value}\tTTL:${r.ttl}${priority}`);
        }
      }
    });

  dnsCmd
    .command("add")
    .description("Add a DNS record")
    .requiredOption("--domain <id>", "Domain ID")
    .requiredOption("--type <type>", "Record type (A/AAAA/CNAME/MX/TXT/NS/SRV)")
    .requiredOption("--name <name>", "Record name")
    .requiredOption("--value <value>", "Record value")
    .option("--ttl <ttl>", "TTL in seconds", "3600")
    .option("--priority <n>", "Priority (for MX/SRV)")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const record = createDnsRecord({
        domain_id: opts.domain,
        type: opts.type,
        name: opts.name,
        value: opts.value,
        ttl: parseInt(opts.ttl),
        priority: opts.priority ? parseInt(opts.priority) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(record, null, 2));
      } else {
        console.log(`Created DNS record: ${record.type} ${record.name} -> ${record.value} (${record.id})`);
      }
    });

  dnsCmd
    .command("update")
    .description("Update a DNS record")
    .argument("<id>", "Record ID")
    .option("--type <type>", "Record type")
    .option("--name <name>", "Record name")
    .option("--value <value>", "Record value")
    .option("--ttl <ttl>", "TTL in seconds")
    .option("--priority <n>", "Priority")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const input: Record<string, unknown> = {};
      if (opts.type !== undefined) input.type = opts.type;
      if (opts.name !== undefined) input.name = opts.name;
      if (opts.value !== undefined) input.value = opts.value;
      if (opts.ttl !== undefined) input.ttl = parseInt(opts.ttl);
      if (opts.priority !== undefined) input.priority = parseInt(opts.priority);

      const record = updateDnsRecord(id, input);
      if (!record) {
        console.error(`DNS record '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(record, null, 2));
      } else {
        console.log(`Updated DNS record: ${record.type} ${record.name} -> ${record.value}`);
      }
    });

  dnsCmd
    .command("remove")
    .description("Remove a DNS record")
    .argument("<id>", "Record ID")
    .action((id) => {
      const deleted = deleteDnsRecord(id);
      if (deleted) {
        console.log(`Deleted DNS record ${id}`);
      } else {
        console.error(`DNS record '${id}' not found.`);
        process.exit(1);
      }
    });

  dnsCmd
    .command("check-propagation")
    .description("Check DNS propagation across multiple servers")
    .argument("<domain>", "Domain name to check")
    .option("--record <type>", "Record type (A/AAAA/CNAME/MX/TXT/NS)", "A")
    .option("--json", "Output as JSON", false)
    .action((domain, opts) => {
      const result = checkDnsPropagation(domain, opts.record);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`DNS Propagation for ${result.domain} (${result.record_type}):`);
        console.log(`  Consistent: ${result.consistent ? "yes" : "NO"}`);
        for (const s of result.servers) {
          const values = s.values.length > 0 ? s.values.join(", ") : "(empty)";
          const status = s.status === "error" ? ` [ERROR: ${s.error}]` : "";
          console.log(`  ${s.name} (${s.server}): ${values}${status}`);
        }
      }
    });

  dnsCmd
    .command("export")
    .description("Export DNS records as BIND zone file")
    .argument("<domain-id>", "Domain ID")
    .option("--output <file>", "Write to file instead of stdout")
    .action((domainId, opts) => {
      const zone = exportZoneFile(domainId);
      if (!zone) {
        console.error(`Domain '${domainId}' not found.`);
        process.exit(1);
      }
      if (opts.output) {
        writeFileSync(opts.output, zone, "utf-8");
        console.log(`Exported zone file to ${opts.output}`);
      } else {
        console.log(zone);
      }
    });

  dnsCmd
    .command("import")
    .description("Import DNS records from a BIND zone file")
    .argument("<domain-id>", "Domain ID")
    .requiredOption("--file <path>", "Path to zone file")
    .option("--json", "Output as JSON", false)
    .action((domainId, opts) => {
      let content: string;
      try {
        content = readFileSync(opts.file, "utf-8");
      } catch {
        console.error(`Could not read file: ${opts.file}`);
        process.exit(1);
      }

      const result = importZoneFile(domainId, content);
      if (!result) {
        console.error(`Domain '${domainId}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Imported ${result.imported} record(s), skipped ${result.skipped}`);
        if (result.errors.length > 0) {
          console.log("Errors:");
          for (const e of result.errors) {
            console.log(`  - ${e}`);
          }
        }
      }
    });

  dnsCmd
    .command("discover-subdomains")
    .description("Discover subdomains via certificate transparency logs (crt.sh)")
    .argument("<domain>", "Domain name")
    .option("--json", "Output as JSON", false)
    .action(async (domain, opts) => {
      const result = await discoverSubdomains(domain);
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (result.error) {
          console.error(`Discovery failed: ${result.error}`);
          process.exit(1);
        }
        if (result.subdomains.length === 0) {
          console.log(`No subdomains found for ${domain}.`);
          return;
        }
        console.log(`Subdomains for ${domain} (source: ${result.source}):`);
        for (const s of result.subdomains) {
          console.log(`  ${s}`);
        }
        console.log(`\n${result.subdomains.length} subdomain(s) found`);
      }
    });

  dnsCmd
    .command("validate")
    .description("Validate DNS records for common issues")
    .argument("<domain-id>", "Domain ID")
    .option("--json", "Output as JSON", false)
    .action((domainId, opts) => {
      const result = validateDns(domainId);
      if (!result) {
        console.error(`Domain '${domainId}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`DNS Validation for ${result.domain_name}:`);
        console.log(`  Valid: ${result.valid ? "yes" : "NO"}`);
        if (result.issues.length === 0) {
          console.log("  No issues found.");
        } else {
          for (const issue of result.issues) {
            const prefix = issue.type === "error" ? "ERROR" : "WARN";
            console.log(`  [${prefix}] ${issue.message}`);
          }
        }
      }
    });

  // ── pull: live provider → local DB ────────────────────────────────────

  dnsCmd
    .command("pull <domain>")
    .description("Pull live DNS records from provider into local DB")
    .option("--provider <name>", "DNS provider (route53, cloudflare) — defaults to config default-dns")
    .action(async (domain: string, opts: { provider?: string }) => {
      const providerName = opts.provider ?? loadConfig().default_dns ?? "route53";
      try {
        const provider = getDnsProvider(providerName);
        const records = await provider.getDnsRecords(domain);
        const dbDomain = getDomainByName(domain);
        if (!dbDomain) {
          console.error(`Domain '${domain}' not found in local DB. Add it first: domains domain add --name ${domain}`);
          process.exit(1);
        }
        let count = 0;
        for (const r of records) {
          createDnsRecord({ domain_id: dbDomain.id, type: r.type as "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV", name: r.name, value: r.value, ttl: r.ttl, priority: r.priority });
          count++;
        }
        console.log(`✓ Pulled ${count} record(s) from ${providerName} into local DB for ${domain}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ── push: local DB → live provider ────────────────────────────────────

  dnsCmd
    .command("push <domain-id>")
    .description("Push local DB records to live DNS provider")
    .option("--provider <name>", "DNS provider — defaults to config default-dns")
    .action(async (domainId: string, opts: { provider?: string }) => {
      const providerName = opts.provider ?? loadConfig().default_dns ?? "route53";
      try {
        const records = listDnsRecords(domainId);
        if (records.length === 0) { console.log("No local DNS records to push."); return; }
        const dbDomain = getDomainByName(domainId) ?? (() => { throw new Error(`Domain '${domainId}' not found`); })();
        const provider = getDnsProvider(providerName);
        await provider.setDnsRecords(dbDomain.name, records.map((r) => ({
          type: r.type, name: r.name, value: r.value, ttl: r.ttl, priority: r.priority ?? undefined,
        })));
        console.log(`✓ Pushed ${records.length} record(s) to ${providerName} for ${dbDomain.name}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });
}
