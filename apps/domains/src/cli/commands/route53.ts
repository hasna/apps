import type { Command } from "commander";
import {
  checkAvailability,
  registerDomain,
  getRegistrationStatus,
  listRegisteredDomains,
  createHostedZone,
  listHostedZones,
  getHostedZone,
  deleteHostedZone,
  findHostedZoneByDomain,
  listRecords,
  upsertRecord,
  deleteRecord,
  createRoute53Provider,
} from "../../lib/route53.js";
import type { DomainContactInfo } from "../../lib/route53.js";
import { createDomain, getDomainByName, updateDomain } from "../../db/domains.js";

export function registerRoute53Commands(program: Command): void {
  const r53 = program.command("r53").description("AWS Route 53 — domain purchase, hosted zones & DNS");

  // ─── Domain Availability ───────────────────────────────────────────────

  r53
    .command("check <domain>")
    .description("Check if a domain is available for purchase")
    .action(async (domain: string) => {
      try {
        const result = await checkAvailability(domain);
        if (result.available) {
          const price = result.price ? ` — ${result.currency ?? "USD"} ${result.price}/yr` : "";
          console.log(`✓ ${domain} is available${price}`);
        } else {
          console.log(`✗ ${domain} is not available`);
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ─── Domain Purchase ───────────────────────────────────────────────────

  r53
    .command("buy <domain>")
    .description("Register (purchase) a domain via Route 53")
    .requiredOption("--email <email>", "Registrant email")
    .requiredOption("--first-name <name>", "First name")
    .requiredOption("--last-name <name>", "Last name")
    .requiredOption("--phone <phone>", "Phone (e.g. +1.5551234567)")
    .requiredOption("--address <addr>", "Street address")
    .requiredOption("--city <city>", "City")
    .requiredOption("--state <state>", "State/province")
    .requiredOption("--country <code>", "Country code (e.g. US, RO)")
    .requiredOption("--zip <zip>", "ZIP/postal code")
    .option("--org <name>", "Organization name")
    .option("--years <n>", "Registration years", "1")
    .option("--no-auto-renew", "Disable auto-renewal")
    .action(async (domain: string, opts: {
      email: string; firstName: string; lastName: string;
      phone: string; address: string; city: string; state: string;
      country: string; zip: string; org?: string; years: string; autoRenew: boolean;
    }) => {
      try {
        const avail = await checkAvailability(domain);
        if (!avail.available) {
          console.error(`✗ ${domain} is not available for registration`);
          process.exit(1);
        }

        const contact: DomainContactInfo = {
          first_name: opts.firstName,
          last_name: opts.lastName,
          email: opts.email,
          phone: opts.phone,
          address_line_1: opts.address,
          city: opts.city,
          state: opts.state,
          country_code: opts.country,
          zip_code: opts.zip,
          organization_name: opts.org,
        };

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
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const domains = await listRegisteredDomains();
        if (opts.json) {
          console.log(JSON.stringify(domains, null, 2));
          return;
        }
        if (domains.length === 0) {
          console.log("No registered domains.");
          return;
        }
        console.log("\nRegistered Domains:");
        for (const d of domains) {
          const expiry = d.expiry ? ` (expires ${d.expiry.split("T")[0]})` : "";
          const renew = d.auto_renew ? " [auto-renew]" : "";
          console.log(`  ${d.domain}${expiry}${renew}`);
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
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      try {
        const zones = await listHostedZones();
        if (opts.json) {
          console.log(JSON.stringify(zones, null, 2));
          return;
        }
        if (zones.length === 0) {
          console.log("No hosted zones.");
          return;
        }
        console.log("\nHosted Zones:");
        for (const z of zones) {
          const comment = z.comment ? ` — ${z.comment}` : "";
          console.log(`  ${z.id}  ${z.name}  ${z.record_count} records${comment}`);
        }
        console.log();
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  r53
    .command("zone-delete <zoneId>")
    .description("Delete a hosted zone")
    .action(async (zoneId: string) => {
      try {
        await deleteHostedZone(zoneId);
        console.log(`✓ Hosted zone deleted: ${zoneId}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  // ─── DNS Records ───────────────────────────────────────────────────────

  r53
    .command("records <domain>")
    .description("List DNS records for a domain")
    .option("--json", "Output JSON")
    .action(async (domain: string, opts: { json?: boolean }) => {
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
        if (records.length === 0) {
          console.log("No records.");
          return;
        }
        console.log(`\nDNS Records for ${domain}:`);
        for (const r of records) {
          console.log(`  ${r.type.padEnd(6)} ${r.name.padEnd(40)} TTL:${r.ttl}  ${r.values.join(", ")}`);
        }
        console.log();
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
    .description("Delete a DNS record")
    .requiredOption("--type <type>", "Record type")
    .requiredOption("--name <name>", "Record name")
    .requiredOption("--value <value>", "Record value")
    .option("--ttl <seconds>", "TTL", "300")
    .action(async (domain: string, opts: { type: string; name: string; value: string; ttl: string }) => {
      try {
        const zone = await findHostedZoneByDomain(domain);
        if (!zone) {
          console.error(`No hosted zone found for ${domain}`);
          process.exit(1);
        }
        await deleteRecord(zone.id, { name: opts.name, type: opts.type, ttl: parseInt(opts.ttl), values: [opts.value] });
        console.log(`✓ Record deleted: ${opts.type} ${opts.name}`);
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
    .description("Buy domain + create zone + sync to DB — all in one")
    .requiredOption("--email <email>", "Registrant email")
    .requiredOption("--first-name <name>", "First name")
    .requiredOption("--last-name <name>", "Last name")
    .requiredOption("--phone <phone>", "Phone")
    .requiredOption("--address <addr>", "Street address")
    .requiredOption("--city <city>", "City")
    .requiredOption("--state <state>", "State/province")
    .requiredOption("--country <code>", "Country code")
    .requiredOption("--zip <zip>", "ZIP code")
    .option("--org <name>", "Organization name")
    .option("--years <n>", "Registration years", "1")
    .option("--wait", "Poll until registration completes (or fails)")
    .action(async (domain: string, opts: {
      email: string; firstName: string; lastName: string;
      phone: string; address: string; city: string; state: string;
      country: string; zip: string; org?: string; years: string; wait?: boolean;
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
        const contact: DomainContactInfo = {
          first_name: opts.firstName, last_name: opts.lastName,
          email: opts.email, phone: opts.phone,
          address_line_1: opts.address, city: opts.city,
          state: opts.state, country_code: opts.country,
          zip_code: opts.zip, organization_name: opts.org,
        };
        const reg = await registerDomain(domain, contact, parseInt(opts.years));
        console.log(`  ✓ Submitted (operation: ${reg.operationId})`);

        if (opts.wait) {
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
        }

        // 3. Create hosted zone
        console.log(`[3/4] Creating hosted zone...`);
        const zone = await createHostedZone(domain, `Managed by @hasna/domains`);
        console.log(`  ✓ Zone created (${zone.id})`);

        // 4. Add to local DB
        console.log(`[4/4] Adding to local database...`);
        createDomain({
          name: domain,
          registrar: "AWS Route 53",
          status: "active",
          auto_renew: true,
          nameservers: zone.name_servers,
        });
        console.log(`  ✓ Added to portfolio`);

        // Summary
        console.log(`\n✓ Full setup complete for ${domain}`);
        if (!opts.wait) console.log(`  Registration may take a few minutes.`);
        console.log(`  Check: domains r53 status ${reg.operationId}`);
        if (zone.name_servers && zone.name_servers.length > 0) {
          console.log(`\n  Name servers:`);
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
}
