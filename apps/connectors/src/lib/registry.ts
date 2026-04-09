/**
 * Connector registry - metadata about all available connectors
 */

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getInternalConnectorDefinition } from "../core/builtins.js";
import { bestFuzzyScore } from "./fuzzy.js";
import { expandQuery } from "./synonyms.js";

export interface ConnectorMeta {
  name: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  version?: string;
}

export const CATEGORIES = [
  "AI & ML",
  "Developer Tools",
  "Design & Content",
  "Communication",
  "Social Media",
  "Commerce & Finance",
  "Google Workspace",
  "Data & Analytics",
  "Business Tools",
  "Patents & IP",
  "Advertising",
  "Security & Compliance",
  "Marketing & Sales",
  "Infrastructure",
  "Healthcare & Hospitality",
  "IoT & Messaging",
  "Database",
] as const;

export type Category = (typeof CATEGORIES)[number];

import { connectors as ai_ml } from "./connectors/ai-ml.js";
import { connectors as advertising } from "./connectors/advertising.js";
import { connectors as business_tools } from "./connectors/business-tools.js";
import { connectors as commerce_finance } from "./connectors/commerce-finance.js";
import { connectors as communication } from "./connectors/communication.js";
import { connectors as data_analytics } from "./connectors/data-analytics.js";
import { connectors as database } from "./connectors/database.js";
import { connectors as design_content } from "./connectors/design-content.js";
import { connectors as developer_tools } from "./connectors/developer-tools.js";
import { connectors as google_workspace } from "./connectors/google-workspace.js";
import { connectors as healthcare_hospitality } from "./connectors/healthcare-hospitality.js";
import { connectors as infrastructure } from "./connectors/infrastructure.js";
import { connectors as iot_messaging } from "./connectors/iot-messaging.js";
import { connectors as marketing_sales } from "./connectors/marketing-sales.js";
import { connectors as patents_ip } from "./connectors/patents-ip.js";
import { connectors as security_compliance } from "./connectors/security-compliance.js";
import { connectors as social_media } from "./connectors/social-media.js";

export const CONNECTORS: ConnectorMeta[] = [
  ...ai_ml,
  ...advertising,
  ...business_tools,
  ...commerce_finance,
  ...communication,
  ...data_analytics,
  ...database,
  ...design_content,
  ...developer_tools,
  ...google_workspace,
  ...healthcare_hospitality,
  ...infrastructure,
  ...iot_messaging,
  ...marketing_sales,
  ...patents_ip,
  ...security_compliance,
  ...social_media,
];

export function getConnectorsByCategory(category: Category): ConnectorMeta[] {
  return CONNECTORS.filter((c) => c.category === category);
}

export interface SearchContext {
  installed?: string[];
  promoted?: string[];
  usage?: Map<string, number>;
}

export interface ScoredResult extends ConnectorMeta {
  score: number;
  matchReasons: string[];
  badges: string[];
}

/**
 * Ranked connector search with multi-token AND, scoring, and context signals.
 *
 * Score formula:
 *   relevance (name/tag/displayName/description matches)
 *   + installed boost (+50)
 *   + promoted boost (+30)
 *   + usage boost (min(count * 2, 40))
 */
