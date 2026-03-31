#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { resolve } from "path";
import { registerCloudTools } from "@hasna/cloud";

import { getDb } from "../db/database.js";
import {
  createProject,
  getProjectByPath,
  listProjects,
  createScan,
  getScan,
  listScans,
  updateScanStatus,
  completeScan,
  createFinding,
  getFinding,
  listFindings,
  updateFinding,
  suppressFinding,
  getSecurityScore,
  createRule,
  listRules,
  toggleRule,
  createPolicy,
  getPolicy,
  listPolicies,
  updatePolicy,
  getActivePolicy,
  createBaseline,
  seedBuiltinRules,
} from "../db/index.js";
import {
  runAllScanners,
  runScanner,
  listScanners,
} from "../scanners/index.js";
import {
  explainFinding as llmExplain,
  suggestFix as llmSuggestFix,
  triageFinding as llmTriage,
  analyzeFinding as llmAnalyze,
  isLLMAvailable,
} from "../llm/index.js";
import {
  listAdvisories,
  getAdvisory,
  searchAdvisories,
  isVersionAffected,
  getIOCsForAdvisory,
} from "../db/index.js";
import { seedAdvisories } from "../data/advisories.js";
import { ScannerType, ScanStatus, Severity } from "../types/index.js";
import type { FindingInput } from "../types/index.js";

// Seed builtin rules and advisory data on startup
seedBuiltinRules();
try { seedAdvisories(); } catch {}

function jsonResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function getCodeContext(filePath: string, line: number, contextLines = 10): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, line - contextLines - 1);
    const end = Math.min(lines.length, line + contextLines);
    return lines
      .slice(start, end)
      .map((l, i) => `${start + i + 1}: ${l}`)
      .join("\n");
  } catch {
    return "";
  }
}

