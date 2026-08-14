/**
 * Domain Research — Exa AI integration for deep domain research.
 * Uses the Exa connector to search for domain ownership info, company details,
 * and historical context.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getDomainByIdentifier } from "./domains.js";
import { createHistoryEntry, type DomainHistory } from "./history.js";

const execFileAsync = promisify(execFile);

export interface ExaSearchResult {
  title: string;
  url: string;
  text: string;
  score: number;
  publishedDate?: string;
}

export interface ExaCompanyResult {
  name: string;
  domain: string;
  description: string;
  industry?: string;
  size?: string;
  founded?: string;
  location?: string;
}

export interface ExaResearchResult {
  domain: string;
  summary: string | null;
  results: ExaSearchResult[];
  companies: ExaCompanyResult[];
  ownerId: string | null;
  savedHistory: DomainHistory | null;
}

/**
 * Run a web search via Exa connector for domain research.
 * Returns parsed results from JSON output.
 */
async function runExaCommand(args: string[]): Promise<Record<string, unknown>> {
  const { stdout } = await execFileAsync("connect-exa", args, {
    encoding: "utf-8",
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  try {
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch {
    return { raw: stdout };
  }
}

/**
 * Search for domain ownership and company information using Exa.
 */
export async function searchDomainWithExa(domainName: string): Promise<{
  results: ExaSearchResult[];
  companies: ExaCompanyResult[];
}> {
  // Search for "who owns domainName" + company info
  const searchResult = await runExaCommand([
    "search",
    `who owns ${domainName} company owner contact`,
    "--num-results", "5",
    "--format", "json",
  ]);

  const results = parseSearchResults(searchResult);

  // Also search the domain directly in Exa's company index
  let companies: ExaCompanyResult[] = [];
  try {
    const companyResult = await runExaCommand([
      "search",
    domainName,
      "--num-results", "3",
      "--use-domain", "true",
      "--format", "json",
    ]);
    companies = parseCompanyResults(companyResult);
  } catch {
    // Domain search may fail — continue with web results
  }

  return { results, companies };
}

/**
 * Deep research on a domain using Exa's research task API.
 * This is more expensive but provides detailed analysis.
 */
export async function deepSearchDomain(domainName: string): Promise<string | null> {
  try {
    const result = await runExaCommand([
      "research",
      `Research: who owns ${domainName}, company details, contact information, business history`,
      "--format", "json",
    ]);
    return (result.summary as string) ?? (result.raw as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * Full domain research: search + company lookup + history save.
 */
export async function researchDomain(domainName: string): Promise<ExaResearchResult> {
  const domain = await getDomainByIdentifier(domainName);
  if (!domain) throw new Error(`Domain '${domainName}' not found in database`);

  const { results, companies } = await searchDomainWithExa(domainName);
  const summary = await deepSearchDomain(domainName);

  // Build a combined owner hint from results
  const ownerId: string | null = null;

  // Save everything to history
  const history = await createHistoryEntry({
    domain_id: domain.id,
    snapshot_type: "exa_research",
    raw_data: {
      summary,
      results: results.map((r) => ({ title: r.title, url: r.url, score: r.score })),
      companies: companies.map((c) => ({ name: c.name, domain: c.domain, description: c.description })),
    },
    notes: summary ? summary.substring(0, 500) : `Found ${results.length} results, ${companies.length} companies`,
  });

  return {
    domain: domainName,
    summary,
    results,
    companies,
    ownerId,
    savedHistory: history,
  };
}

/**
 * Answer a specific question about a domain using Exa.
 */
export async function answerAboutDomain(
  domainName: string,
  question: string
): Promise<string | null> {
  try {
    const result = await runExaCommand([
      "answer",
      question,
      "--domains", domainName,
      "--format", "json",
    ]);
    return (result.answer as string) ?? null;
  } catch {
    return null;
  }
}

// ── Parsing helpers ────────────────────────────────────────────────────────

function parseSearchResults(data: Record<string, unknown>): ExaSearchResult[] {
  const results = data.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
    .map((r) => ({
      title: (r.title as string) ?? "",
      url: (r.url as string) ?? "",
      text: (r.text as string) ?? "",
      score: (r.score as number) ?? 0,
      publishedDate: (r.published_date as string),
    }));
}

function parseCompanyResults(data: Record<string, unknown>): ExaCompanyResult[] {
  const results = data.results;
  if (!Array.isArray(results)) return [];
  return results
    .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
    .map((r) => ({
      name: (r.title as string) ?? "",
      domain: (r.url as string) ?? "",
      description: (r.text as string) ?? "",
    }));
}