export function searchConnectors(
  query: string,
  context?: SearchContext & { limit?: number }
): ScoredResult[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const limit = context?.limit ?? 20;
  const installed = new Set(context?.installed ?? []);
  const promoted = new Set(context?.promoted ?? []);
  const usage = context?.usage ?? new Map<string, number>();

  const results: ScoredResult[] = [];

  for (const c of CONNECTORS) {
    const nameLow = c.name.toLowerCase();
    const displayLow = c.displayName.toLowerCase();
    const descLow = c.description.toLowerCase();
    const tagsLow = c.tags.map((t) => t.toLowerCase());

    let score = 0;
    const matchReasons: string[] = [];
    let allTokensMatch = true;

    for (const token of tokens) {
      let tokenMatched = false;

      // Exact name match
      if (nameLow === token) {
        score += 100;
        matchReasons.push(`name="${token}"`);
        tokenMatched = true;
      } else if (nameLow.includes(token)) {
        score += 10;
        matchReasons.push(`name~${token}`);
        tokenMatched = true;
      }

      // Tag exact match
      if (tagsLow.includes(token)) {
        score += 8;
        if (!tokenMatched) matchReasons.push(`tag="${token}"`);
        tokenMatched = true;
      } else if (tagsLow.some((t) => t.includes(token))) {
        score += 5;
        if (!tokenMatched) matchReasons.push(`tag~${token}`);
        tokenMatched = true;
      }

      // displayName
      if (displayLow.includes(token)) {
        score += 3;
        if (!tokenMatched) matchReasons.push(`display~${token}`);
        tokenMatched = true;
      }

      // description
      if (descLow.includes(token)) {
        score += 1;
        if (!tokenMatched) matchReasons.push(`desc~${token}`);
        tokenMatched = true;
      }

      // Fuzzy fallback (only for tokens >= 3 chars)
      if (!tokenMatched && token.length >= 3) {
        const nameFuzzy = bestFuzzyScore(token, [nameLow], 1);
        if (nameFuzzy > 0) {
          score += nameFuzzy * 6;
          matchReasons.push(`fuzzy:name≈${token}`);
          tokenMatched = true;
        }
        if (!tokenMatched) {
          const tagFuzzy = bestFuzzyScore(token, tagsLow, 2);
          if (tagFuzzy > 0) {
            score += tagFuzzy * 3;
            matchReasons.push(`fuzzy:tag≈${token}`);
            tokenMatched = true;
          }
        }
        if (!tokenMatched) {
          const displayFuzzy = bestFuzzyScore(token, [displayLow], 2);
          if (displayFuzzy > 0) {
            score += displayFuzzy * 2;
            matchReasons.push(`fuzzy:display≈${token}`);
            tokenMatched = true;
          }
        }
      }

      if (!tokenMatched) {
        allTokensMatch = false;
        break;
      }
    }

    // Multi-token AND: all tokens must match somewhere
    if (!allTokensMatch) continue;

    // Context boosts
    const badges: string[] = [];
    if (installed.has(c.name)) {
      score += 50;
      badges.push("installed");
    }
    if (promoted.has(c.name)) {
      score += 30;
      badges.push("promoted");
    }
    const usageCount = usage.get(c.name) ?? 0;
    if (usageCount > 0) {
      score += Math.min(usageCount * 2, 40);
      if (usageCount >= 5) badges.push("hot");
    }

    results.push({ ...c, score, matchReasons, badges });
  }

  // Synonym expansion: if few direct results, search again with expanded terms
  const matchedNames = new Set(results.map((r) => r.name));
  if (results.length < limit) {
    const { expanded } = expandQuery(tokens);
    if (expanded.length > 0) {
      for (const c of CONNECTORS) {
        if (matchedNames.has(c.name)) continue; // skip already matched
        const nameLow2 = c.name.toLowerCase();
        const tagsLow2 = c.tags.map((t) => t.toLowerCase());
        const descLow2 = c.description.toLowerCase();

        let synScore = 0;
        const synReasons: string[] = [];

        for (const syn of expanded) {
          if (nameLow2.includes(syn)) { synScore += 2; synReasons.push(`syn:name~${syn}`); }
          else if (tagsLow2.some((t) => t.includes(syn))) { synScore += 1; synReasons.push(`syn:tag~${syn}`); }
          else if (descLow2.includes(syn)) { synScore += 1; synReasons.push(`syn:desc~${syn}`); }
        }

        if (synScore > 0) {
          const badges: string[] = [];
          if (installed.has(c.name)) { synScore += 50; badges.push("installed"); }
          if (promoted.has(c.name)) { synScore += 30; badges.push("promoted"); }
          const usageCount = usage.get(c.name) ?? 0;
          if (usageCount > 0) { synScore += Math.min(usageCount * 2, 40); if (usageCount >= 5) badges.push("hot"); }
          results.push({ ...c, score: synScore, matchReasons: synReasons, badges });
        }
      }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

export function getConnector(name: string): ConnectorMeta | undefined {
  return CONNECTORS.find((c) => c.name === name);
}

/**
 * Load versions from each connector's package.json into the registry.
 * Call once at CLI startup.
 */
let versionsLoaded = false;

export function loadConnectorVersions(): void {
  if (versionsLoaded) return;
  versionsLoaded = true;

  const thisDir = dirname(fileURLToPath(import.meta.url));
  // Resolve connectors directory from built (bin/) or source (src/lib/) location
  const candidates = [
    join(thisDir, "..", "connectors"),
    join(thisDir, "..", "..", "connectors"),
  ];
  const connectorsDir = candidates.find((d) => existsSync(d));
  if (!connectorsDir) return;

  for (const connector of CONNECTORS) {
    try {
      const pkgPath = join(connectorsDir, `connect-${connector.name}`, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        connector.version = pkg.version || "0.0.0";
        continue;
      }

      const internalDefinition = getInternalConnectorDefinition(connector.name);
      if (internalDefinition?.meta.version) {
        connector.version = internalDefinition.meta.version;
      }
    } catch {
      // skip
    }
  }
}
