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
  getDomain,
  getDomainByName,
} from "../../db/domains.js";
import { readFileSync, writeFileSync } from "node:fs";
import { getDnsProvider, type DnsProvider } from "../../lib/registrar.js";
import { loadConfig } from "../../lib/config.js";
import {
  createDnsPlan,
  getDnsApplyBlockReason,
  parseDesiredDnsState,
  planHasChanges,
  selectChangedDnsRecords,
  type DnsPlan,
} from "../../lib/dns-plan.js";
import { compactHint, pageItemsOrExit, truncateText } from "../../lib/compact-output.js";

import { printLine, printErrorLine } from "../../lib/stdout.js";
/** Record types the store (local sqlite CHECK + cloud API) accepts on write. */
export const SUPPORTED_DNS_TYPES = new Set(["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV"]);

/**
 * Split provider-returned records into persistable ones and skipped ones.
 * Real zones always carry provider-managed records (SOA, and often CAA) whose
 * types are outside the supported set; persisting them fails the local CHECK
 * constraint and makes the cloud API return 400. `dns pull` must skip them.
 */
export function partitionPullableRecords<T extends { type: string }>(
  records: T[],
): { keep: T[]; skipped: Map<string, number> } {
  const keep: T[] = [];
  const skipped = new Map<string, number>();
  for (const r of records) {
    if (SUPPORTED_DNS_TYPES.has(r.type)) {
      keep.push(r);
    } else {
      skipped.set(r.type, (skipped.get(r.type) ?? 0) + 1);
    }
  }
  return { keep, skipped };
}

function printDnsPlan(plan: DnsPlan): void {
  printLine(`DNS plan for ${plan.domain}: ${plan.creates} create, ${plan.updates} update, ${plan.deletes} delete, ${plan.unchanged} unchanged`);
  for (const op of plan.operations) {
    if (op.op === "unchanged") continue;
    const priority = op.record.priority == null ? "" : ` priority=${op.record.priority}`;
    const currentTtl = op.current && op.current.ttl !== op.record.ttl ? ` ttl ${op.current.ttl}->${op.record.ttl}` : "";
    printLine(`  ${op.op.toUpperCase()} ${op.record.type} ${op.record.name} ${op.record.value} ttl=${op.record.ttl}${priority}${currentTtl}`);
  }
}

async function loadDnsPlan(
  domain: string,
  providerName: string,
  file: string,
  resolveDnsProvider: (name: string) => DnsProvider = getDnsProvider,
): Promise<DnsPlan> {
  const desired = parseDesiredDnsState(readFileSync(file, "utf-8"), domain);
  const planDomain = desired.domain ?? domain;
  const provider = resolveDnsProvider(providerName);
  const current = await provider.getDnsRecords(planDomain);
  return createDnsPlan(planDomain, current, desired.records);
}

