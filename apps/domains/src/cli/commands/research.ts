import type { Command } from "commander";
import { researchDomain, answerAboutDomain } from "../../db/domain-research.js";
import { getDomainDetails } from "../../db/domains.js";
import { checkDomainReputation, listBlacklistedDomains, listHighThreatDomains } from "../../db/reputation.js";
import { compactHint, pageItemsOrExit, truncateText } from "../../lib/compact-output.js";

import { printLine, printErrorLine } from "../../lib/stdout.js";
export function registerResearchCommand(program: Command): void {
  const research = program
    .command("research")
    .description("AI-powered domain research and reputation checking");

  // ── exa ─────────────────────────────────────────────────────────────────

  research
    .command("exa <identifier>")
    .description("Research a domain using Exa AI (ownership, company info, history)")
    .option("--limit <n>", "Limit number of displayed web/company results")
    .option("--all", "Show all returned research results")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { limit?: string; all?: boolean; json?: boolean }) => {
      const domain = await getDomainDetails(identifier);
      if (!domain) {
        printErrorLine(`Domain '${identifier}' not found.`);
        process.exit(1);
      }

      try {
        const result = await researchDomain(domain.domain.name);

        if (opts.json) {
          printLine(JSON.stringify({
            domain: result.domain,
            summary: result.summary,
            results: result.results.map((r) => ({ title: r.title, url: r.url, score: r.score })),
            companies: result.companies.map((c) => ({ name: c.name, domain: c.domain })),
            history_id: result.savedHistory?.id,
          }, null, 2));
          return;
        }

        printLine(`Exa Research for ${result.domain}:`);
        if (result.summary) printLine(`\n  Summary: ${truncateText(result.summary, 240)}`);

        if (result.results.length > 0) {
          const page = pageItemsOrExit(result.results, { limit: opts.limit, all: opts.all });
          printLine("\n  Web Results:");
          for (const r of page.items) {
            printLine(`    - ${truncateText(r.title, 100)} (${r.score.toFixed(2)})`);
            printLine(`      ${r.url}`);
          }
          printLine(`    ${compactHint(page, "web result(s)", "Use --all for every result or --json for structured output.", { paging: "limit" })}`);
        }

        if (result.companies.length > 0) {
          const page = pageItemsOrExit(result.companies, { limit: opts.limit, all: opts.all });
          printLine("\n  Companies:");
          for (const c of page.items) {
            printLine(`    - ${c.name}: ${c.domain}`);
          }
          printLine(`    ${compactHint(page, "company result(s)", "Use --all for every company or --json for structured output.", { paging: "limit" })}`);
        }

        if (result.savedHistory) {
          printLine(`\n  Saved to history: ${result.savedHistory.id}`);
        }
        printLine();
      } catch (error: unknown) {
        printErrorLine(`Research failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // ── answer ──────────────────────────────────────────────────────────────

  research
    .command("answer <identifier> <question>")
    .description("Ask a specific question about a domain using Exa AI")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, question: string, opts: { json?: boolean }) => {
      const domain = await getDomainDetails(identifier);
      if (!domain) {
        printErrorLine(`Domain '${identifier}' not found.`);
        process.exit(1);
      }

      try {
        const answer = await answerAboutDomain(domain.domain.name, question);
        if (opts.json) {
          printLine(JSON.stringify({ domain: domain.domain.name, question, answer }, null, 2));
          return;
        }
        if (!answer) {
          printLine("No answer found.");
          return;
        }
        printLine(`Q: ${question}`);
        printLine(`A: ${answer}`);
      } catch (error: unknown) {
        printErrorLine(`Answer failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // ── reputation ──────────────────────────────────────────────────────────

  research
    .command("reputation <identifier>")
    .description("Check domain reputation and blacklist status")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { json?: boolean }) => {
      const domain = await getDomainDetails(identifier);
      if (!domain) {
        printErrorLine(`Domain '${identifier}' not found.`);
        process.exit(1);
      }

      const { reputation, dnsBlacklist } = await checkDomainReputation(domain.domain.name);

      if (opts.json) {
        printLine(JSON.stringify({ domain: domain.domain.name, reputation, dnsBlacklist }, null, 2));
        return;
      }

      printLine(`Reputation for ${domain.domain.name}:`);
      if (reputation) {
        printLine(`  Blacklisted: ${reputation.is_blacklisted ? "yes" : "no"}`);
        if (reputation.threat_score !== null) printLine(`  Threat Score: ${reputation.threat_score}`);
        if (reputation.spam_score !== null) printLine(`  Spam Score: ${reputation.spam_score}`);
        printLine(`  Malware: ${reputation.malware_detected ? "detected" : "clean"}`);
        printLine(`  Phishing: ${reputation.phishing_detected ? "detected" : "clean"}`);
        if (reputation.last_checked_at) printLine(`  Last Checked: ${reputation.last_checked_at}`);
      } else {
        printLine("  No reputation data yet.");
      }
      printLine(`  DNS Blacklist: ${dnsBlacklist.listed ? `listed in ${dnsBlacklist.zones.join(", ")}` : "clean"}`);
    });

  // ── blacklisted ─────────────────────────────────────────────────────────

  research
    .command("blacklisted")
    .description("List all blacklisted domains in the database")
    .option("--limit <n>", "Limit number of displayed domains")
    .option("--all", "Show all blacklisted domains")
    .option("-j, --json", "Output JSON")
    .action(async (opts: { limit?: string; all?: boolean; json?: boolean }) => {
      const domains = await listBlacklistedDomains();
      if (opts.json) {
        printLine(JSON.stringify({ domains, count: domains.length }, null, 2));
        return;
      }
      if (domains.length === 0) {
        printLine("No blacklisted domains.");
        return;
      }
      const page = pageItemsOrExit(domains, { limit: opts.limit, all: opts.all });
      printLine("Blacklisted domains:");
      for (const d of page.items) {
        printLine(`  domain_id: ${d.domain_id} (sources: ${truncateText(d.blacklist_sources.join(", "), 100)})`);
      }
      printLine(`\n${compactHint(page, "blacklisted domain(s)", "Use --all for every domain or --json for full source arrays.", { paging: "limit" })}`);
    });

  // ── threats ─────────────────────────────────────────────────────────────

  research
    .command("threats")
    .description("List domains with high threat scores")
    .option("--threshold <n>", "Minimum threat score", "70")
    .option("--limit <n>", "Limit number of displayed domains")
    .option("--all", "Show all matching domains")
    .option("-j, --json", "Output JSON")
    .action(async (opts: { threshold?: string; limit?: string; all?: boolean; json?: boolean }) => {
      const threshold = parseInt(opts.threshold ?? "70");
      const domains = await listHighThreatDomains(threshold);
      if (opts.json) {
        printLine(JSON.stringify({ domains, threshold, count: domains.length }, null, 2));
        return;
      }
      if (domains.length === 0) {
        printLine(`No domains with threat score >= ${threshold}.`);
        return;
      }
      const page = pageItemsOrExit(domains, { limit: opts.limit, all: opts.all });
      printLine(`Domains with threat score >= ${threshold}:`);
      for (const d of page.items) {
        printLine(`  domain_id: ${d.domain_id} — score: ${d.threat_score ?? "?"}`);
      }
      printLine(`\n${compactHint(page, "domain(s)", "Use --all for every domain or --json for full reputation records.", { paging: "limit" })}`);
    });
}
