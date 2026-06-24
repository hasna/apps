import { z } from "zod";
import { resolve } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createProject,
  getProjectByPath,
  createScan,
  getScan,
  completeScan,
  updateScanStatus,
  createFinding,
  updateFinding,
  getSecurityScore,
} from "../../db/index.js";
import { runAllScanners, runScanner } from "../../scanners/index.js";
import { analyzeFinding as llmAnalyze, isLLMAvailable } from "../../llm/index.js";
import { ScannerType, ScanStatus, Severity } from "../../types/index.js";
import type { FindingInput } from "../../types/index.js";
import {
  scanSecretExposure,
  filterSecretExposureBySeverity,
  summarizeSecretExposure,
} from "../../lib/secret-exposure.js";
import { compactFinding, compactListResult, DEFAULT_COMPACT_LIMIT, parseLimitOption } from "../../lib/output.js";

type JsonResult = { content: Array<{ type: "text"; text: string }> };

export function registerScanTools(
  server: McpServer,
  jsonResult: (data: unknown) => JsonResult,
  getCodeContext: (filePath: string, line: number, contextLines?: number) => string,
): void {
  // 1. scan_repo
  server.tool(
    "scan_repo",
    "Run a full security scan on a repository path",
    {
      path: z.string().describe("Path to the repository to scan"),
      scanners: z.array(z.string()).optional().describe("Scanner types to run (defaults to all)"),
      llm_analyze: z.boolean().optional().describe("Whether to run LLM analysis on findings"),
    },
    async ({ path, scanners, llm_analyze }) => {
      try {
        const scanPath = resolve(path);

        let project = getProjectByPath(scanPath);
        if (!project) {
          const name = scanPath.split("/").pop() || "unknown";
          project = createProject(name, scanPath);
        }

        const scannerTypes: ScannerType[] = scanners
          ? scanners.filter((s) => Object.values(ScannerType).includes(s as ScannerType)) as ScannerType[]
          : Object.values(ScannerType);

        const scan = createScan(project.id, scannerTypes);
        updateScanStatus(scan.id, ScanStatus.Running);

        let findingInputs: FindingInput[];
        if (scanners && scanners.length > 0) {
          const results = await Promise.allSettled(
            scannerTypes.map((t) => runScanner(t, scanPath)),
          );
          findingInputs = results
            .filter((r) => r.status === "fulfilled")
            .flatMap((r) => (r as PromiseFulfilledResult<FindingInput[]>).value);
        } else {
          findingInputs = await runAllScanners(scanPath);
        }

        const findings = findingInputs.map((input) => createFinding(scan.id, input));
        completeScan(scan.id, findings.length);

        if (llm_analyze && isLLMAvailable()) {
          const analyzeInBackground = async () => {
            const BATCH_SIZE = 5;
            for (let i = 0; i < findings.length; i += BATCH_SIZE) {
              const batch = findings.slice(i, i + BATCH_SIZE);
              await Promise.allSettled(
                batch.map(async (finding) => {
                  const context = getCodeContext(finding.file, finding.line);
                  if (context) {
                    const analysis = await llmAnalyze(finding, context);
                    if (analysis) {
                      updateFinding(finding.id, { llm_exploitability: analysis.exploitability });
                    }
                  }
                }),
              );
            }
          };
          analyzeInBackground().catch(() => {});
        }

        const completedScan = getScan(scan.id);
        const score = getSecurityScore(scan.id);

        return jsonResult({
          scan: completedScan,
          score,
          findings_count: findings.length,
          llm_analysis: llm_analyze ? "running in background (5 concurrent)" : "not requested",
          by_severity: { critical: score.critical, high: score.high, medium: score.medium, low: score.low, info: score.info },
        });
      } catch (error) {
        return jsonResult({ error: String(error) });
      }
    },
  );

  // 2. scan_file
  server.tool(
    "scan_file",
    "Scan a single file for security issues",
    {
      path: z.string().describe("Path to the file to scan"),
      content: z.string().optional().describe("File content (if not reading from disk)"),
      limit: z.number().optional().describe(`Max findings to return (default ${DEFAULT_COMPACT_LIMIT})`),
      offset: z.number().optional().describe("Skip N findings"),
      verbose: z.boolean().optional().describe("Return full finding records instead of compact rows"),
    },
    async ({ path: filePath, limit, offset, verbose }) => {
      try {
        const resultLimit = parseLimitOption(limit, "limit", DEFAULT_COMPACT_LIMIT);
        const resultOffset = parseLimitOption(offset, "offset", 0, Number.MAX_SAFE_INTEGER);
        const absPath = resolve(filePath);
        const dirPath = absPath.substring(0, absPath.lastIndexOf("/"));
        const findings = await runAllScanners(dirPath);
        const fileFindings = findings.filter(
          (f) => f.file === absPath || f.file === filePath || f.file.endsWith(filePath),
        );
        const page = fileFindings.slice(resultOffset);
        if (verbose) {
          const verboseFindings = limit === undefined ? page : page.slice(0, resultLimit);
          return jsonResult({
            file: absPath,
            findings: verboseFindings,
            count: fileFindings.length,
            shown: verboseFindings.length,
            offset: resultOffset,
            limit: limit === undefined ? null : resultLimit,
            next_offset: limit !== undefined && page.length > verboseFindings.length ? resultOffset + verboseFindings.length : null,
            compact: false,
          });
        }
        const compact = compactListResult(page, {
          limit: resultLimit,
          offset: resultOffset,
          map: compactFinding,
          detailHint: "Use verbose=true for full finding records.",
        });
        return jsonResult({
          file: absPath,
          findings: compact.items,
          count: fileFindings.length,
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

  // 3. scan_secret_exposure
  server.tool(
    "scan_secret_exposure",
    "Scan repo files, git history, running processes, and tmux panes for exposed secrets",
    {
      path: z.string().describe("Path to the repository or directory to scan"),
      include_git_history: z.boolean().optional().describe("Whether to include git history scanning"),
      include_processes: z.boolean().optional().describe("Whether to include running process environment scanning"),
      include_tmux: z.boolean().optional().describe("Whether to include tmux metadata/history scanning"),
      severity: z.string().optional().describe("Minimum severity threshold (critical/high/medium/low/info)"),
      limit: z.number().optional().describe(`Max findings to return (default ${DEFAULT_COMPACT_LIMIT})`),
      offset: z.number().optional().describe("Skip N findings"),
      verbose: z.boolean().optional().describe("Return full finding records instead of compact rows"),
    },
    async ({ path, include_git_history, include_processes, include_tmux, severity, limit, offset, verbose }) => {
      try {
        const resultLimit = parseLimitOption(limit, "limit", DEFAULT_COMPACT_LIMIT);
        const resultOffset = parseLimitOption(offset, "offset", 0, Number.MAX_SAFE_INTEGER);
        const parsedSeverity = severity
          ? (() => {
            const normalized = severity.toLowerCase();
            const allowed = Object.values(Severity);
            if (!allowed.includes(normalized as Severity)) {
              throw new Error(`Invalid severity '${severity}'. Allowed values: ${allowed.join(", ")}`);
            }
            return normalized as Severity;
          })()
          : Severity.Info;

        const result = await scanSecretExposure({
          path: resolve(path),
          include_git_history: include_git_history ?? true,
          include_processes: include_processes ?? true,
          include_tmux: include_tmux ?? true,
        });

        const findings = filterSecretExposureBySeverity(result.findings, parsedSeverity);
        const page = findings.slice(resultOffset);
        const verboseFindings = limit === undefined ? page : page.slice(0, resultLimit);
        const compact = compactListResult(page, {
          limit: resultLimit,
          offset: resultOffset,
          map: compactFinding,
          detailHint: "Use verbose=true for full secret finding records.",
        });
        return jsonResult({
          path: result.path,
          severity_threshold: parsedSeverity,
          summary: summarizeSecretExposure(findings),
          findings: verbose ? verboseFindings : compact.items,
          count: findings.length,
          shown: verbose ? verboseFindings.length : compact.shown,
          offset: resultOffset,
          limit: verbose ? (limit === undefined ? null : resultLimit) : compact.limit,
          next_offset: verbose
            ? (limit !== undefined && page.length > verboseFindings.length ? resultOffset + verboseFindings.length : null)
            : compact.next_offset,
          hint: verbose ? undefined : compact.hint,
          compact: !verbose,
        });
      } catch (error) {
        return jsonResult({ error: String(error) });
      }
    },
  );
}
