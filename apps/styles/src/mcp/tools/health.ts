import { z } from "zod";
import { resolve } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatAgo } from "../../lib/format.js";
import { runHealthCheck, checkFile, getDefaultRules } from "../../lib/health.js";
import { getHealthDiff } from "../../lib/healthdiff.js";
import { getActiveProfile } from "../../lib/profiles.js";
import { getFixSuggestions, applyFixes } from "../../lib/fixer.js";
import { getDb } from "../../lib/db.js";
import { detectProjectPath } from "../../lib/detect.js";

export function registerHealthTools(server: McpServer) {
  server.tool(
    "run_health_check",
    "Run a style health check on a project",
    {
      project_path: z.string().describe("Absolute project path to scan"),
      use_ai: z.boolean().optional().describe("Use Cerebras AI for deeper analysis (requires CEREBRAS_API_KEY)"),
    },
    async ({ project_path, use_ai }) => {
      const projectPath = resolve(project_path);
      const result = await runHealthCheck(projectPath);

      if (use_ai) {
        const { isCerebrasAvailable, inspectProject } = await import("../../lib/inspector.js");
        if (isCerebrasAvailable()) {
          const aiResults = await inspectProject(projectPath);
          for (const r of aiResults) {
            for (const v of r.violations) {
              result.violations.push({ filePath: r.filePath, rule: v.rule, message: v.message, severity: v.severity, line: v.line });
            }
          }
        }
      }

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "list_health_history",
    "List past health check results for a project",
    {
      project_path: z.string().describe("Absolute project path"),
      limit: z.number().int().positive().optional().describe("Maximum number of results to return (default: 10)"),
    },
    async ({ project_path, limit }) => {
      const projectPath = resolve(project_path);
      const db = getDb();
      const rows = db.prepare(
        `SELECT id, project_path, run_at, score, status, cerebras_used, json_array_length(violations) as violation_count
         FROM health_checks WHERE project_path = ? ORDER BY run_at DESC LIMIT ?`
      ).all(projectPath, limit ?? 10);
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    }
  );

  server.tool(
    "get_score",
    "Get the latest health check score for a project",
    {
      project_path: z.string().optional().describe("Absolute project path (default: auto-detect from cwd)"),
    },
    async ({ project_path }) => {
      const projectPath = resolve(project_path ?? detectProjectPath());
      const db = getDb();
      const lastCheck = db.prepare(
        `SELECT score, status, run_at, json_array_length(violations) as violation_count
         FROM health_checks WHERE project_path = ? ORDER BY run_at DESC LIMIT 1`
      ).get(projectPath) as { score: number; status: string; run_at: number; violation_count: number } | null;

      if (!lastCheck) {
        return { content: [{ type: "text", text: JSON.stringify({ score: null, status: "unknown", message: "No health check run yet. Run: styles health" }, null, 2) }] };
      }

      return { content: [{ type: "text", text: JSON.stringify({ score: lastCheck.score, status: lastCheck.status, violations: lastCheck.violation_count, lastRun: formatAgo(lastCheck.run_at), projectPath }, null, 2) }] };
    }
  );

  server.tool(
    "health_diff",
    "Show the health score diff between the last two health check runs for a project",
    {
      project_path: z.string().optional().describe("Absolute project path (default: auto-detect from cwd)"),
    },
    async ({ project_path }) => {
      const projectPath = resolve(project_path ?? detectProjectPath());
      return { content: [{ type: "text", text: JSON.stringify(getHealthDiff(projectPath), null, 2) }] };
    }
  );

  server.tool(
    "fix_file",
    "Show fix suggestions for style violations in a file, optionally auto-applying fixable ones",
    {
      file_path: z.string().describe("Absolute path to the file to fix"),
      project_path: z.string().optional().describe("Absolute project path for profile resolution"),
      apply: z.boolean().optional().describe("If true, auto-apply fixable suggestions (e.g. magic color comments)"),
    },
    async ({ file_path, project_path, apply }) => {
      const filePath = resolve(file_path);
      const projectPath = resolve(project_path ?? process.cwd());
      const profile = getActiveProfile(projectPath);
      const rules = getDefaultRules(profile);
      const violations = checkFile(filePath, rules);
      const fixes = getFixSuggestions(filePath, violations);

      let applied = 0;
      if (apply) {
        const autoFixable = fixes.filter((f) => f.autoFixable);
        applied = applyFixes(filePath, autoFixable);
      }

      return { content: [{ type: "text", text: JSON.stringify({ filePath, fixes, applied }, null, 2) }] };
    }
  );
}
