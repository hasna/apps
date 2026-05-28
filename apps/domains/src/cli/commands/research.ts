import type { Command } from "commander";
import { researchDomain, answerAboutDomain } from "../../db/domain-research.js";
import { getDomainDetails } from "../../db/domains.js";
import { checkDomainReputation, getDomainReputationByName, listBlacklistedDomains, listHighThreatDomains } from "../../db/domain-reputation.js";

export function registerResearchCommand(program: Command): void {
  const research = program
    .command("research")
    .description("AI-powered domain research and reputation checking");

  // ── exa ─────────────────────────────────────────────────────────────────

  research
    .command("exa <identifier>")
    .description("Research a domain using Exa AI (ownership, company info, history)")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, opts: { json?: boolean }) => {
      const domain = getDomainDetails(identifier);
      if (!domain) {
        console.error(`Domain '${identifier}' not found.`);
        process.exit(1);
      }

      try {
        const result = await researchDomain(domain.domain.name);

        if (opts.json) {
          console.log(JSON.stringify({
            domain: result.domain,
            summary: result.summary,
            results: result.results.map((r) => ({ title: r.title, url: r.url, score: r.score })),
            companies: result.companies.map((c) => ({ name: c.name, domain: c.domain })),
            history_id: result.savedHistory?.id,
          }, null, 2));
          return;
        }

        console.log(`Exa Research for ${result.domain}:`);
        if (result.summary) console.log(`\n  Summary: ${result.summary}`);

        if (result.results.length > 0) {
          console.log("\n  Web Results:");
          for (const r of result.results) {
            console.log(`    - ${r.title} (${r.score.toFixed(2)})`);
            console.log(`      ${r.url}`);
          }
        }

        if (result.companies.length > 0) {
          console.log("\n  Companies:");
          for (const c of result.companies) {
            console.log(`    - ${c.name}: ${c.domain}`);
          }
        }

        if (result.savedHistory) {
          console.log(`\n  Saved to history: ${result.savedHistory.id}`);
        }
        console.log();
      } catch (error: unknown) {
        console.error(`Research failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // ── answer ──────────────────────────────────────────────────────────────

  research
    .command("answer <identifier> <question>")
    .description("Ask a specific question about a domain using Exa AI")
    .option("-j, --json", "Output JSON")
    .action(async (identifier: string, question: string, opts: { json?: boolean }) => {
      const domain = getDomainDetails(identifier);
      if (!domain) {
        console.error(`Domain '${identifier}' not found.`);
        process.exit(1);
      }

      try {
        const answer = await answerAboutDomain(domain.domain.name, question);
        if (opts.json) {
          console.log(JSON.stringify({ domain: domain.domain.name, question, answer }, null, 2));
          return;
        }
        if (!answer) {
          console.log("No answer found.");
          return;
        }
        console.log(`Q: ${question}`);
        console.log(`A: ${answer}`);
      } catch (error: unknown) {
        console.error(`Answer failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      }
    });

  // ── reputation ──────────────────────────────────────────────────────────

  research
    .command("reputation <identifier>")
    .description("Check domain reputation and blacklist status")
    .option("-j, --json", "Output JSON")
    .action((identifier: string, opts: { json?: boolean }) => {
      const domain = getDomainDetails(identifier);
      if (!domain) {
        console.error(`Domain '${identifier}' not found.`);
        process.exit(1);
      }

      const { reputation, dnsBlacklist } = checkDomainReputation(domain.domain.name);

      if (opts.json) {
        console.log(JSON.stringify({ domain: domain.domain.name, reputation, dnsBlacklist }, null, 2));
        return;
      }

      console.log(`Reputation for ${domain.domain.name}:`);
      if (reputation) {
        console.log(`  Blacklisted: ${reputation.is_blacklisted ? "yes" : "no"}`);
        if (reputation.threat_score !== null) console.log(`  Threat Score: ${reputation.threat_score}`);
        if (reputation.spam_score !== null) console.log(`  Spam Score: ${reputation.spam_score}`);
        console.log(`  Malware: ${reputation.malware_detected ? "detected" : "clean"}`);
        console.log(`  Phishing: ${reputation.phishing_detected ? "detected" : "clean"}`);
        if (reputation.last_checked_at) console.log(`  Last Checked: ${reputation.last_checked_at}`);
      } else {
        console.log("  No reputation data yet.");
      }
      console.log(`  DNS Blacklist: ${dnsBlacklist.listed ? `listed in ${dnsBlacklist.zones.join(", ")}` : "clean"}`);
    });

  // ── blacklisted ─────────────────────────────────────────────────────────

  research
    .command("blacklisted")
    .description("List all blacklisted domains in the database")
    .option("-j, --json", "Output JSON")
    .action((opts: { json?: boolean }) => {
      const domains = listBlacklistedDomains();
      if (opts.json) {
        console.log(JSON.stringify({ domains, count: domains.length }, null, 2));
        return;
      }
      if (domains.length === 0) {
        console.log("No blacklisted domains.");
        return;
      }
      console.log("Blacklisted domains:");
      for (const d of domains) {
        console.log(`  domain_id: ${d.domain_id} (sources: ${d.blacklist_sources.join(", ")})`);
      }
      console.log(`\n${domains.length} blacklisted domain(s)`);
    });

  // ── threats ─────────────────────────────────────────────────────────────

  research
    .command("threats")
    .description("List domains with high threat scores")
    .option("--threshold <n>", "Minimum threat score", "70")
    .option("-j, --json", "Output JSON")
    .action((opts: { threshold?: string; json?: boolean }) => {
      const threshold = parseInt(opts.threshold ?? "70");
      const domains = listHighThreatDomains(threshold);
      if (opts.json) {
        console.log(JSON.stringify({ domains, threshold, count: domains.length }, null, 2));
        return;
      }
      if (domains.length === 0) {
        console.log(`No domains with threat score >= ${threshold}.`);
        return;
      }
      console.log(`Domains with threat score >= ${threshold}:`);
      for (const d of domains) {
        console.log(`  domain_id: ${d.domain_id} — score: ${d.threat_score ?? "?"}`);
      }
      console.log(`\n${domains.length} domain(s)`);
    });
}
