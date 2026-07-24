import type { Command } from "commander";
import {
  getHistoryByDomain,
  getHistoryByDateRange,
  listDomainsWithHistoryChanges,
  deleteHistoryEntry,
  deleteHistoryByDomain,
  type DomainHistoryType,
} from "../../db/history.js";
import { getDomainDetails } from "../../db/domains.js";
import { compactHint, pageItemsOrExit, truncateText } from "../../lib/compact-output.js";

export function registerHistoryCommand(program: Command): void {
  const history = program
    .command("history")
    .description("Domain history tracking (WHOIS/RDAP/DNS/SSL snapshots)");

  // ── list ────────────────────────────────────────────────────────────────

  history
    .command("list <identifier>")
    .description("List history entries for a domain")
    .option("--type <type>", "Filter by type (whois/rdap/dns/ssl/reputation/exa_research)")
    .option("--limit <n>", "Limit results", "20")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { type?: string; limit?: string; json?: boolean }) => {
      const domain = await getDomainDetails(identifier);
      if (!domain) {
        console.error(`Domain '${identifier}' not found.`);
        process.exit(1);
      }

      const entries = await getHistoryByDomain(domain.domain.id, {
        type: opts.type as DomainHistoryType | undefined,
        limit: opts.limit ? parseInt(opts.limit) : undefined,
      });

      if (opts.json) {
        console.log(JSON.stringify({ domain: domain.domain.name, history: entries, count: entries.length }, null, 2));
        return;
      }
      if (entries.length === 0) {
        console.log(`No history entries for ${domain.domain.name}.`);
        return;
      }
      console.log(`History for ${domain.domain.name}:`);
      for (const e of entries) {
        console.log(`  [${e.created_at}] ${e.snapshot_type} — ${e.registrant_name ?? e.registrant_email ?? "no owner info"}`);
        if (e.registrar) console.log(`    Registrar: ${e.registrar}`);
        if (e.notes) console.log(`    Notes: ${truncateText(e.notes, 120)}`);
      }
      console.log(`\n${entries.length} entry(ies). Use --limit <n> for a different page size or --json for full snapshots.`);
    });

  // ── timeline ────────────────────────────────────────────────────────────

  history
    .command("timeline")
    .description("Show all domains with history changes")
    .option("--limit <n>", "Limit number of displayed domains")
    .option("--all", "Show all domains with history")
    .option("-j, --json", "Output JSON")
    .action(async (opts: { limit?: string; all?: boolean; json?: boolean }) => {
      const results = await listDomainsWithHistoryChanges();
      if (opts.json) {
        console.log(JSON.stringify({ domains: results, count: results.length }, null, 2));
        return;
      }
      if (results.length === 0) {
        console.log("No domains with history entries.");
        return;
      }
      const page = pageItemsOrExit(results, { limit: opts.limit, all: opts.all });
      console.log("Domain History Timeline:");
      for (const r of page.items) {
        console.log(`  ${r.domain_name} — ${r.snapshot_count} snapshots, latest: ${r.latest_snapshot_type} at ${r.latest_snapshot_at}`);
      }
      console.log(`\n${compactHint(page, "domain(s) with history", "Use history list <domain> for domain details or --json for full data.", { paging: "limit" })}`);
    });

  // ── range ───────────────────────────────────────────────────────────────

  history
    .command("range")
    .description("List history entries within a date range")
    .requiredOption("--from <date>", "Start date (ISO)")
    .requiredOption("--to <date>", "End date (ISO)")
    .option("--domain <name>", "Filter by domain name")
    .option("--limit <n>", "Limit number of displayed entries")
    .option("--all", "Show all entries in range")
    .option("--verbose", "Show truncated notes and registrar details")
    .option("-j, --json", "Output JSON")
    .action(async (opts: { from: string; to: string; domain?: string; limit?: string; all?: boolean; verbose?: boolean; json?: boolean }) => {
      const entries = await getHistoryByDateRange(opts.from, opts.to, opts.domain);
      if (opts.json) {
        console.log(JSON.stringify({ history: entries, count: entries.length }, null, 2));
        return;
      }
      if (entries.length === 0) {
        console.log(`No history entries between ${opts.from} and ${opts.to}.`);
        return;
      }
      const page = pageItemsOrExit(entries, { limit: opts.limit, all: opts.all });
      console.log(`History from ${opts.from} to ${opts.to}:`);
      for (const e of page.items) {
        const extra = opts.verbose
          ? ` registrar:${truncateText(e.registrar ?? "-", 40)} notes:${truncateText(e.notes ?? "-", 80)}`
          : "";
        console.log(`  [${e.created_at}] ${e.snapshot_type} — domain ${e.domain_id}${extra}`);
      }
      console.log(`\n${compactHint(page, "entry(s)", "Use --verbose for more columns or --json for full snapshots.", { paging: "limit" })}`);
    });

  // ── delete ──────────────────────────────────────────────────────────────

  history
    .command("delete <entryId>")
    .description("Delete a history entry")
    .option("-f, --force", "Required confirmation")
    .action(async (entryId: string, opts: { force?: boolean }) => {
      if (!opts.force) {
        console.error(`Refusing to delete history '${entryId}' without --force.`);
        process.exit(1);
      }
      const deleted = await deleteHistoryEntry(entryId);
      if (!deleted) {
        console.error(`History entry '${entryId}' not found.`);
        process.exit(1);
      }
      console.log(`Deleted history entry ${entryId}`);
    });

  // ── purge ───────────────────────────────────────────────────────────────

  history
    .command("purge <identifier>")
    .description("Delete all history for a domain")
    .option("-f, --force", "Required confirmation")
    .action(async (identifier: string, opts: { force?: boolean }) => {
      if (!opts.force) {
        console.error(`Refusing to purge history for '${identifier}' without --force.`);
        process.exit(1);
      }
      const domain = await getDomainDetails(identifier);
      if (!domain) {
        console.error(`Domain '${identifier}' not found.`);
        process.exit(1);
      }
      const deleted = await deleteHistoryByDomain(domain.domain.id);
      if (!deleted) {
        console.error(`No history to purge for ${domain.domain.name}.`);
        process.exit(1);
      }
      console.log(`Purged all history for ${domain.domain.name}`);
    });
}
