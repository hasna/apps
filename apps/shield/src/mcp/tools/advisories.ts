import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  listAdvisories,
  getAdvisory,
  searchAdvisories,
  isVersionAffected,
  getIOCsForAdvisory,
} from "../../db/index.js";
import {
  compactAdvisory,
  compactListResult,
  DEFAULT_ADVISORY_LIMIT,
  parseLimitOption,
  truncateText,
} from "../../lib/output.js";

type JsonResult = { content: Array<{ type: "text"; text: string }> };

export function registerAdvisoryTools(
  server: McpServer,
  jsonResult: (data: unknown) => JsonResult,
): void {
  // 21. check_package
  server.tool(
    "check_package",
    "Check if a specific package version is safe or compromised",
    {
      name: z.string().describe("Package name (e.g. axios, litellm)"),
      version: z.string().optional().describe("Specific version to check"),
      ecosystem: z.string().optional().describe("Ecosystem: npm, pypi, github-actions (default: npm)"),
      verbose: z.boolean().optional().describe("Return full advisory and IOC details"),
    },
    async ({ name, version, ecosystem, verbose }) => {
      try {
        const eco = ecosystem || "npm";
        if (version) {
          const advisory = isVersionAffected(name, eco, version);
          if (advisory) {
            const iocs = getIOCsForAdvisory(advisory.id);
            if (verbose) {
              return jsonResult({
                status: "COMPROMISED",
                package: `${name}@${version}`,
                advisory: {
                  id: advisory.id,
                  title: advisory.title,
                  attack_type: advisory.attack_type,
                  severity: advisory.severity,
                  threat_actor: advisory.threat_actor,
                  safe_versions: advisory.safe_versions,
                  detected_at: advisory.detected_at,
                },
                iocs: iocs.map((i) => ({ type: i.type, value: i.value, context: i.context })),
                ioc_count: iocs.length,
                compact: false,
                action: `Downgrade to ${advisory.safe_versions[0] || "remove package"}. Rotate all credentials if this version was installed.`,
              });
            }
            return jsonResult({
              status: "COMPROMISED",
              package: `${name}@${version}`,
              advisory: compactAdvisory(advisory),
              iocs: iocs.slice(0, 5).map((i) => ({
                type: i.type,
                value: truncateText(i.value, 96),
                context: truncateText(i.context, 96),
              })),
              ioc_count: iocs.length,
              shown_iocs: Math.min(iocs.length, 5),
              compact: true,
              hint: "Call check_package with verbose=true or get_advisory with the advisory id for full IOC details.",
              action: `Downgrade to ${advisory.safe_versions[0] || "remove package"}. Rotate all credentials if this version was installed.`,
            });
          }
          return jsonResult({ status: "SAFE", package: `${name}@${version}`, message: "No known advisories for this version." });
        }

        const advisories = searchAdvisories(name).filter((a) => a.ecosystem === eco);
        if (advisories.length > 0) {
          if (verbose) {
            return jsonResult({
              status: "HAS_ADVISORIES",
              package: name,
              advisories: advisories.map((a) => ({
                id: a.id,
                title: a.title,
                affected_versions: a.affected_versions,
                safe_versions: a.safe_versions,
                severity: a.severity,
              })),
              count: advisories.length,
              compact: false,
            });
          }
          const compact = compactListResult(advisories, {
            limit: DEFAULT_ADVISORY_LIMIT,
            map: compactAdvisory,
            detailHint: "Call get_advisory with an id for full details.",
            verboseHint: "Call check_package with verbose=true or get_advisory with an id for details.",
          });
          return jsonResult({
            status: "HAS_ADVISORIES",
            package: name,
            advisories: compact.items,
            count: compact.count,
            shown: compact.shown,
            hint: compact.hint,
            compact: true,
          });
        }
        return jsonResult({ status: "SAFE", package: name, message: "No known advisories." });
      } catch (error) {
        return jsonResult({ error: String(error) });
      }
    },
  );

  // 22. list_advisories
  server.tool(
    "list_advisories",
    "Browse known supply chain attack advisories",
    {
      ecosystem: z.string().optional().describe("Filter by ecosystem: npm, pypi, github-actions"),
      severity: z.string().optional().describe("Filter by severity"),
      limit: z.number().optional().describe("Max compact results (default 10, max 200)"),
      offset: z.number().optional().describe("Start offset for compact pagination"),
      verbose: z.boolean().optional().describe("Return full advisory records"),
    },
    async ({ ecosystem, severity, limit, offset, verbose }) => {
      try {
        const displayLimit = parseLimitOption(limit, "limit", DEFAULT_ADVISORY_LIMIT);
        const displayOffset = parseLimitOption(offset, "offset", 0, Number.MAX_SAFE_INTEGER);
        const advisories = listAdvisories({
          ecosystem,
          severity,
          limit: displayLimit + (verbose ? 0 : 1),
          offset: displayOffset,
        });
        if (verbose) {
          return jsonResult({
            advisories: advisories.map((a) => ({
              id: a.id,
              package_name: a.package_name,
              ecosystem: a.ecosystem,
              affected_versions: a.affected_versions,
              safe_versions: a.safe_versions,
              attack_type: a.attack_type,
              severity: a.severity,
              title: a.title,
              threat_actor: a.threat_actor,
              detected_at: a.detected_at,
            })),
            count: advisories.length,
            shown: advisories.length,
            offset: displayOffset,
            compact: false,
          });
        }
        const compact = compactListResult(advisories, {
          limit: displayLimit,
          offset: displayOffset,
          map: compactAdvisory,
          detailHint: "Call get_advisory with an id for full details.",
          verboseHint: "Call list_advisories with verbose=true or adjust limit/offset for more.",
        });
        return jsonResult({
          advisories: compact.items,
          count: compact.count,
          shown: compact.shown,
          offset: compact.offset,
          limit: compact.limit,
          next_offset: compact.next_offset,
          hint: compact.hint,
          compact: true,
        });
      } catch (error) {
        return jsonResult({ error: String(error) });
      }
    },
  );

  // 23. get_advisory
  server.tool(
    "get_advisory",
    "Get full details of a supply chain advisory including IOCs",
    { id: z.string().describe("Advisory ID") },
    async ({ id }) => {
      try {
        const advisory = getAdvisory(id);
        if (!advisory) return jsonResult({ error: "Advisory not found" });
        const iocs = getIOCsForAdvisory(id);
        return jsonResult({ ...advisory, iocs });
      } catch (error) {
        return jsonResult({ error: String(error) });
      }
    },
  );
}
