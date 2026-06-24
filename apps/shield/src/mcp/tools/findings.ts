import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getFinding,
  listFindings,
  updateFinding,
  suppressFinding,
  createBaseline,
} from "../../db/index.js";
import {
  explainFinding as llmExplain,
  suggestFix as llmSuggestFix,
  triageFinding as llmTriage,
  isLLMAvailable,
} from "../../llm/index.js";
import { Severity, ScannerType } from "../../types/index.js";
import { compactFinding, compactListResult, DEFAULT_COMPACT_LIMIT, parseLimitOption } from "../../lib/output.js";

type JsonResult = { content: Array<{ type: "text"; text: string }> };

export function registerFindingTools(
  server: McpServer,
  jsonResult: (data: unknown) => JsonResult,
  getCodeContext: (filePath: string, line: number, contextLines?: number) => string,
): void {
  // 3. list_findings
  server.tool(
    "list_findings",
    "Query findings with optional filters",
    {
      scan_id: z.string().optional().describe("Filter by scan ID"),
      severity: z.string().optional().describe("Filter by severity (critical, high, medium, low, info)"),
      scanner_type: z.string().optional().describe("Filter by scanner type"),
      file: z.string().optional().describe("Filter by file path"),
      limit: z.number().optional().describe(`Max results (default ${DEFAULT_COMPACT_LIMIT})`),
      offset: z.number().optional().describe("Skip N results"),
      verbose: z.boolean().optional().describe("Return full finding records instead of compact rows"),
    },
    async ({ scan_id, severity, scanner_type, file, limit, offset, verbose }) => {
      try {
        const resultLimit = parseLimitOption(limit, "limit", DEFAULT_COMPACT_LIMIT);
        const resultOffset = parseLimitOption(offset, "offset", 0, Number.MAX_SAFE_INTEGER);
        const findings = listFindings({
          scan_id,
          severity: severity as Severity | undefined,
          scanner_type: scanner_type as ScannerType | undefined,
          file,
          limit: verbose ? resultLimit : resultLimit + 1,
          offset: resultOffset,
        });
        if (verbose) return jsonResult({ findings, count: findings.length, shown: findings.length, offset: resultOffset, compact: false });
        const compact = compactListResult(findings, {
          limit: resultLimit,
          offset: resultOffset,
          map: compactFinding,
          detailHint: "Use get_finding with an id for full details.",
          verboseHint: "Use verbose=true or get_finding with an id for snippets, fixes, and explanations.",
        });
        return jsonResult({
          findings: compact.items,
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

  // 4. get_finding
  server.tool(
    "get_finding",
    "Get detailed information about a specific finding",
    { id: z.string().describe("Finding ID") },
    async ({ id }) => {
      try {
        const finding = getFinding(id);
        if (!finding) return jsonResult({ error: "Finding not found" });
        return jsonResult(finding);
      } catch (error) {
        return jsonResult({ error: String(error) });
      }
    },
  );

  // 5. explain_finding
  server.tool(
    "explain_finding",
    "Get an LLM-generated explanation of a finding",
    { id: z.string().describe("Finding ID") },
    async ({ id }) => {
      try {
        const finding = getFinding(id);
        if (!finding) return jsonResult({ error: "Finding not found" });
        if (finding.llm_explanation) return jsonResult({ finding_id: id, explanation: finding.llm_explanation });
        if (!isLLMAvailable()) return jsonResult({ error: "LLM not available. Set CEREBRAS_API_KEY." });

        const context = getCodeContext(finding.file, finding.line);
        const explanation = await llmExplain(finding, context);
        if (explanation) updateFinding(id, { llm_explanation: explanation });
        return jsonResult({ finding_id: id, explanation: explanation || "Unable to generate explanation" });
      } catch (error) {
        return jsonResult({ error: String(error) });
      }
    },
  );

  // 6. suggest_fix
  server.tool(
    "suggest_fix",
    "Get an LLM-suggested fix for a finding",
    { id: z.string().describe("Finding ID") },
    async ({ id }) => {
      try {
        const finding = getFinding(id);
        if (!finding) return jsonResult({ error: "Finding not found" });
        if (finding.llm_fix) return jsonResult({ finding_id: id, fix: finding.llm_fix });
        if (!isLLMAvailable()) return jsonResult({ error: "LLM not available. Set CEREBRAS_API_KEY." });

        const context = getCodeContext(finding.file, finding.line);
        const fix = await llmSuggestFix(finding, context);
        if (fix) updateFinding(id, { llm_fix: fix });
        return jsonResult({ finding_id: id, fix: fix || "Unable to generate fix suggestion" });
      } catch (error) {
        return jsonResult({ error: String(error) });
      }
    },
  );

  // 7. suppress_finding
  server.tool(
    "suppress_finding",
    "Suppress a finding with a reason",
    {
      id: z.string().describe("Finding ID"),
      reason: z.string().describe("Reason for suppression"),
    },
    async ({ id, reason }) => {
      try {
        const finding = getFinding(id);
        if (!finding) return jsonResult({ error: "Finding not found" });
        suppressFinding(id, reason);
        return jsonResult({ finding_id: id, suppressed: true, reason });
      } catch (error) {
        return jsonResult({ error: String(error) });
      }
    },
  );

  // 19. baseline_findings
  server.tool(
    "baseline_findings",
    "Baseline all findings from a scan (mark as known/accepted)",
    {
      scan_id: z.string().describe("Scan ID to baseline"),
      reason: z.string().optional().describe("Reason for baselining"),
    },
    async ({ scan_id, reason }) => {
      try {
        const findings = listFindings({ scan_id });
        let baselined = 0;
        for (const finding of findings) {
          if (!finding.suppressed) {
            createBaseline(finding.fingerprint, reason || "Baselined from scan " + scan_id);
            suppressFinding(finding.id, reason || "Baselined");
            baselined++;
          }
        }
        return jsonResult({ scan_id, total_findings: findings.length, baselined });
      } catch (error) {
        return jsonResult({ error: String(error) });
      }
    },
  );

  // 20. triage_finding
  server.tool(
    "triage_finding",
    "Auto-triage a finding via LLM analysis",
    { id: z.string().describe("Finding ID") },
    async ({ id }) => {
      try {
        const finding = getFinding(id);
        if (!finding) return jsonResult({ error: "Finding not found" });
        if (!isLLMAvailable()) return jsonResult({ error: "LLM not available. Set CEREBRAS_API_KEY." });

        const context = getCodeContext(finding.file, finding.line);
        const triage = await llmTriage(finding, context);
        if (!triage) return jsonResult({ error: "Triage analysis failed" });

        updateFinding(id, {
          llm_explanation: `Triage: ${triage.reasoning}`,
          llm_exploitability: triage.severity === Severity.Critical ? 9 :
            triage.severity === Severity.High ? 7 :
            triage.severity === Severity.Medium ? 5 :
            triage.severity === Severity.Low ? 3 : 1,
        });

        return jsonResult({
          finding_id: id,
          original_severity: finding.severity,
          suggested_severity: triage.severity,
          reasoning: triage.reasoning,
        });
      } catch (error) {
        return jsonResult({ error: String(error) });
      }
    },
  );
}
