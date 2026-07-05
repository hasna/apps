import type { Command } from "commander";
import { readFileSync } from "node:fs";
import {
  checkAvailability,
  registerDomain,
  getRegistrationStatus,
  listRegisteredDomains,
  getDomainDetail,
  createHostedZone,
  listHostedZones,
  getHostedZone,
  deleteHostedZone,
  findHostedZoneByDomain,
  listRecords,
  upsertRecord,
  upsertRecords,
  deleteRecord,
  updateNameservers,
  createRoute53Provider,
} from "../../lib/route53.js";
import type { DomainContactInfo } from "../../lib/route53.js";
import { setupDomainZone } from "../../lib/zone-setup.js";
import { createDomain, getDomainByName, updateDomain } from "../../db/domains.js";
import { resolveContact } from "../../lib/config.js";
import { compactHint, pageItemsOrExit, truncateText } from "../../lib/compact-output.js";

export function registerRoute53Commands(program: Command): void {
  const r53 = program.command("r53").description("AWS Route 53 — domain purchase, hosted zones & DNS");

  // ─── Domain Availability ───────────────────────────────────────────────

  r53
    .command("check <domains...>")
    .description("Check if one or more domains are available for purchase")
    .action(async (domains: string[]) => {
      try {
        const results = await Promise.allSettled(domains.map((d) => checkAvailability(d)));
        let anyError = false;
        for (let i = 0; i < domains.length; i++) {
          const r = results[i]!;
          if (r.status === "rejected") {
            const reason = (r as PromiseRejectedResult).reason;
            console.error(`✗ ${domains[i]}: ${reason instanceof Error ? reason.message : String(reason)}`);
            anyError = true;
            continue;
          }
          const result = (r as PromiseFulfilledResult<typeof r extends PromiseFulfilledResult<infer T> ? T : never>).value as Awaited<ReturnType<typeof checkAvailability>>;
          if (result.available) {
            const cur = result.currency ?? "USD";
            const reg = result.price ? `register ${cur} ${result.price}` : "";
            const ren = result.renewal_price ? `renew ${cur} ${result.renewal_price}` : "";
            const xfr = result.transfer_price ? `transfer ${cur} ${result.transfer_price}` : "";
            const pricing = [reg, ren, xfr].filter(Boolean).join("  /  ");
            console.log(`✓ ${result.domain} is available${pricing ? `  (${pricing})` : ""}`);
          } else {
            console.log(`✗ ${result.domain} is not available`);
          }
        }
        if (anyError) process.exit(1);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ─── Domain Purchase ───────────────────────────────────────────────────

  r53
    .command("buy <domain>")
    .description("Register (purchase) a domain via Route 53 (contact defaults from: domains config set contact.*)")
    .option("--email <email>", "Registrant email")
    .option("--first-name <name>", "First name")
    .option("--last-name <name>", "Last name")
    .option("--phone <phone>", "Phone (e.g. +40.754013776)")
    .option("--address <addr>", "Street address")
    .option("--city <city>", "City")
    .option("--state <state>", "State/province")
    .option("--country <code>", "Country code (e.g. US, RO)")
    .option("--zip <zip>", "ZIP/postal code")
    .option("--org <name>", "Organization name")
    .option("--years <n>", "Registration years", "1")
    .option("--no-auto-renew", "Disable auto-renewal")
    .action(async (domain: string, opts: {
      email?: string; firstName?: string; lastName?: string;
      phone?: string; address?: string; city?: string; state?: string;
      country?: string; zip?: string; org?: string; years: string; autoRenew: boolean;
    }) => {
      try {
        const avail = await checkAvailability(domain);
        if (!avail.available) {
          console.error(`✗ ${domain} is not available for registration`);
          process.exit(1);
        }

        let contact: DomainContactInfo;
        try {
          contact = resolveContact(opts);
        } catch (e) {
          console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
          process.exit(1);
        }

        console.log(`Registering ${domain}...`);
        const result = await registerDomain(domain, contact, parseInt(opts.years), opts.autoRenew);
        console.log(`✓ Registration submitted: ${domain}`);
        console.log(`  Operation ID: ${result.operationId}`);
        console.log(`  Check status: domains r53 status ${result.operationId}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  r53
    .command("status <operationId>")
    .description("Check domain registration status")
    .action(async (operationId: string) => {
      try {
        const result = await getRegistrationStatus(operationId);
        console.log(`Status: ${result.status}`);
        if (result.domain) console.log(`Domain: ${result.domain}`);
        if (result.message) console.log(`Message: ${result.message}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  r53
    .command("domains")
    .description("List domains registered in Route 53")
    .option("--limit <n>", "Limit number of displayed domains")
    .option("--all", "Show all registered domains")
    .option("--json", "Output JSON")
    .action(async (opts: { limit?: string; all?: boolean; json?: boolean }) => {
      try {
        const domains = await listRegisteredDomains();
        if (opts.json) {
          console.log(JSON.stringify(domains, null, 2));
          return;
        }
        const page = pageItemsOrExit(domains, { limit: opts.limit, all: opts.all });
        if (page.items.length === 0) {
          console.log("No registered domains.");
          return;
        }
        console.log("\nRegistered Domains:");
        for (const d of page.items) {
          const expiry = d.expiry ? ` (expires ${d.expiry.split("T")[0]})` : "";
          const renew = d.auto_renew ? " [auto-renew]" : "";
          const lock = d.transfer_lock ? " [locked]" : "";
          console.log(`  ${d.domain}${expiry}${renew}${lock}`);
        }
        console.log(`\n${compactHint(page, "domain(s)", "Use --all for every Route53 domain or r53 domain-info <domain> for details.", { paging: "limit" })}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  r53
    .command("domain-info <domain>")
    .description("Get full details for a Route 53 registered domain")
    .option("--json", "Output JSON")
    .action(async (domain: string, opts: { json?: boolean }) => {
      try {
        const detail = await getDomainDetail(domain);
        if (opts.json) {
          console.log(JSON.stringify(detail, null, 2));
          return;
        }
        console.log(`\nDomain: ${detail.domain}`);
        console.log(`  Created:       ${detail.created ? detail.created.split("T")[0] : "—"}`);
        console.log(`  Expires:       ${detail.expiry ? detail.expiry.split("T")[0] : "—"}`);
        console.log(`  Auto-renew:    ${detail.auto_renew ? "yes" : "no"}`);
        console.log(`  Transfer lock: ${detail.transfer_lock ? "yes" : "no"}`);
        if (detail.nameservers.length > 0) {
          console.log(`  Name servers:`);
          for (const ns of detail.nameservers) console.log(`    ${ns}`);
        }
        console.log();
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ─── Hosted Zones ──────────────────────────────────────────────────────

  r53
    .command("zone-create <domain>")
    .description("Create a hosted zone")
    .option("--comment <text>", "Zone comment")
    .action(async (domain: string, opts: { comment?: string }) => {
      try {
        const zone = await createHostedZone(domain, opts.comment);
        console.log(`✓ Hosted zone created: ${domain}`);
        console.log(`  Zone ID: ${zone.id}`);
        if (zone.name_servers && zone.name_servers.length > 0) {
          console.log(`\n  Name servers (set at your registrar):`);
          for (const ns of zone.name_servers) {
            console.log(`    ${ns}`);
          }
        }
        console.log();
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  r53
    .command("zones")
    .description("List hosted zones")
    .option("--limit <n>", "Limit number of displayed zones")
    .option("--all", "Show all hosted zones")
    .option("--json", "Output JSON")
    .action(async (opts: { limit?: string; all?: boolean; json?: boolean }) => {
      try {
        const zones = await listHostedZones();
        if (opts.json) {
          console.log(JSON.stringify(zones, null, 2));
          return;
        }
        const page = pageItemsOrExit(zones, { limit: opts.limit, all: opts.all });
        if (page.items.length === 0) {
          console.log("No hosted zones.");
          return;
        }
        console.log("\nHosted Zones:");
        for (const z of page.items) {
          const comment = z.comment ? ` — ${truncateText(z.comment, 60)}` : "";
          console.log(`  ${z.id}  ${z.name}  ${z.record_count} records${comment}`);
        }
        console.log(`\n${compactHint(page, "zone(s)", "Use --all for every zone or r53 zone-info <zoneId> for details.", { paging: "limit" })}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  r53
    .command("zone-info <zoneId>")
    .description("Get details of a hosted zone including name servers")
    .option("--json", "Output JSON")
    .action(async (zoneId: string, opts: { json?: boolean }) => {
      try {
        const zone = await getHostedZone(zoneId);
        if (opts.json) {
          console.log(JSON.stringify(zone, null, 2));
          return;
        }
        console.log(`\nHosted Zone: ${zone.name}`);
        console.log(`  ID:      ${zone.id}`);
        console.log(`  Records: ${zone.record_count}`);
        if (zone.comment) console.log(`  Comment: ${zone.comment}`);
        if (zone.name_servers && zone.name_servers.length > 0) {
          console.log(`  Name servers:`);
          for (const ns of zone.name_servers) {
            console.log(`    ${ns}`);
          }
        }
        console.log();
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  r53
    .command("zone-delete <zoneId>")
    .description("Delete a hosted zone (irreversible — requires --force)")
    .option("--force", "Confirm deletion")
    .action(async (zoneId: string, opts: { force?: boolean }) => {
      try {
        const zone = await getHostedZone(zoneId);
        if (!opts.force) {
          console.log(`Would delete hosted zone:`);
          console.log(`  ID:      ${zone.id}`);
          console.log(`  Domain:  ${zone.name}`);
          console.log(`  Records: ${zone.record_count}`);
          console.log(`\nThis is irreversible. Re-run with --force to confirm.`);
          process.exit(0);
        }
        await deleteHostedZone(zoneId);
        console.log(`✓ Hosted zone deleted: ${zone.name} (${zone.id})`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ─── DNS Records ───────────────────────────────────────────────────────

  r53
    .command("records <domain>")
    .description("List DNS records for a domain")
    .option("--limit <n>", "Limit number of displayed records")
    .option("--all", "Show all DNS records")
    .option("--json", "Output JSON")
    .action(async (domain: string, opts: { limit?: string; all?: boolean; json?: boolean }) => {
      try {
        const zone = await findHostedZoneByDomain(domain);
        if (!zone) {
          console.error(`No hosted zone found for ${domain}`);
          process.exit(1);
        }
        const records = await listRecords(zone.id);
        if (opts.json) {
          console.log(JSON.stringify(records, null, 2));
          return;
        }
        const page = pageItemsOrExit(records, { limit: opts.limit, all: opts.all });
        if (page.items.length === 0) {
          console.log("No records.");
          return;
        }
        console.log(`\nDNS Records for ${domain}:`);
        for (const r of page.items) {
          const val = r.alias_target
            ? `ALIAS → ${r.alias_target.dns_name}`
            : truncateText(r.values.join(", "), 90);
          const ttl = r.alias_target ? "" : `  TTL:${r.ttl}`;
          console.log(`  ${r.type.padEnd(6)} ${r.name.padEnd(40)}${ttl}  ${val}`);
        }
        console.log(`\n${compactHint(page, "record(s)", "Use --all for every record or --json for full values.", { paging: "limit" })}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  r53
    .command("record-set <domain>")
    .description("Add or update a DNS record")
    .requiredOption("--type <type>", "Record type (A, AAAA, CNAME, TXT, MX, NS)")
    .requiredOption("--name <name>", "Record name (FQDN)")
    .option("--value <value>", "Record value (repeatable for multi-value records)", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .option("--ttl <seconds>", "TTL", "300")
    .option("--alias-zone <zoneId>", "Alias target hosted zone ID (e.g. Z2FDTNDATAQYW2 for CloudFront)")
    .option("--alias-dns <name>", "Alias target DNS name (e.g. d1234.cloudfront.net)")
    .action(async (domain: string, opts: { type: string; name: string; value: string[]; ttl: string; aliasZone?: string; aliasDns?: string }) => {
      try {
        const isAlias = !!(opts.aliasZone && opts.aliasDns);
        if (!isAlias && (!opts.value || opts.value.length === 0)) {
          console.error("Error: provide --value (repeatable) or both --alias-zone and --alias-dns");
          process.exit(1);
        }
        const zone = await findHostedZoneByDomain(domain);
        if (!zone) {
          console.error(`No hosted zone found for ${domain}`);
          process.exit(1);
        }
        const aliasTarget = isAlias ? { hosted_zone_id: opts.aliasZone!, dns_name: opts.aliasDns! } : undefined;
        await upsertRecord(zone.id, { name: opts.name, type: opts.type, ttl: parseInt(opts.ttl), values: opts.value, alias_target: aliasTarget });
        const desc = isAlias ? `alias → ${opts.aliasDns}` : `${opts.value.length} value(s)`;
        console.log(`✓ Record upserted: ${opts.type} ${opts.name} (${desc})`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  r53
    .command("record-rm <domain>")
    .description("Delete a DNS record (fetches existing record set to ensure exact match)")
    .requiredOption("--type <type>", "Record type")
    .requiredOption("--name <name>", "Record name (FQDN)")
    .action(async (domain: string, opts: { type: string; name: string }) => {
      try {
        const zone = await findHostedZoneByDomain(domain);
        if (!zone) {
          console.error(`No hosted zone found for ${domain}`);
          process.exit(1);
        }
        // Fetch the existing record set — DELETE requires exact match of all values
        const records = await listRecords(zone.id);
        const normName = opts.name.endsWith(".") ? opts.name : `${opts.name}.`;
        const existing = records.find(
          (r) => r.type === opts.type.toUpperCase() && (r.name === opts.name || r.name === normName),
        );
        if (!existing) {
          console.error(`✗ No ${opts.type} record found for ${opts.name} in zone ${domain}`);
          process.exit(1);
        }
        await deleteRecord(zone.id, {
          name: existing.name,
          type: existing.type,
          ttl: existing.ttl,
          values: existing.values,
          alias_target: existing.alias_target,
        });
        console.log(`✓ Record deleted: ${existing.type} ${existing.name}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  r53
    .command("records-import <domain>")
    .description("Batch upsert DNS records from a JSON file in a single API call")
    .requiredOption("--file <path>", "Path to JSON file — array of {type, name, values[], ttl?}")
    .action(async (domain: string, opts: { file: string }) => {
      try {
        let raw: string;
        try {
          raw = readFileSync(opts.file, "utf-8");
        } catch {
          console.error(`Could not read file: ${opts.file}`);
          process.exit(1);
        }
        const records = JSON.parse(raw) as Array<{ type: string; name: string; values: string[]; ttl?: number }>;
        if (!Array.isArray(records)) {
          console.error("JSON file must be an array of record objects");
          process.exit(1);
        }
        const zone = await findHostedZoneByDomain(domain);
        if (!zone) {
          console.error(`No hosted zone found for ${domain}`);
          process.exit(1);
        }
        await upsertRecords(zone.id, records);
        console.log(`✓ Upserted ${records.length} record(s) in ${domain}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ─── Sync ──────────────────────────────────────────────────────────────

  r53
    .command("sync")
    .description("Sync Route 53 registered domains to local database")
    .action(async () => {
      try {
        const provider = createRoute53Provider();
        const result = await provider.syncToLocalDb({
          getDomainByName,
          createDomain,
          updateDomain,
        });
        console.log(`✓ Synced ${result.synced} domains (${result.created} new, ${result.updated} updated)`);
        if (result.errors.length > 0) {
          console.log(`  Errors: ${result.errors.join(", ")}`);
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ─── Full Setup ────────────────────────────────────────────────────────

  r53
    .command("full-setup <domain>")
    .description("Buy domain + create zone + sync to DB — all in one (contact defaults from: domains config set contact.*)")
    .option("--email <email>", "Registrant email")
    .option("--first-name <name>", "First name")
    .option("--last-name <name>", "Last name")
    .option("--phone <phone>", "Phone")
    .option("--address <addr>", "Street address")
    .option("--city <city>", "City")
    .option("--state <state>", "State/province")
    .option("--country <code>", "Country code")
    .option("--zip <zip>", "ZIP code")
    .option("--org <name>", "Organization name")
    .option("--years <n>", "Registration years", "1")
    .option("--wait", "Poll until registration completes (or fails)")
    .action(async (domain: string, opts: {
      email?: string; firstName?: string; lastName?: string;
      phone?: string; address?: string; city?: string; state?: string;
      country?: string; zip?: string; org?: string; years: string; wait?: boolean;
    }) => {
      try {
        // 1. Check
        console.log(`[1/4] Checking availability...`);
        const avail = await checkAvailability(domain);
        if (!avail.available) {
          console.error(`✗ ${domain} is not available`);
          process.exit(1);
        }
        const price = avail.price ? ` (${avail.currency ?? "USD"} ${avail.price}/yr)` : "";
        console.log(`  ✓ Available${price}`);

        // 2. Register
        console.log(`[2/4] Registering domain...`);
        let contact: DomainContactInfo;
        try {
          contact = resolveContact(opts);
        } catch (e) {
          console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
          process.exit(1);
        }
        const reg = await registerDomain(domain, contact, parseInt(opts.years));
        console.log(`  ✓ Submitted (operation: ${reg.operationId})`);

        // Route 53 auto-creates the hosted zone during registration, so we must
        // wait for registration to complete before touching zones — otherwise we
        // can't see (and would duplicate) the auto-created zone.
        console.log(`  Waiting for registration to complete...`);
        let status = "IN_PROGRESS";
        while (status === "IN_PROGRESS" || status === "SUBMITTED") {
          await new Promise((r) => setTimeout(r, 10_000));
          const s = await getRegistrationStatus(reg.operationId);
          status = s.status;
          process.stdout.write(`  Status: ${status}\r`);
        }
        console.log();
        if (status !== "SUCCESSFUL") {
          console.error(`✗ Registration ${status}`);
          process.exit(1);
        }
        console.log(`  ✓ Registration complete`);

        // 3. Configure hosted zone — reuse the auto-created zone (don't duplicate
        // it) and align the registry delegation to the managed zone.
        console.log(`[3/4] Configuring hosted zone...`);
        const setup = await setupDomainZone(domain, {
          findExistingZone: async (d) => {
            const z = await findHostedZoneByDomain(d);
            if (!z) return null;
            const full = await getHostedZone(z.id);
            return { id: full.id, name_servers: full.name_servers };
          },
          createZone: async (d) => {
            const z = await createHostedZone(d, "Managed by domains CLI");
            return { id: z.id, name_servers: z.name_servers ?? [] };
          },
          getRegistrarNs: async (d) => (await getDomainDetail(d)).nameservers,
          setRegistrarNs: async (d, ns) => {
            await updateNameservers(d, ns);
          },
        });
        console.log(
          `  ✓ Zone ${setup.created ? "created" : "reused"} (${setup.zoneId})` +
            (setup.nsUpdated ? ` — registry NS repointed to this zone` : ``),
        );

        // 4. Add to local DB
        console.log(`[4/4] Adding to local database...`);
        createDomain({
          name: domain,
          registrar: "AWS Route 53",
          status: "active",
          auto_renew: true,
          nameservers: setup.nameServers,
        });
        console.log(`  ✓ Added to portfolio`);

        // Summary
        console.log(`\n✓ Full setup complete for ${domain}`);
        console.log(`  Check: domains r53 status ${reg.operationId}`);
        if (setup.nameServers && setup.nameServers.length > 0) {
          console.log(`\n  Name servers:`);
          for (const ns of setup.nameServers) {
            console.log(`    ${ns}`);
          }
        }
        console.log();
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });
}
