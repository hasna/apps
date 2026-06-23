import type { Command } from "commander";
import {
  createDomain,
  getDomain,
  listDomains,
  updateDomain,
  deleteDomain,
  searchDomains,
  listExpiring,
  listSslExpiring,
  getDomainStats,
  checkAllDomains,
  whoisLookup,
  checkSsl,
  exportPortfolio,
  getDomainByName,
} from "../../db/domains.js";
import { listDnsRecords } from "../../db/dns-records.js";
import { validateDns } from "../../db/dns-tools.js";
import { getDomainReputationByName } from "../../db/domain-reputation.js";
import { listDomainOffers } from "../../db/domain-records.js";
import { writeFileSync } from "node:fs";

export function registerDomainCommands(program: Command): void {
  program
    .command("add")
    .description("Add a new domain")
    .requiredOption("--name <name>", "Domain name (e.g. example.com)")
    .option("--registrar <registrar>", "Domain registrar")
    .option("--status <status>", "Status (active/expired/transferring/redemption)", "active")
    .option("--registered-at <date>", "Registration date (ISO)")
    .option("--expires-at <date>", "Expiration date (ISO)")
    .option("--no-auto-renew", "Disable auto-renew")
    .option("--nameservers <ns>", "Comma-separated nameservers")
    .option("--ssl-expires-at <date>", "SSL expiration date (ISO)")
    .option("--ssl-issuer <issuer>", "SSL certificate issuer")
    .option("--notes <notes>", "Notes")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const domain = createDomain({
        name: opts.name,
        registrar: opts.registrar,
        status: opts.status,
        registered_at: opts.registeredAt,
        expires_at: opts.expiresAt,
        auto_renew: opts.autoRenew,
        nameservers: opts.nameservers
          ? opts.nameservers.split(",").map((s: string) => s.trim())
          : undefined,
        ssl_expires_at: opts.sslExpiresAt,
        ssl_issuer: opts.sslIssuer,
        notes: opts.notes,
      });

      if (opts.json) {
        console.log(JSON.stringify(domain, null, 2));
      } else {
        console.log(`Created domain: ${domain.name} (${domain.id})`);
      }
    });

  program
    .command("get")
    .description("Get a domain by ID")
    .argument("<id>", "Domain ID")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const domain = getDomain(id);
      if (!domain) {
        console.error(`Domain '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(domain, null, 2));
      } else {
        console.log(`${domain.name} [${domain.status}]`);
        if (domain.registrar) console.log(`  Registrar: ${domain.registrar}`);
        if (domain.expires_at) console.log(`  Expires: ${domain.expires_at}`);
        if (domain.ssl_expires_at) console.log(`  SSL Expires: ${domain.ssl_expires_at}`);
        if (domain.ssl_issuer) console.log(`  SSL Issuer: ${domain.ssl_issuer}`);
        console.log(`  Auto-renew: ${domain.auto_renew ? "yes" : "no"}`);
        if (domain.nameservers.length) console.log(`  Nameservers: ${domain.nameservers.join(", ")}`);
        if (domain.notes) console.log(`  Notes: ${domain.notes}`);
      }
    });

  program
    .command("list")
    .description("List domains")
    .option("--search <query>", "Search by name, registrar, or notes")
    .option("--status <status>", "Filter by status")
    .option("--registrar <registrar>", "Filter by registrar")
    .option("--limit <n>", "Limit results")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const domains = listDomains({
        search: opts.search,
        status: opts.status,
        registrar: opts.registrar,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify(domains, null, 2));
      } else {
        if (domains.length === 0) {
          console.log("No domains found.");
          return;
        }
        for (const d of domains) {
          const expires = d.expires_at ? ` (expires ${d.expires_at})` : "";
          console.log(`  ${d.name} [${d.status}]${expires}`);
        }
        console.log(`\n${domains.length} domain(s)`);
      }
    });

  program
    .command("update")
    .description("Update a domain")
    .argument("<id>", "Domain ID")
    .option("--name <name>", "Domain name")
    .option("--registrar <registrar>", "Registrar")
    .option("--status <status>", "Status")
    .option("--registered-at <date>", "Registration date")
    .option("--expires-at <date>", "Expiration date")
    .option("--auto-renew <bool>", "Auto-renew (true/false)")
    .option("--nameservers <ns>", "Comma-separated nameservers")
    .option("--ssl-expires-at <date>", "SSL expiration date")
    .option("--ssl-issuer <issuer>", "SSL issuer")
    .option("--notes <notes>", "Notes")
    .option("--json", "Output as JSON", false)
    .action((id, opts) => {
      const input: Record<string, unknown> = {};
      if (opts.name !== undefined) input.name = opts.name;
      if (opts.registrar !== undefined) input.registrar = opts.registrar;
      if (opts.status !== undefined) input.status = opts.status;
      if (opts.registeredAt !== undefined) input.registered_at = opts.registeredAt;
      if (opts.expiresAt !== undefined) input.expires_at = opts.expiresAt;
      if (opts.autoRenew !== undefined) input.auto_renew = opts.autoRenew === "true";
      if (opts.nameservers !== undefined)
        input.nameservers = opts.nameservers.split(",").map((s: string) => s.trim());
      if (opts.sslExpiresAt !== undefined) input.ssl_expires_at = opts.sslExpiresAt;
      if (opts.sslIssuer !== undefined) input.ssl_issuer = opts.sslIssuer;
      if (opts.notes !== undefined) input.notes = opts.notes;

      const domain = updateDomain(id, input);
      if (!domain) {
        console.error(`Domain '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(domain, null, 2));
      } else {
        console.log(`Updated: ${domain.name}`);
      }
    });

  program
    .command("delete")
    .description("Delete a domain")
    .argument("<id>", "Domain ID")
    .action((id) => {
      const deleted = deleteDomain(id);
      if (deleted) {
        console.log(`Deleted domain ${id}`);
      } else {
        console.error(`Domain '${id}' not found.`);
        process.exit(1);
      }
    });

  program
    .command("search")
    .description("Search domains")
    .argument("<query>", "Search term")
    .option("--json", "Output as JSON", false)
    .action((query, opts) => {
      const results = searchDomains(query);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log(`No domains matching "${query}".`);
          return;
        }
        for (const d of results) {
          console.log(`  ${d.name} [${d.status}]`);
        }
      }
    });

  program
    .command("expiring")
    .description("List domains expiring within N days")
    .option("--days <n>", "Number of days ahead", "30")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const days = parseInt(opts.days);
      const domains = listExpiring(days);

      if (opts.json) {
        console.log(JSON.stringify(domains, null, 2));
      } else {
        if (domains.length === 0) {
          console.log(`No domains expiring within ${days} days.`);
          return;
        }
        console.log(`Domains expiring within ${days} days:`);
        for (const d of domains) {
          console.log(`  ${d.name} — expires ${d.expires_at}`);
        }
      }
    });

  program
    .command("ssl")
    .description("List domains with SSL expiring within N days")
    .option("--days <n>", "Number of days ahead", "30")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const days = parseInt(opts.days);
      const domains = listSslExpiring(days);

      if (opts.json) {
        console.log(JSON.stringify(domains, null, 2));
      } else {
        if (domains.length === 0) {
          console.log(`No SSL certificates expiring within ${days} days.`);
          return;
        }
        console.log(`SSL certificates expiring within ${days} days:`);
        for (const d of domains) {
          console.log(`  ${d.name} — SSL expires ${d.ssl_expires_at} (${d.ssl_issuer || "unknown issuer"})`);
        }
      }
    });

  program
    .command("stats")
    .description("Show domain portfolio statistics")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const stats = getDomainStats();

      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log("Domain Portfolio Stats:");
        console.log(`  Total: ${stats.total}`);
        console.log(`  Active: ${stats.active}`);
        console.log(`  Expired: ${stats.expired}`);
        console.log(`  Transferring: ${stats.transferring}`);
        console.log(`  Redemption: ${stats.redemption}`);
        console.log(`  Auto-renew enabled: ${stats.auto_renew_enabled}`);
        console.log(`  Expiring (30 days): ${stats.expiring_30_days}`);
        console.log(`  SSL expiring (30 days): ${stats.ssl_expiring_30_days}`);
      }
    });

  program
    .command("whois")
    .description("Run WHOIS lookup for a domain and update DB record")
    .argument("<name>", "Domain name (e.g. example.com)")
    .option("--json", "Output as JSON", false)
    .action((name, opts) => {
      try {
        const result = whoisLookup(name);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(`WHOIS for ${result.domain} [${result.source}]:`);
          console.log(`  Registrar: ${result.registrar || "unknown"}`);
          console.log(`  Expires: ${result.expires_at || "unknown"}`);
          if (result.nameservers.length > 0) {
            console.log(`  Nameservers: ${result.nameservers.join(", ")}`);
          }
          const r = result.registrant;
          if (r?.name || r?.email || r?.organization) {
            console.log(`  Registrant:`);
            if (r.name) console.log(`    Name: ${r.name}`);
            if (r.email) console.log(`    Email: ${r.email}`);
            if (r.phone) console.log(`    Phone: ${r.phone}`);
            if (r.organization) console.log(`    Org: ${r.organization}`);
          }
        }
      } catch (error: unknown) {
        console.error(`WHOIS lookup failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command("ssl-check")
    .description("Check SSL certificate for a domain and update DB record")
    .argument("<name>", "Domain name (e.g. example.com)")
    .option("--json", "Output as JSON", false)
    .action((name, opts) => {
      try {
        const result = checkSsl(name);
        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          if (result.error) {
            console.error(`SSL check failed: ${result.error}`);
            process.exit(1);
          }
          console.log(`SSL Certificate for ${result.domain}:`);
          console.log(`  Issuer: ${result.issuer || "unknown"}`);
          console.log(`  Expires: ${result.expires_at || "unknown"}`);
          if (result.subject) console.log(`  Subject: ${result.subject}`);
        }
      } catch (error: unknown) {
        console.error(`SSL check failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  program
    .command("export")
    .description("Export all domains as CSV or JSON")
    .option("--format <format>", "Export format (csv or json)", "json")
    .option("--output <file>", "Write to file instead of stdout")
    .action((opts) => {
      const format = opts.format === "csv" ? "csv" : "json";
      const output = exportPortfolio(format as "csv" | "json");
      if (opts.output) {
        writeFileSync(opts.output, output, "utf-8");
        console.log(`Exported to ${opts.output}`);
      } else {
        console.log(output);
      }
    });

  program
    .command("check-all")
    .description("Run WHOIS + SSL + DNS validation on all domains")
    .option("--json", "Output as JSON", false)
    .action((opts) => {
      const results = checkAllDomains();
      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        if (results.length === 0) {
          console.log("No domains to check.");
          return;
        }
        for (const r of results) {
          console.log(`\n${r.domain}:`);
          if (r.whois) {
            console.log(`  WHOIS: registrar=${r.whois.registrar || "?"}, expires=${r.whois.expires_at || "?"}`);
            if (r.whois.error) console.log(`    Error: ${r.whois.error}`);
          }
          if (r.ssl) {
            console.log(`  SSL: issuer=${r.ssl.issuer || "?"}, expires=${r.ssl.expires_at || "?"}`);
            if (r.ssl.error) console.log(`    Error: ${r.ssl.error}`);
          }
          if (r.dns_validation) {
            console.log(`  DNS: valid=${r.dns_validation.valid}, issues=${r.dns_validation.issue_count}`);
            for (const e of r.dns_validation.errors) {
              console.log(`    ${e}`);
            }
          }
        }
        console.log(`\nChecked ${results.length} domain(s)`);
      }
    });

  // ── Compare two domains side-by-side ────────────────────────────────────
  program
    .command("compare")
    .description("Compare two domains side-by-side")
    .argument("<name1>", "First domain name or ID")
    .argument("<name2>", "Second domain name or ID")
    .option("--json", "Output as JSON", false)
    .action((name1, name2, opts) => {
      const domain1 = resolveDomain(name1);
      const domain2 = resolveDomain(name2);

      if (!domain1) {
        console.error(`Domain '${name1}' not found.`);
        process.exit(1);
      }
      if (!domain2) {
        console.error(`Domain '${name2}' not found.`);
        process.exit(1);
      }

      const dns1 = listDnsRecords(domain1.id);
      const dns2 = listDnsRecords(domain2.id);
      const rep1 = getDomainReputationByName(domain1.name);
      const rep2 = getDomainReputationByName(domain2.name);
      const offers1 = listDomainOffers(domain1.id);
      const offers2 = listDomainOffers(domain2.id);

      if (opts.json) {
        console.log(JSON.stringify(
          {
            domain1: { ...domain1, dns_records: dns1, reputation: rep1, offers: offers1 },
            domain2: { ...domain2, dns_records: dns2, reputation: rep2, offers: offers2 },
          },
          null,
          2,
        ));
      } else {
        const fields: { label: string; key: string }[] = [
          { label: "Name", key: "name" },
          { label: "Registrar", key: "registrar" },
          { label: "Status", key: "status" },
          { label: "Registered", key: "registered_at" },
          { label: "Expires", key: "expires_at" },
          { label: "Auto-renew", key: "auto_renew" },
          { label: "Premium", key: "is_premium" },
          { label: "SSL Issuer", key: "ssl_issuer" },
          { label: "SSL Expires", key: "ssl_expires_at" },
          { label: "DNS Records", key: "_dns_count" },
          { label: "Blacklisted", key: "_blacklisted" },
          { label: "Offers", key: "_offers_count" },
        ];

        const maxLabelLen = Math.max(...fields.map((f) => f.label.length));

        const val = (d: any, key: string) => {
          if (key === "_dns_count") return String((d === domain1 ? dns1 : dns2).length);
          if (key === "_blacklisted") return String((d === domain1 ? rep1 : rep2)?.is_blacklisted ?? false);
          if (key === "_offers_count") return String((d === domain1 ? offers1 : offers2).length);
          if (key === "auto_renew") return d[key] ? "yes" : "no";
          if (key === "is_premium") return d[key] ? "yes" : "no";
          return d[key] || "—";
        };

        console.log(
          `  ${" ".repeat(maxLabelLen)}  ${domain1.name.padEnd(Math.max(domain1.name.length, 25))}  ${domain2.name}`,
        );
        console.log(`  ${"─".repeat(maxLabelLen)}  ${"─".repeat(Math.max(domain1.name.length, 25))}  ${"─".repeat(domain2.name.length)}`);

        for (const f of fields) {
          const v1 = val(domain1, f.key);
          const v2 = val(domain2, f.key);
          const mismatch = v1 !== v2 ? " *" : "";
          console.log(
            `  ${f.label.padEnd(maxLabelLen)}  ${v1.padEnd(Math.max(domain1.name.length, 25))}  ${v2}${mismatch}`,
          );
        }
        console.log("\n  * = values differ");
      }
    });

  // ── Renew all domains ───────────────────────────────────────────────────
  program
    .command("renew")
    .description("Renew a single domain or all domains with a registrar")
    .option("--all", "Renew all domains that have a registrar configured", false)
    .option("--dry-run", "Show what would be renewed without executing", false)
    .option("--json", "Output as JSON", false)
    .argument("[id]", "Domain ID to renew (required without --all)")
    .action(async (id, opts) => {
      if (opts.all) {
        await renewAllDomains(opts);
      } else if (!id) {
        console.error("Provide a domain ID or use --all to renew all domains.");
        process.exit(1);
      } else {
        await renewSingleDomain(id, opts);
      }
    });
}

function resolveDomain(input: string) {
  // Try as ID first, then as name
  let domain = getDomain(input);
  if (!domain) {
    domain = getDomainByName(input);
  }
  return domain;
}

async function renewAllDomains(opts: { dryRun?: boolean; json?: boolean }) {
  const domains = listDomains().filter((d) => d.registrar && d.status !== "transferring");
  if (domains.length === 0) {
    console.log("No domains with a registrar to renew.");
    return;
  }

  const { autoDetectRegistrar, getRegistrarProvider } = await import("../../lib/registrar.js");
  const results: { domain: string; registrar: string; success: boolean; error?: string }[] = [];

  for (const d of domains) {
    const providerName = autoDetectRegistrar(d.name, getDomainByName);
    if (!providerName) {
      results.push({ domain: d.name, registrar: d.registrar!, success: false, error: "Unknown registrar provider" });
      continue;
    }
    if (opts.dryRun) {
      results.push({ domain: d.name, registrar: providerName, success: true });
      continue;
    }

    try {
      const provider = getRegistrarProvider(providerName);
      const renewResult = await provider.renewDomain(d.name);
      results.push({
        domain: d.name,
        registrar: providerName,
        success: renewResult.success,
        error: renewResult.success ? undefined : "Renewal failed",
      });
    } catch (error: unknown) {
      results.push({
        domain: d.name,
        registrar: providerName,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    const ok = results.filter((r) => r.success).length;
    const fail = results.filter((r) => !r.success).length;
    if (opts.dryRun) {
      console.log(`Would renew ${results.length} domain(s):`);
    } else {
      console.log(`Renewed ${ok} domain(s), ${fail} failed:`);
    }
    for (const r of results) {
      console.log(`  ${r.domain} (${r.registrar}): ${r.success ? "OK" : `FAILED — ${r.error}`}`);
    }
  }
}

async function renewSingleDomain(id: string, opts: { dryRun?: boolean; json?: boolean }) {
  const domain = getDomain(id);
  if (!domain) {
    console.error(`Domain '${id}' not found.`);
    process.exit(1);
  }
  if (!domain.registrar) {
    console.error(`Domain '${domain.name}' has no registrar set.`);
    process.exit(1);
  }

  const { autoDetectRegistrar, getRegistrarProvider } = await import("../../lib/registrar.js");
  const providerName = autoDetectRegistrar(domain.name, getDomainByName);
  if (!providerName) {
    console.error(`Could not detect registrar provider for '${domain.registrar}'`);
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(`Would renew ${domain.name} via ${providerName}`);
    return;
  }

  try {
    const provider = getRegistrarProvider(providerName);
    const result = await provider.renewDomain(domain.name);
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.success) {
      console.log(`Renewed ${domain.name} via ${providerName}`);
      if (result.chargedAmount) console.log(`  Charged: ${result.chargedAmount}`);
      if (result.orderId) console.log(`  Order: ${result.orderId}`);
    } else {
      console.error(`Failed to renew ${domain.name}`);
      process.exit(1);
    }
  } catch (error: unknown) {
    console.error(`Renewal failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
