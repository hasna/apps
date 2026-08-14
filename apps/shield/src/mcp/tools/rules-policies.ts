import { z } from "zod";
import { resolve } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  createProject,
  getProjectByPath,
  listProjects,
  getScan,
  listScans,
  getSecurityScore,
  createRule,
  listRules,
  toggleRule,
  createPolicy,
  getPolicy,
  listPolicies,
  updatePolicy,
  getActivePolicy,
} from "../../db/index.js";
import { isLLMAvailable } from "../../llm/index.js";
import { ScannerType, Severity } from "../../types/index.js";

type JsonResult = { content: Array<{ type: "text"; text: string }> };

export function registerRulesPoliciesTools(
  server: McpServer,
  jsonResult: (data: unknown) => JsonResult,
): void {
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
        const rules = listRules(scanner_type as ScannerType | undefined, enabled);
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
    { scan_id: z.string().optional().describe("Scan ID (uses most recent if not specified)") },
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
    { diff: z.string().describe("Git diff content to review") },
    async ({ diff }) => {
      try {
        if (!isLLMAvailable()) return jsonResult({ error: "LLM not available. Set CEREBRAS_API_KEY." });

        const { chat } = await import("../../llm/client.js");
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
          if (jsonMatch) return jsonResult(JSON.parse(jsonMatch[0]));
        } catch {}

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
    { id: z.string().describe("Scan ID") },
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
    { id: z.string().optional().describe("Policy ID (returns active policy if not specified)") },
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
}
