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

import { printLine, printErrorLine } from "../../lib/stdout.js";
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
        if (opts.json) { printLine(JSON.stringify(zones, null, 2)); return; }
        const page = pageItemsOrExit(zones, { limit: opts.limit, all: opts.all });
        if (page.items.length === 0) { printLine("No hosted zones."); return; }
        printLine(`\nHosted Zones (${provider}):`);
        for (const z of page.items) {
          const extra = z.record_count !== undefined ? `  ${z.record_count} records` : "";
          printLine(`  ${z.id.padEnd(32)} ${z.name}${extra}`);
        }
        printLine(`\n${compactHint(page, "zone(s)", "Use --all for every zone or zone info <zoneId> for details.", { paging: "limit" })}`);
      } catch (e) {
        printErrorLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
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
          printLine(`✓ Zone created: ${domain} (${z.id})`);
          if (z.nameservers?.length) {
            printLine(`  Name servers:`);
            for (const ns of z.nameservers) printLine(`    ${ns}`);
          }
        } else {
          const z = await createHostedZone(domain, opts.comment);
          printLine(`✓ Zone created: ${domain} (${z.id})`);
          if (z.name_servers?.length) {
            printLine(`  Name servers:`);
            for (const ns of z.name_servers) printLine(`    ${ns}`);
          }
        }
      } catch (e) {
        printErrorLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
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
          if (!z) { printErrorLine(`Zone not found: ${zoneId}`); process.exit(1); }
          if (opts.json) { printLine(JSON.stringify(z, null, 2)); return; }
          printLine(`\nZone: ${z.name}`);
          printLine(`  ID:     ${z.id}`);
          printLine(`  Status: ${z.status}`);
          if (z.nameservers?.length) { printLine(`  Name servers:`); for (const ns of z.nameservers) printLine(`    ${ns}`); }
          printLine();
        } else {
          const z = await getHostedZone(zoneId);
          if (opts.json) { printLine(JSON.stringify(z, null, 2)); return; }
          printLine(`\nZone: ${z.name}`);
          printLine(`  ID:      ${z.id}`);
          printLine(`  Records: ${z.record_count}`);
          if (z.comment) printLine(`  Comment: ${z.comment}`);
          if (z.name_servers?.length) { printLine(`  Name servers:`); for (const ns of z.name_servers) printLine(`    ${ns}`); }
          printLine();
        }
      } catch (e) {
        printErrorLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
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
          printLine(`Would delete zone: ${zoneId} (${provider})`);
          printLine("Re-run with --force to confirm.");
          return;
        }
        if (provider === "cloudflare") {
          await cfDeleteZone(zoneId);
        } else {
          await deleteHostedZone(zoneId);
        }
        printLine(`✓ Zone deleted: ${zoneId}`);
      } catch (e) {
        printErrorLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });
}
