import type { Command } from "commander";
import { loadConfig } from "../../lib/config.js";
import {
  createHostedZone, listHostedZones, getHostedZone, deleteHostedZone,
} from "../../lib/route53.js";
import {
  createZone as cfCreateZone, listZones as cfListZones,
  getZone as cfGetZone, deleteZone as cfDeleteZone,
} from "../../lib/cloudflare.js";
import { compactHint, pageItemsOrExit } from "../../lib/compact-output.js";

function resolveProvider(flag?: string): string {
  return flag ?? loadConfig().default_dns ?? "route53";
}

export function registerZoneCommand(program: Command): void {
  const zone = program.command("zone").description("Hosted zone management (provider-agnostic)");

  zone
    .command("list")
    .description("List all hosted zones")
    .option("--provider <name>", "DNS provider (route53, cloudflare) — defaults to config default-dns")
    .option("--limit <n>", "Limit number of displayed zones")
    .option("--all", "Show all hosted zones")
    .option("--json", "Output JSON")
    .action(async (opts: { provider?: string; limit?: string; all?: boolean; json?: boolean }) => {
      const provider = resolveProvider(opts.provider);
      try {
        let zones: { id: string; name: string; status?: string; nameservers?: string[]; record_count?: number }[];
        if (provider === "cloudflare") {
          zones = (await cfListZones()).map((z) => ({ id: z.id, name: z.name, status: z.status, nameservers: z.nameservers }));
        } else {
          zones = await listHostedZones();
        }
        if (opts.json) { console.log(JSON.stringify(zones, null, 2)); return; }
        const page = pageItemsOrExit(zones, { limit: opts.limit, all: opts.all });
        if (page.items.length === 0) { console.log("No hosted zones."); return; }
        console.log(`\nHosted Zones (${provider}):`);
        for (const z of page.items) {
          const extra = z.record_count !== undefined ? `  ${z.record_count} records` : "";
          console.log(`  ${z.id.padEnd(32)} ${z.name}${extra}`);
        }
        console.log(`\n${compactHint(page, "zone(s)", "Use --all for every zone or zone info <zoneId> for details.", { paging: "limit" })}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  zone
    .command("create <domain>")
    .description("Create a hosted zone")
    .option("--provider <name>", "DNS provider")
    .option("--comment <text>", "Zone comment (Route 53 only)")
    .action(async (domain: string, opts: { provider?: string; comment?: string }) => {
      const provider = resolveProvider(opts.provider);
      try {
        if (provider === "cloudflare") {
          const z = await cfCreateZone(domain);
          console.log(`✓ Zone created: ${domain} (${z.id})`);
          if (z.nameservers?.length) {
            console.log(`  Name servers:`);
            for (const ns of z.nameservers) console.log(`    ${ns}`);
          }
        } else {
          const z = await createHostedZone(domain, opts.comment);
          console.log(`✓ Zone created: ${domain} (${z.id})`);
          if (z.name_servers?.length) {
            console.log(`  Name servers:`);
            for (const ns of z.name_servers) console.log(`    ${ns}`);
          }
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  zone
    .command("info <zoneId>")
    .description("Get details of a hosted zone")
    .option("--provider <name>", "DNS provider")
    .option("--json", "Output JSON")
    .action(async (zoneId: string, opts: { provider?: string; json?: boolean }) => {
      const provider = resolveProvider(opts.provider);
      try {
        if (provider === "cloudflare") {
          const zones = await cfListZones();
          const z = zones.find((z) => z.id === zoneId || z.name === zoneId);
          if (!z) { console.error(`Zone not found: ${zoneId}`); process.exit(1); }
          if (opts.json) { console.log(JSON.stringify(z, null, 2)); return; }
          console.log(`\nZone: ${z.name}`);
          console.log(`  ID:     ${z.id}`);
          console.log(`  Status: ${z.status}`);
          if (z.nameservers?.length) { console.log(`  Name servers:`); for (const ns of z.nameservers) console.log(`    ${ns}`); }
          console.log();
        } else {
          const z = await getHostedZone(zoneId);
          if (opts.json) { console.log(JSON.stringify(z, null, 2)); return; }
          console.log(`\nZone: ${z.name}`);
          console.log(`  ID:      ${z.id}`);
          console.log(`  Records: ${z.record_count}`);
          if (z.comment) console.log(`  Comment: ${z.comment}`);
          if (z.name_servers?.length) { console.log(`  Name servers:`); for (const ns of z.name_servers) console.log(`    ${ns}`); }
          console.log();
        }
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  zone
    .command("delete <zoneId>")
    .description("Delete a hosted zone (irreversible — requires --force)")
    .option("--provider <name>", "DNS provider")
    .option("--force", "Confirm deletion")
    .action(async (zoneId: string, opts: { provider?: string; force?: boolean }) => {
      const provider = resolveProvider(opts.provider);
      try {
        if (!opts.force) {
          console.log(`Would delete zone: ${zoneId} (${provider})`);
          console.log("Re-run with --force to confirm.");
          return;
        }
        if (provider === "cloudflare") {
          await cfDeleteZone(zoneId);
        } else {
          await deleteHostedZone(zoneId);
        }
        console.log(`✓ Zone deleted: ${zoneId}`);
      } catch (e) {
        console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });
}