export function registerDnsCommands(
  program: Command,
  deps: { getDnsProvider?: (name: string) => DnsProvider } = {},
): void {
  const resolveDnsProvider = deps.getDnsProvider ?? getDnsProvider;
  const dnsCmd = program
    .command("dns")
    .description("DNS record management");

  dnsCmd
    .command("plan <domain>")
    .description("Preview desired DNS state changes from a JSON file without mutating provider records")
    .requiredOption("--file <path>", "Desired DNS state JSON file")
    .option("--provider <name>", "DNS provider — defaults to config default-dns")
    .option("--json", "Output as JSON", false)
    .action(async (domain: string, opts: { file: string; provider?: string; json?: boolean }) => {
      const providerName = opts.provider ?? loadConfig().default_dns ?? "route53";
      try {
        const plan = await loadDnsPlan(domain, providerName, opts.file, resolveDnsProvider);
        if (opts.json) printLine(JSON.stringify(plan, null, 2));
        else printDnsPlan(plan);
      } catch (e) {
        printErrorLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  dnsCmd
    .command("diff <domain>")
    .description("Alias of dns plan: show live provider DNS drift against desired JSON state")
    .requiredOption("--file <path>", "Desired DNS state JSON file")
    .option("--provider <name>", "DNS provider — defaults to config default-dns")
    .option("--json", "Output as JSON", false)
    .action(async (domain: string, opts: { file: string; provider?: string; json?: boolean }) => {
      const providerName = opts.provider ?? loadConfig().default_dns ?? "route53";
      try {
        const plan = await loadDnsPlan(domain, providerName, opts.file, resolveDnsProvider);
        if (opts.json) printLine(JSON.stringify(plan, null, 2));
        else printDnsPlan(plan);
        if (planHasChanges(plan)) process.exitCode = 2;
      } catch (e) {
        printErrorLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  dnsCmd
    .command("apply <domain>")
    .description("Apply desired DNS state from a JSON file to a live provider")
    .requiredOption("--file <path>", "Desired DNS state JSON file")
    .option("--provider <name>", "DNS provider — defaults to config default-dns")
    .option("--yes", "Apply changes without interactive confirmation", false)
    .option("--allow-delete", "Acknowledge delete plans; delete apply is refused unless the provider can converge without partial mutation", false)
    .option("--json", "Output as JSON", false)
    .action(async (domain: string, opts: { file: string; provider?: string; yes?: boolean; allowDelete?: boolean; json?: boolean }) => {
      const providerName = opts.provider ?? loadConfig().default_dns ?? "route53";
      try {
        const desired = parseDesiredDnsState(readFileSync(opts.file, "utf-8"), domain);
        const planDomain = desired.domain ?? domain;
        const provider = resolveDnsProvider(providerName);
        const current = await provider.getDnsRecords(planDomain);
        const plan = createDnsPlan(planDomain, current, desired.records);
        if (!planHasChanges(plan)) {
          if (opts.json) printLine(JSON.stringify({ applied: false, reason: "no-changes", plan }, null, 2));
          else printDnsPlan(plan);
          return;
        }
        const blockReason = getDnsApplyBlockReason(
          plan,
          { yes: opts.yes, allowDelete: opts.allowDelete },
          typeof provider.deleteDnsRecords === "function",
        );
        if (blockReason) {
          if (opts.json) printLine(JSON.stringify({ applied: false, reason: blockReason, plan }, null, 2));
          else {
            printDnsPlan(plan);
            if (blockReason === "confirmation-required") printErrorLine("Refusing to apply without --yes.");
            if (blockReason === "delete-confirmation-required") printErrorLine("Refusing to delete DNS records without --allow-delete.");
            if (blockReason === "delete-apply-unsupported") printErrorLine(`Refusing to apply delete plan on ${providerName}: this provider path cannot guarantee delete convergence without partial mutation yet.`);
          }
          process.exit(1);
        }
        // Live deletes run BEFORE the create/update write: a group that mixes a delete
        // with a recreate converges in one pass instead of transiently duplicating, and
        // a delete-only group is expressed through the provider's own delete route
        // rather than being dropped as a change group with no desired siblings.
        if (plan.deletes > 0 && provider.deleteDnsRecords) {
          const deleteRecords = plan.operations
            .filter((operation) => operation.op === "delete")
            .map((operation) => operation.record);
          const deleted = await provider.deleteDnsRecords(planDomain, deleteRecords);
          if (!deleted) {
            if (opts.json) {
              printLine(JSON.stringify({ applied: false, provider: providerName, reason: "delete-failed", plan }, null, 2));
            } else {
              printErrorLine(`Provider ${providerName} could not delete the recorded DNS records for ${planDomain}.`);
            }
            process.exit(1);
          }
        }
        const recordsToApply = provider.dnsWriteScope === "changed-groups"
          ? selectChangedDnsRecords(plan, desired.records)
          : desired.records;
        await provider.setDnsRecords(planDomain, recordsToApply);
        const verified = createDnsPlan(planDomain, await provider.getDnsRecords(planDomain), desired.records);
        if (planHasChanges(verified)) {
          if (opts.json) printLine(JSON.stringify({ applied: false, provider: providerName, reason: "verification-failed", plan, verification: verified }, null, 2));
          else {
            printDnsPlan(verified);
            printErrorLine(`Provider ${providerName} did not converge to the desired DNS state for ${planDomain}.`);
          }
          process.exit(1);
        }
        if (opts.json) printLine(JSON.stringify({ applied: true, provider: providerName, plan, verification: verified }, null, 2));
        else {
          printDnsPlan(plan);
          printLine(`✓ Applied and verified desired DNS state on ${providerName} for ${planDomain}`);
        }
      } catch (e) {
        printErrorLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });

  dnsCmd
    .command("list")
    .description("List DNS records for a domain")
    .argument("<domain-id>", "Domain ID")
    .option("--type <type>", "Filter by record type (A/AAAA/CNAME/MX/TXT/NS/SRV)")
    .option("--limit <n>", "Limit number of displayed records")
    .option("--all", "Show all matching records")
    .option("--json", "Output as JSON", false)
    .action(async (domainId, opts) => {
      const records = await listDnsRecords(domainId, opts.type);

      if (opts.json) {
        printLine(JSON.stringify(records, null, 2));
      } else {
        const page = pageItemsOrExit(records, { limit: opts.limit, all: opts.all });
        if (page.items.length === 0) {
          printLine("No DNS records found.");
          return;
        }
        for (const r of page.items) {
          const priority = r.priority !== null ? ` (priority: ${r.priority})` : "";
          printLine(`  ${r.type}\t${r.name}\t${truncateText(r.value, 80)}\tTTL:${r.ttl}${priority}`);
        }
        printLine(`\n${compactHint(page, "record(s)", "Use --all for every record or --json for full values.", { paging: "limit" })}`);
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
    .action(async (opts) => {
      const record = await createDnsRecord({
        domain_id: opts.domain,
        type: opts.type,
        name: opts.name,
        value: opts.value,
        ttl: parseInt(opts.ttl),
        priority: opts.priority ? parseInt(opts.priority) : undefined,
      });

      if (opts.json) {
        printLine(JSON.stringify(record, null, 2));
      } else {
        printLine(`Created DNS record: ${record.type} ${record.name} -> ${record.value} (${record.id})`);
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
    .action(async (id, opts) => {
      const input: Record<string, unknown> = {};
      if (opts.type !== undefined) input.type = opts.type;
      if (opts.name !== undefined) input.name = opts.name;
      if (opts.value !== undefined) input.value = opts.value;
      if (opts.ttl !== undefined) input.ttl = parseInt(opts.ttl);
      if (opts.priority !== undefined) input.priority = parseInt(opts.priority);

      const record = await updateDnsRecord(id, input);
      if (!record) {
        printErrorLine(`DNS record '${id}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        printLine(JSON.stringify(record, null, 2));
      } else {
        printLine(`Updated DNS record: ${record.type} ${record.name} -> ${record.value}`);
      }
    });

  dnsCmd
    .command("remove")
    .description("Remove a DNS record")
    .argument("<id>", "Record ID")
    .action(async (id) => {
      const deleted = await deleteDnsRecord(id);
      if (deleted) {
        printLine(`Deleted DNS record ${id}`);
      } else {
        printErrorLine(`DNS record '${id}' not found.`);
        process.exit(1);
      }
    });

  dnsCmd
    .command("check-propagation")
    .description("Check DNS propagation across multiple servers")
    .argument("<domain>", "Domain name to check")
    .option("--record <type>", "Record type (A/AAAA/CNAME/MX/TXT/NS)", "A")
    .option("--json", "Output as JSON", false)
    .action(async (domain, opts) => {
      try {
        const result = await checkDnsPropagation(domain, opts.record);
        if (opts.json) {
          printLine(JSON.stringify(result, null, 2));
        } else {
          printLine(`DNS Propagation for ${result.domain} (${result.record_type}):`);
          printLine(`  Consistent: ${result.consistent ? "yes" : "NO"}`);
          for (const s of result.servers) {
            const values = s.values.length > 0 ? s.values.join(", ") : "(empty)";
            const status = s.status === "error" ? ` [ERROR: ${s.error}]` : "";
            printLine(`  ${s.name} (${s.server}): ${values}${status}`);
          }
        }
      } catch (error: unknown) {
        printErrorLine(`DNS propagation check failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  dnsCmd
    .command("export")
    .description("Export DNS records as BIND zone file")
    .argument("<domain-id>", "Domain ID")
    .option("--output <file>", "Write to file instead of stdout")
    .action(async (domainId, opts) => {
      const zone = await exportZoneFile(domainId);
      if (!zone) {
        printErrorLine(`Domain '${domainId}' not found.`);
        process.exit(1);
      }
      if (opts.output) {
        writeFileSync(opts.output, zone, "utf-8");
        printLine(`Exported zone file to ${opts.output}`);
      } else {
        printLine(zone);
      }
    });

  dnsCmd
    .command("import")
    .description("Import DNS records from a BIND zone file")
    .argument("<domain-id>", "Domain ID")
    .requiredOption("--file <path>", "Path to zone file")
    .option("--json", "Output as JSON", false)
    .action(async (domainId, opts) => {
      let content: string;
      try {
        content = readFileSync(opts.file, "utf-8");
      } catch {
        printErrorLine(`Could not read file: ${opts.file}`);
        process.exit(1);
      }

      const result = await importZoneFile(domainId, content);
      if (!result) {
        printErrorLine(`Domain '${domainId}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        printLine(JSON.stringify(result, null, 2));
      } else {
        printLine(`Imported ${result.imported} record(s), skipped ${result.skipped}`);
        if (result.errors.length > 0) {
          printLine("Errors:");
          for (const e of result.errors) {
            printLine(`  - ${e}`);
          }
        }
      }
    });

  dnsCmd
    .command("discover-subdomains")
    .description("Discover subdomains via certificate transparency logs (crt.sh)")
    .argument("<domain>", "Domain name")
    .option("--limit <n>", "Limit number of displayed subdomains")
    .option("--all", "Show all discovered subdomains")
    .option("--json", "Output as JSON", false)
    .action(async (domain, opts) => {
      const result = await discoverSubdomains(domain);
      if (opts.json) {
        printLine(JSON.stringify(result, null, 2));
      } else {
        if (result.error) {
          printErrorLine(`Discovery failed: ${result.error}`);
          process.exit(1);
        }
        if (result.subdomains.length === 0) {
          printLine(`No subdomains found for ${domain}.`);
          return;
        }
        const page = pageItemsOrExit(result.subdomains, { limit: opts.limit, all: opts.all });
        printLine(`Subdomains for ${domain} (source: ${result.source}):`);
        for (const s of page.items) {
          printLine(`  ${s}`);
        }
        printLine(`\n${compactHint(page, "subdomain(s)", "Use --all for every discovered name or --json for the full result.", { paging: "limit" })}`);
      }
    });

  dnsCmd
    .command("validate")
    .description("Validate DNS records for common issues")
    .argument("<domain-id>", "Domain ID")
    .option("--json", "Output as JSON", false)
    .action(async (domainId, opts) => {
      const result = await validateDns(domainId);
      if (!result) {
        printErrorLine(`Domain '${domainId}' not found.`);
        process.exit(1);
      }

      if (opts.json) {
        printLine(JSON.stringify(result, null, 2));
      } else {
        printLine(`DNS Validation for ${result.domain_name}:`);
        printLine(`  Valid: ${result.valid ? "yes" : "NO"}`);
        if (result.issues.length === 0) {
          printLine("  No issues found.");
        } else {
          for (const issue of result.issues) {
            const prefix = issue.type === "error" ? "ERROR" : "WARN";
            printLine(`  [${prefix}] ${issue.message}`);
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
        const provider = resolveDnsProvider(providerName);
        const records = await provider.getDnsRecords(domain);
        const dbDomain = await getDomainByName(domain);
        if (!dbDomain) {
          printErrorLine(`Domain '${domain}' not found in local DB. Add it first: domains domain add --name ${domain}`);
          process.exit(1);
        }
        // Skip provider-managed types (SOA/CAA/…) the store cannot persist.
        const { keep, skipped } = partitionPullableRecords(records);
        let count = 0;
        for (const r of keep) {
          await createDnsRecord({ domain_id: dbDomain.id, type: r.type as "A" | "AAAA" | "CNAME" | "MX" | "TXT" | "NS" | "SRV", name: r.name, value: r.value, ttl: r.ttl, priority: r.priority });
          count++;
        }
        printLine(`✓ Pulled ${count} record(s) from ${providerName} into local DB for ${domain}`);
        if (skipped.size > 0) {
          const summary = Array.from(skipped.entries()).map(([t, n]) => `${n} ${t}`).join(", ");
          printLine(`  Skipped ${summary} record(s) (unsupported/provider-managed type).`);
        }
      } catch (e) {
        printErrorLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
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
        const records = await listDnsRecords(domainId);
        if (records.length === 0) { printLine("No local DNS records to push."); return; }
        const dbDomain = (await getDomain(domainId)) ?? (() => { throw new Error(`Domain '${domainId}' not found`); })();
        const provider = resolveDnsProvider(providerName);
        await provider.setDnsRecords(dbDomain.name, records.map((r) => ({
          type: r.type, name: r.name, value: r.value, ttl: r.ttl, priority: r.priority ?? undefined,
        })));
        printLine(`✓ Pushed ${records.length} record(s) to ${providerName} for ${dbDomain.name}`);
      } catch (e) {
        printErrorLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
        process.exit(1);
      }
    });
}
