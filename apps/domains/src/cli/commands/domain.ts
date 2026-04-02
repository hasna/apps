import type { Command } from "commander";
import {
  createDomain, getDomain, getDomainByName, listDomains, updateDomain,
  deleteDomain, searchDomains, listExpiring, getDomainStats,
  exportPortfolio, checkAllDomains, whoisLookup,
} from "../../db/domains.js";
import { getAvailableProviders, getRegistrarProvider, getDnsProvider, autoDetectRegistrar } from "../../lib/registrar.js";
import { loadConfig, resolveContact } from "../../lib/config.js";
import { registerDomain, checkAvailability, getRegistrationStatus, createHostedZone } from "../../lib/route53.js";
import { createZone as cfCreateZone } from "../../lib/cloudflare.js";

export function registerDomainCommand(program: Command): void {
  const domain = program.command("domain").description("Domain portfolio management");

  // ── list ────────────────────────────────────────────────────────────────

  domain
    .command("list")
    .description("List all domains in the portfolio")
    .option("--status <status>", "Filter by status (active/expired/transferring/redemption)")
    .option("--registrar <name>", "Filter by registrar")
    .option("--limit <n>", "Limit number of returned domains")
    .option("--offset <n>", "Skip first N domains", "0")
    .option("--json", "Output JSON")
    .action((opts: { status?: string; registrar?: string; limit?: string; offset?: string; json?: boolean }) => {
      const limit = opts.limit ? parseInt(opts.limit, 10) : undefined;
      const offset = opts.offset ? parseInt(opts.offset, 10) : 0;

      if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
        console.error("--limit must be a non-negative integer");
        process.exit(1);
      }
      if (!Number.isInteger(offset) || offset < 0) {
        console.error("--offset must be a non-negative integer");
        process.exit(1);
      }

      const domains = listDomains({
        status: opts.status as "active" | undefined,
        registrar: opts.registrar,
        limit,
        offset,
      });

      if (opts.json) {
        console.log(JSON.stringify({ domains, count: domains.length, limit: limit ?? null, offset }, null, 2));
        return;
      }
      if (domains.length === 0) { console.log("No domains found."); return; }
      for (const d of domains) {
        const exp = d.expires_at ? ` (expires ${d.expires_at.split("T")[0]})` : "";
        console.log(`  ${d.name} [${d.status}]${exp}`);
      }
      console.log(`\n${domains.length} domain(s)`);
      if (limit !== undefined || offset > 0) {
        console.log(`Page: limit=${limit ?? "all"}, offset=${offset}`);
      }
    });
  // ── get ─────────────────────────────────────────────────────────────────

  domain
    .command("get <id>")
    .description("Get a domain by ID")
    .option("--json", "Output JSON")
    .action((id: string, opts: { json?: boolean }) => {
      const d = getDomain(id);
      if (!d) { console.error(`Domain '${id}' not found.`); process.exit(1); }
      if (opts.json) { console.log(JSON.stringify(d, null, 2)); return; }
      console.log(`\n${d.name} [${d.status}]`);
      if (d.registrar) console.log(`  Registrar:  ${d.registrar}`);
      if (d.expires_at) console.log(`  Expires:    ${d.expires_at.split("T")[0]}`);
      console.log(`  Auto-renew: ${d.auto_renew ? "yes" : "no"}`);
      if (d.notes) console.log(`  Notes:      ${d.notes}`);
      console.log();
    });

  // ── add ─────────────────────────────────────────────────────────────────

  domain
    .command("add")
    .description("Add a domain to the portfolio")
    .requiredOption("--name <name>", "Domain name")
    .option("--registrar <name>", "Registrar name")
    .option("--status <s>", "Status (active/expired/transferring/redemption)", "active")
    .option("--expires <date>", "Expiry date (YYYY-MM-DD)")
    .option("--notes <text>", "Notes")
    .option("--json", "Output JSON")
    .action((opts: { name: string; registrar?: string; status: string; expires?: string; notes?: string; json?: boolean }) => {
      const d = createDomain({
        name: opts.name, registrar: opts.registrar,
        status: opts.status as "active", expires_at: opts.expires, notes: opts.notes,
      });
      if (opts.json) { console.log(JSON.stringify(d, null, 2)); return; }
      console.log(`Created domain: ${d.name} (${d.id})`);
    });

  // ── update ──────────────────────────────────────────────────────────────

  domain
    .command("update <id>")
    .description("Update a domain")
    .option("--registrar <name>", "Registrar")
    .option("--status <s>", "Status")
    .option("--expires <date>", "Expiry date")
    .option("--notes <text>", "Notes")
    .option("--json", "Output JSON")
    .action((id: string, opts: { registrar?: string; status?: string; expires?: string; notes?: string; json?: boolean }) => {
      const d = updateDomain(id, {
        registrar: opts.registrar, status: opts.status as "active" | undefined,
        expires_at: opts.expires, notes: opts.notes,
      });
      if (!d) { console.error(`Domain '${id}' not found.`); process.exit(1); }
      if (opts.json) { console.log(JSON.stringify(d, null, 2)); return; }
      console.log(`Updated: ${d.name}`);
    });

  // ── delete ──────────────────────────────────────────────────────────────

  domain
    .command("delete <id>")
    .description("Delete a domain from the portfolio")
    .option("-f, --force", "Required confirmation for destructive delete")
    .option("--json", "Output JSON")
    .action((id: string, opts: { force?: boolean; json?: boolean }) => {
      if (!opts.force) {
        const message = `Refusing to delete domain '${id}' without --force.`;
        if (opts.json) {
          console.log(JSON.stringify({ deleted: false, id, error: message }, null, 2));
        } else {
          console.error(message);
          console.error("Re-run with --force to confirm deletion.");
        }
        process.exit(1);
      }

      const deleted = deleteDomain(id);
      if (!deleted) {
        const message = `Domain '${id}' not found.`;
        if (opts.json) {
          console.log(JSON.stringify({ deleted: false, id, error: message }, null, 2));
        } else {
          console.error(message);
        }
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify({ deleted: true, id }, null, 2));
        return;
      }

      console.log(`Deleted domain ${id}`);
    });

  // ── search ──────────────────────────────────────────────────────────────

  domain
    .command("search <query>")
    .description("Search domains by name, registrar, or notes")
    .option("--json", "Output JSON")
    .action((query: string, opts: { json?: boolean }) => {
      const results = searchDomains(query);
      if (opts.json) { console.log(JSON.stringify({ results, count: results.length }, null, 2)); return; }
      for (const d of results) console.log(`  ${d.name} [${d.status}]`);
      if (results.length === 0) console.log("No results.");
    });

  // ── expiring ────────────────────────────────────────────────────────────

  domain
    .command("expiring")
    .description("List domains expiring soon")
    .option("--days <n>", "Days threshold", "30")
    .option("--json", "Output JSON")
    .action((opts: { days: string; json?: boolean }) => {
      const domains = listExpiring(parseInt(opts.days));
      if (opts.json) { console.log(JSON.stringify(domains, null, 2)); return; }
      if (domains.length === 0) { console.log(`No domains expiring within ${opts.days} days.`); return; }
      console.log(`\nExpiring within ${opts.days} days:`);
      for (const d of domains) console.log(`  ${d.name.padEnd(40)} expires ${(d.expires_at ?? "").split("T")[0]}`);
      console.log();
    });

  // ── stats ───────────────────────────────────────────────────────────────

  domain
    .command("stats")
    .description("Show portfolio statistics")
    .option("--json", "Output JSON")
    .action((opts: { json?: boolean }) => {
      const stats = getDomainStats();
      if (opts.json) { console.log(JSON.stringify(stats, null, 2)); return; }
      console.log("Domain Portfolio Stats:");
      for (const [k, v] of Object.entries(stats)) {
        console.log(`  ${k.replace(/_/g, " ")}: ${v}`);
      }
    });

  // ── whois ───────────────────────────────────────────────────────────────

  domain
    .command("whois <name>")
    .description("Run WHOIS lookup and update local DB record")
    .option("--json", "Output JSON")
    .action((name: string, opts: { json?: boolean }) => {
      const result = whoisLookup(name);
      if (opts.json) { console.log(JSON.stringify(result, null, 2)); return; }
      console.log(`\nWHOIS for ${result.domain}:`);
      console.log(`  Registrar: ${result.registrar ?? "unknown"}`);
      console.log(`  Expires:   ${result.expires_at ?? "unknown"}`);
      if (result.nameservers.length) { console.log(`  NS: ${result.nameservers.join(", ")}`); }
      console.log();
    });

  // ── export ──────────────────────────────────────────────────────────────

  domain
    .command("export")
    .description("Export all domains as CSV or JSON")
    .option("--format <fmt>", "Format: csv or json", "json")
    .action((opts: { format: string }) => {
      const output = exportPortfolio(opts.format as "csv" | "json");
      console.log(output);
    });

  // ── check ───────────────────────────────────────────────────────────────

  domain
    .command("check <domains...>")
    .description("Check domain availability via configured registrar")
    .option("--provider <name>", "Registrar provider to use")
    .action(async (domains: string[], opts: { provider?: string }) => {
      const cfg = loadConfig();
      const providerName = opts.provider ?? cfg.default_registrar ?? "route53";
      const results = await Promise.allSettled(
        domains.map(async (d) => {
          const provider = getRegistrarProvider(providerName);
          return provider.checkAvailability(d);
        })
      );
      let anyError = false;
      for (let i = 0; i < domains.length; i++) {
        const r = results[i]!;
        if (r.status === "rejected") {
          const reason = (r as PromiseRejectedResult).reason;
          console.error(`✗ ${domains[i]}: ${reason instanceof Error ? reason.message : String(reason)}`);
          anyError = true;
        } else {
          const result = (r as PromiseFulfilledResult<{ domain: string; available: boolean }>).value;
          console.log(`${result.available ? "✓" : "✗"} ${result.domain} is ${result.available ? "available" : "not available"}`);
        }
      }
      if (anyError) process.exit(1);
    });

  // ── sync ────────────────────────────────────────────────────────────────

  domain
    .command("sync")
    .description("Sync domains from a provider to the local DB")
    .option("--provider <name>", "Provider name (default: all configured)")
    .action(async (opts: { provider?: string }) => {
      const providers = opts.provider
        ? [opts.provider]
        : getAvailableProviders().filter((p) => p.configured && p.type !== "dns" && p.name !== "brandsight").map((p) => p.name);

      for (const name of providers) {
        try {
          const provider = getRegistrarProvider(name);
          const result = await provider.syncToLocalDb({ getDomainByName, createDomain, updateDomain });
          console.log(`✓ [${name}] Synced ${result.synced} (${result.created} new, ${result.updated} updated)`);
          if (result.errors.length > 0) console.log(`  Errors: ${result.errors.join(", ")}`);
        } catch (e) {
          console.error(`✗ [${name}] ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    });

  // ── renew ───────────────────────────────────────────────────────────────

  domain
    .command("renew <name>")
    .description("Renew a domain via its registrar provider")
    .option("--provider <name>", "Override provider")
    .action(async (name: string, opts: { provider?: string }) => {
      const providerName = opts.provider ?? autoDetectRegistrar(name, getDomainByName) ?? loadConfig().default_registrar;
      if (!providerName) { console.error("Could not detect provider. Use --provider."); process.exit(1); }
      const provider = getRegistrarProvider(providerName);
      const result = await provider.renewDomain(name);
      if (result.success) {
        console.log(`✓ Renewed: ${name}`);
        if (result.orderId) console.log(`  Order: ${result.orderId}`);
      } else {
        console.error(`✗ Renewal failed or not supported for ${providerName}`);
        process.exit(1);
      }
    });

  // ── buy ─────────────────────────────────────────────────────────────────

  domain
    .command("buy <name>")
    .description("Purchase a domain via Route 53 (contact defaults from: domains config set contact.*)")
    .option("--provider <name>", "Registrar provider (default: config default-registrar or route53)")
    .option("--email <email>", "Registrant email")
    .option("--first-name <n>", "First name")
    .option("--last-name <n>", "Last name")
    .option("--phone <p>", "Phone")
    .option("--address <a>", "Street address")
    .option("--city <c>", "City")
    .option("--state <s>", "State/province")
    .option("--country <c>", "Country code")
    .option("--zip <z>", "ZIP code")
    .option("--org <o>", "Organization")
    .option("--years <n>", "Years", "1")
    .option("--wait", "Poll until registration completes")
    .action(async (name: string, opts: {
      provider?: string; email?: string; firstName?: string; lastName?: string;
      phone?: string; address?: string; city?: string; state?: string;
      country?: string; zip?: string; org?: string; years: string; wait?: boolean;
    }) => {
      const cfg = loadConfig();
      const providerName = opts.provider ?? cfg.default_registrar ?? "route53";

      // Only Route 53 supports direct purchase via this tool
      if (providerName !== "route53") {
        console.error(`Direct domain purchase only supported via route53. Got: ${providerName}`);
        process.exit(1);
      }

      try {
        const avail = await checkAvailability(name);
        if (!avail.available) { console.error(`✗ ${name} is not available`); process.exit(1); }
        const price = avail.price ? ` (USD ${avail.price}/yr)` : "";
        console.log(`✓ Available${price}`);

        let contact;
        try { contact = resolveContact(opts); } catch (e) { console.error(`Error: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); }

        console.log(`Registering ${name}...`);
        const reg = await registerDomain(name, contact, parseInt(opts.years));
        console.log(`✓ Submitted (operation: ${reg.operationId})`);

        if (opts.wait) {
          let status = "IN_PROGRESS";
          while (status === "IN_PROGRESS" || status === "SUBMITTED") {
            await new Promise((r) => setTimeout(r, 10_000));
            const s = await getRegistrationStatus(reg.operationId);
            status = s.status;
            process.stdout.write(`  Status: ${status}\r`);
          }
          console.log();
          if (status !== "SUCCESSFUL") { console.error(`✗ Registration ${status}`); process.exit(1); }
          console.log(`✓ Registration complete`);
        }

        createDomain({ name, registrar: "AWS Route 53", status: "active", auto_renew: true });
        console.log(`✓ Added to portfolio`);
        if (!opts.wait) console.log(`  Check: domains r53 status ${reg.operationId}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ── setup ────────────────────────────────────────────────────────────────
  // Full flow: buy → create DNS zone → update nameservers → sync to DB

  domain
    .command("setup <name>")
    .description("Full setup: buy domain + create DNS zone + point nameservers (contact defaults from config)")
    .option("--registrar <n>", "Registrar provider (default: config default-registrar or route53)")
    .option("--dns <n>", "DNS provider (default: config default-dns or route53)")
    .option("--email <e>", "Registrant email")
    .option("--first-name <n>", "First name")
    .option("--last-name <n>", "Last name")
    .option("--phone <p>", "Phone")
    .option("--address <a>", "Street address")
    .option("--city <c>", "City")
    .option("--state <s>", "State/province")
    .option("--country <c>", "Country code")
    .option("--zip <z>", "ZIP code")
    .option("--org <o>", "Organization")
    .option("--years <n>", "Years", "1")
    .option("--wait", "Poll until registration completes before creating DNS zone")
    .action(async (name: string, opts: {
      registrar?: string; dns?: string; email?: string; firstName?: string; lastName?: string;
      phone?: string; address?: string; city?: string; state?: string;
      country?: string; zip?: string; org?: string; years: string; wait?: boolean;
    }) => {
      const cfg = loadConfig();
      const registrarName = opts.registrar ?? cfg.default_registrar ?? "route53";
      const dnsName = opts.dns ?? cfg.default_dns ?? registrarName;

      console.log(`\nSetting up ${name}`);
      console.log(`  Registrar: ${registrarName}  |  DNS: ${dnsName}\n`);

      try {
        // 1. Check availability
        process.stdout.write("[1/4] Checking availability... ");
        const avail = await checkAvailability(name);
        if (!avail.available) { console.log("not available"); console.error(`✗ ${name} is not available`); process.exit(1); }
        const price = avail.price ? `(USD ${avail.price}/yr)` : "";
        console.log(`available ${price}`);

        // 2. Buy domain
        if (registrarName !== "route53") {
          console.error("Direct domain purchase currently only supported via route53.");
          process.exit(1);
        }
        let contact;
        try { contact = resolveContact(opts); } catch (e) { console.error(`Error: ${e instanceof Error ? e.message : String(e)}`); process.exit(1); }

        process.stdout.write("[2/4] Registering domain... ");
        const reg = await registerDomain(name, contact, parseInt(opts.years));
        console.log(`submitted (${reg.operationId})`);

        if (opts.wait) {
          let status = "IN_PROGRESS";
          while (status === "IN_PROGRESS" || status === "SUBMITTED") {
            await new Promise((r) => setTimeout(r, 10_000));
            const s = await getRegistrationStatus(reg.operationId);
            status = s.status;
            process.stdout.write(`  Waiting: ${status}...\r`);
          }
          console.log();
          if (status !== "SUCCESSFUL") { console.error(`✗ Registration ${status}`); process.exit(1); }
          console.log("  Registration confirmed");
        }

        // 3. Create DNS zone
        process.stdout.write("[3/4] Creating DNS zone... ");
        let nameservers: string[] = [];
        if (dnsName === "cloudflare") {
          const zone = await cfCreateZone(name);
          nameservers = zone.nameservers ?? [];
          console.log(`created (${zone.id})`);
        } else {
          const zone = await createHostedZone(name, `Managed by @hasna/domains`);
          nameservers = zone.name_servers ?? [];
          console.log(`created (${zone.id})`);
        }

        // 4. Sync to local DB (nameservers will be updated by nightly sync once registration completes)
        process.stdout.write("[4/4] Adding to portfolio... ");
        createDomain({ name, registrar: `AWS Route 53`, status: "active", auto_renew: true, nameservers });
        console.log("done");

        console.log(`\n✓ Setup complete for ${name}`);
        if (!opts.wait) {
          console.log(`  ⚠ Registration pending — check: domains r53 status ${reg.operationId}`);
          console.log(`  ⚠ If registration fails, clean up: domains zone delete <zoneId> --force`);
        }
        if (nameservers.length > 0) {
          console.log(`\n  Point your registrar to these name servers:`);
          for (const ns of nameservers) console.log(`    ${ns}`);
        }
        console.log();
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });
}