const server = new McpServer({
  name: "security",
  version: "0.1.0",
});

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

      // Find or create project
      let project = getProjectByPath(scanPath);
      if (!project) {
        const name = scanPath.split("/").pop() || "unknown";
        project = createProject(name, scanPath);
      }

      // Determine scanner types
      const scannerTypes: ScannerType[] = scanners
        ? scanners.filter((s) => Object.values(ScannerType).includes(s as ScannerType)) as ScannerType[]
        : Object.values(ScannerType);

      // Create scan record
      const scan = createScan(project.id, scannerTypes);
      updateScanStatus(scan.id, ScanStatus.Running);

      // Run scanners
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

      // Store findings
      const findings = findingInputs.map((input) => createFinding(scan.id, input));

      // Complete scan immediately
      completeScan(scan.id, findings.length);

      // LLM analysis runs in background — don't block the response
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
                    updateFinding(finding.id, {
                      llm_exploitability: analysis.exploitability,
                    });
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
        by_severity: {
          critical: score.critical,
          high: score.high,
          medium: score.medium,
          low: score.low,
          info: score.info,
        },
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
  },
  async ({ path: filePath, content }) => {
    try {
      const absPath = resolve(filePath);
      const dirPath = absPath.substring(0, absPath.lastIndexOf("/"));

      // Run code and secrets scanners on the directory, filter to this file
      const findings = await runAllScanners(dirPath);
      const fileFindings = findings.filter(
        (f) => f.file === absPath || f.file === filePath || f.file.endsWith(filePath),
      );

      return jsonResult({
        file: absPath,
        findings: fileFindings,
        count: fileFindings.length,
      });
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 3. list_findings
server.tool(
  "list_findings",
  "Query findings with optional filters",
  {
    scan_id: z.string().optional().describe("Filter by scan ID"),
    severity: z.string().optional().describe("Filter by severity (critical, high, medium, low, info)"),
    scanner_type: z.string().optional().describe("Filter by scanner type"),
    file: z.string().optional().describe("Filter by file path"),
    limit: z.number().optional().describe("Max results (default 100)"),
  },
  async ({ scan_id, severity, scanner_type, file, limit }) => {
    try {
      const findings = listFindings({
        scan_id,
        severity: severity as Severity | undefined,
        scanner_type: scanner_type as ScannerType | undefined,
        file,
        limit: limit ?? 100,
      });
      return jsonResult({ findings, count: findings.length });
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 4. get_finding
server.tool(
  "get_finding",
  "Get detailed information about a specific finding",
  {
    id: z.string().describe("Finding ID"),
  },
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
  {
    id: z.string().describe("Finding ID"),
  },
  async ({ id }) => {
    try {
      const finding = getFinding(id);
      if (!finding) return jsonResult({ error: "Finding not found" });

      if (finding.llm_explanation) {
        return jsonResult({ finding_id: id, explanation: finding.llm_explanation });
      }

      if (!isLLMAvailable()) {
        return jsonResult({ error: "LLM not available. Set CEREBRAS_API_KEY." });
      }

      const context = getCodeContext(finding.file, finding.line);
      const explanation = await llmExplain(finding, context);

      if (explanation) {
        updateFinding(id, { llm_explanation: explanation });
      }

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
  {
    id: z.string().describe("Finding ID"),
  },
  async ({ id }) => {
    try {
      const finding = getFinding(id);
      if (!finding) return jsonResult({ error: "Finding not found" });

      if (finding.llm_fix) {
        return jsonResult({ finding_id: id, fix: finding.llm_fix });
      }

      if (!isLLMAvailable()) {
        return jsonResult({ error: "LLM not available. Set CEREBRAS_API_KEY." });
      }

      const context = getCodeContext(finding.file, finding.line);
      const fix = await llmSuggestFix(finding, context);

      if (fix) {
        updateFinding(id, { llm_fix: fix });
      }

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

// 8. list_rules
server.tool(
  "list_rules",
  "Browse security rules with optional filters",
  {
    scanner_type: z.string().optional().describe("Filter by scanner type"),
    enabled: z.boolean().optional().describe("Filter by enabled status"),
  },
  async ({ scanner_type, enabled }) => {
    try {
      const rules = listRules(
        scanner_type as ScannerType | undefined,
        enabled,
      );
      return jsonResult({ rules, count: rules.length });
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 9. create_rule
server.tool(
  "create_rule",
  "Create a custom security rule",
  {
    name: z.string().describe("Rule name"),
    scanner_type: z.string().describe("Scanner type (secrets, dependencies, code, git-history, config, ai-safety)"),
    severity: z.string().describe("Severity level (critical, high, medium, low, info)"),
    pattern: z.string().describe("Regex pattern for the rule"),
    description: z.string().optional().describe("Rule description"),
  },
  async ({ name, scanner_type, severity, pattern, description }) => {
    try {
      const rule = createRule({
        name,
        scanner_type: scanner_type as ScannerType,
        severity: severity as Severity,
        pattern,
        description: description || "",
        enabled: true,
        builtin: false,
        metadata: {},
      });
      return jsonResult(rule);
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 10. toggle_rule
server.tool(
  "toggle_rule",
  "Enable or disable a security rule",
  {
    id: z.string().describe("Rule ID"),
    enabled: z.boolean().describe("Whether the rule should be enabled"),
  },
  async ({ id, enabled }) => {
    try {
      toggleRule(id, enabled);
      return jsonResult({ rule_id: id, enabled });
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 11. get_security_score
server.tool(
  "get_security_score",
  "Get the security score for a scan",
  {
    scan_id: z.string().optional().describe("Scan ID (uses most recent if not specified)"),
  },
  async ({ scan_id }) => {
    try {
      let targetScanId = scan_id;
      if (!targetScanId) {
        const scans = listScans(undefined, 1);
        if (scans.length === 0) return jsonResult({ error: "No scans found" });
        targetScanId = scans[0].id;
      }
      const score = getSecurityScore(targetScanId);
      return jsonResult({ scan_id: targetScanId, ...score });
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 12. review_diff
server.tool(
  "review_diff",
  "Security review a git diff",
  {
    diff: z.string().describe("Git diff content to review"),
  },
  async ({ diff }) => {
    try {
      if (!isLLMAvailable()) {
        return jsonResult({ error: "LLM not available. Set CEREBRAS_API_KEY." });
      }

      const { chat } = await import("../llm/client.js");
      const prompt = `You are a security reviewer. Analyze this git diff for security issues.
Return a JSON object with:
- issues: array of {severity, description, file, line} objects
- summary: brief overall assessment
- safe: boolean indicating if the diff looks safe

Git diff:
\`\`\`
${diff}
\`\`\``;

      const response = await chat([
        { role: "system", content: "You are a security code reviewer. Always respond with valid JSON." },
        { role: "user", content: prompt },
      ]);

      if (!response) return jsonResult({ error: "LLM analysis failed" });

      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return jsonResult(JSON.parse(jsonMatch[0]));
        }
      } catch {
        // Fall through to raw response
      }

      return jsonResult({ review: response });
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 13. list_scans
server.tool(
  "list_scans",
  "List scan history",
  {
    project_id: z.string().optional().describe("Filter by project ID"),
    limit: z.number().optional().describe("Max results (default 50)"),
  },
  async ({ project_id, limit }) => {
    try {
      const scans = listScans(project_id, limit ?? 50);
      return jsonResult({ scans, count: scans.length });
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 14. get_scan
server.tool(
  "get_scan",
  "Get scan details",
  {
    id: z.string().describe("Scan ID"),
  },
  async ({ id }) => {
    try {
      const scan = getScan(id);
      if (!scan) return jsonResult({ error: "Scan not found" });
      return jsonResult(scan);
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 15. list_projects
server.tool(
  "list_projects",
  "List registered projects",
  {},
  async () => {
    try {
      const projects = listProjects();
      return jsonResult({ projects, count: projects.length });
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 16. register_project
server.tool(
  "register_project",
  "Register a new project for scanning",
  {
    name: z.string().describe("Project name"),
    path: z.string().describe("Absolute path to the project"),
  },
  async ({ name, path: projectPath }) => {
    try {
      const absPath = resolve(projectPath);
      const existing = getProjectByPath(absPath);
      if (existing) return jsonResult(existing);

      const project = createProject(name, absPath);
      return jsonResult(project);
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 17. get_policy
server.tool(
  "get_policy",
  "Get a policy by ID or the active policy",
  {
    id: z.string().optional().describe("Policy ID (returns active policy if not specified)"),
  },
  async ({ id }) => {
    try {
      const policy = id ? getPolicy(id) : getActivePolicy();
      if (!policy) return jsonResult({ error: "No policy found" });
      return jsonResult(policy);
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 18. set_policy
server.tool(
  "set_policy",
  "Create or update a security policy",
  {
    name: z.string().describe("Policy name"),
    block_on_severity: z.string().optional().describe("Block on this severity or higher"),
    auto_fix: z.boolean().optional().describe("Automatically apply LLM-suggested fixes"),
    notify: z.boolean().optional().describe("Send notifications on findings"),
  },
  async ({ name, block_on_severity, auto_fix, notify }) => {
    try {
      const policy = createPolicy({
        name,
        description: "",
        block_on_severity: (block_on_severity as Severity) ?? null,
        auto_fix: auto_fix ?? false,
        notify: notify ?? false,
        enabled: true,
      });
      return jsonResult(policy);
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
          createBaseline(
            finding.fingerprint,
            reason || "Baselined from scan " + scan_id,
          );
          suppressFinding(finding.id, reason || "Baselined");
          baselined++;
        }
      }

      return jsonResult({
        scan_id,
        total_findings: findings.length,
        baselined,
      });
    } catch (error) {
      return jsonResult({ error: String(error) });
    }
  },
);

// 20. triage_finding
server.tool(
  "triage_finding",
  "Auto-triage a finding via LLM analysis",
  {
    id: z.string().describe("Finding ID"),
  },
  async ({ id }) => {
    try {
      const finding = getFinding(id);
      if (!finding) return jsonResult({ error: "Finding not found" });

      if (!isLLMAvailable()) {
        return jsonResult({ error: "LLM not available. Set CEREBRAS_API_KEY." });
      }

      const context = getCodeContext(finding.file, finding.line);
      const triage = await llmTriage(finding, context);

      if (!triage) return jsonResult({ error: "Triage analysis failed" });

      // Update finding with LLM explanation of triage
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

// 21. check_package
server.tool(
  "check_package",
  "Check if a specific package version is safe or compromised",
  {
    name: z.string().describe("Package name (e.g. axios, litellm)"),
    version: z.string().optional().describe("Specific version to check"),
    ecosystem: z.string().optional().describe("Ecosystem: npm, pypi, github-actions (default: npm)"),
  },
  async ({ name, version, ecosystem }) => {
    try {
      const eco = ecosystem || "npm";
      if (version) {
        const advisory = isVersionAffected(name, eco, version);
        if (advisory) {
          const iocs = getIOCsForAdvisory(advisory.id);
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
            action: `Downgrade to ${advisory.safe_versions[0] || "remove package"}. Rotate all credentials if this version was installed.`,
          });
        }
        return jsonResult({ status: "SAFE", package: `${name}@${version}`, message: "No known advisories for this version." });
      }

      // No version specified — check for any advisory
      const advisories = searchAdvisories(name).filter((a) => a.ecosystem === eco);
      if (advisories.length > 0) {
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
    limit: z.number().optional().describe("Max results (default 50)"),
  },
  async ({ ecosystem, severity, limit }) => {
    try {
      const advisories = listAdvisories({ ecosystem, severity, limit: limit ?? 50 });
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
  {
    id: z.string().describe("Advisory ID"),
  },
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

// ─── Agent Tools ────────────────────────────────────────────────────────

const _agentReg = new Map<string, { id: string; name: string; last_seen_at: string; project_id?: string }>();

server.tool(
  "register_agent",
  "Register an agent session (idempotent). Auto-updates last_seen_at on re-register.",
  { name: z.string(), session_id: z.string().optional() },
  async (a: { name: string; session_id?: string }) => {
    const existing = [..._agentReg.values()].find(x => x.name === a.name);
    if (existing) { existing.last_seen_at = new Date().toISOString(); return { content: [{ type: "text" as const, text: JSON.stringify(existing) }] }; }
    const id = Math.random().toString(36).slice(2, 10);
    const ag = { id, name: a.name, last_seen_at: new Date().toISOString() };
    _agentReg.set(id, ag);
    return { content: [{ type: "text" as const, text: JSON.stringify(ag) }] };
  }
);

server.tool(
  "heartbeat",
  "Update last_seen_at to signal agent is active.",
  { agent_id: z.string() },
  async (a: { agent_id: string }) => {
    const ag = _agentReg.get(a.agent_id);
    if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
    ag.last_seen_at = new Date().toISOString();
    return { content: [{ type: "text" as const, text: JSON.stringify({ id: ag.id, name: ag.name, last_seen_at: ag.last_seen_at }) }] };
  }
);

server.tool(
  "set_focus",
  "Set active project context for this agent session.",
  { agent_id: z.string(), project_id: z.string().nullable().optional() },
  async (a: { agent_id: string; project_id?: string | null }) => {
    const ag = _agentReg.get(a.agent_id);
    if (!ag) return { content: [{ type: "text" as const, text: `Agent not found: ${a.agent_id}` }], isError: true };
    (ag as any).project_id = a.project_id ?? undefined;
    return { content: [{ type: "text" as const, text: a.project_id ? `Focus: ${a.project_id}` : "Focus cleared" }] };
  }
);

server.tool(
  "list_agents",
  "List all registered agents.",
  {},
  async () => {
    const agents = [..._agentReg.values()];
    if (agents.length === 0) return { content: [{ type: "text" as const, text: "No agents registered." }] };
    return { content: [{ type: "text" as const, text: JSON.stringify(agents, null, 2) }] };
  }
);

// ─── Feedback (send_feedback) ────────────────────────────────────────────

server.tool(
  "send_feedback",
  "Send feedback about this service",
  { message: z.string(), email: z.string().optional(), category: z.enum(["bug", "feature", "general"]).optional() },
  async (params: { message: string; email?: string; category?: string }) => {
    try {
      const db = getDb();
      db.prepare("INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)").run(params.message, params.email || null, params.category || "general", "0.1.0");
      return { content: [{ type: "text" as const, text: "Feedback saved. Thank you!" }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: String(e) }], isError: true };
    }
  }
);

// ─── Cloud Tools ────────────────────────────────────────────────────────

registerCloudTools(server, "security");

// Start the MCP server
const transport = new StdioServerTransport();
await server.connect(transport);
