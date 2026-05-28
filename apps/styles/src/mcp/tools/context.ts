import { z } from "zod";
import { resolve, join } from "path";
import { existsSync } from "fs";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatAgo } from "../../lib/format.js";
import { getActiveProfile, getBuiltinStyleProfile } from "../../lib/profiles.js";
import { listPrefs, setPref } from "../../lib/preferences.js";
import { getDb } from "../../lib/db.js";
import { applyTemplate } from "../../lib/templates.js";
import { detectProjectPath } from "../../lib/detect.js";

function mcpError(code: string, message: string, suggestions?: string[]): string {
  return JSON.stringify({ code, message, suggestions }, null, 2);
}

function buildDesignContextPrompt(
  profile: import("../../lib/profiles.js").StyleProfile,
  prefs: Record<string, string>,
  healthCheck: { score: number; status: string } | null
): string {
  const lines: string[] = [
    `## Active Design Style: ${profile.displayName}`,
    ``,
    `You are working in a project using the **${profile.displayName}** design style.`,
    ``,
  ];

  if (profile.principles.length > 0) {
    lines.push("### Principles", "");
    for (const p of profile.principles) lines.push(`- ${p}`);
    lines.push("");
  }

  const antiPatterns = "antiPatterns" in profile ? (profile.antiPatterns as string[]) : [];
  if (antiPatterns.length > 0) {
    lines.push("### Anti-Patterns (avoid these)", "");
    for (const ap of antiPatterns) lines.push(`- ${ap}`);
    lines.push("");
  }

  if (Object.keys(prefs).length > 0) {
    lines.push("### Project Preferences", "");
    for (const [k, v] of Object.entries(prefs)) {
      const label = k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      lines.push(`- ${label}: ${v}`);
    }
    lines.push("");
  }

  if (healthCheck) {
    lines.push(`### Current Health Score: ${healthCheck.score}/100 (${healthCheck.status})`);
    lines.push("");
  }

  lines.push("Apply these principles to every UI component, layout, and styling decision.");
  return lines.join("\n");
}

export function registerContextTools(server: McpServer) {
  server.tool(
    "get_preferences",
    "Get all preferences for a project or globally",
    {
      project_path: z.string().optional().describe("Absolute project path for project-scoped prefs"),
    },
    async ({ project_path }) => {
      const projectPath = project_path ? resolve(project_path) : undefined;
      return { content: [{ type: "text", text: JSON.stringify(listPrefs(projectPath), null, 2) }] };
    }
  );

  server.tool(
    "set_preference",
    "Set a preference value",
    {
      key: z.string().describe("Preference key"),
      value: z.string().describe("Preference value"),
      scope: z.enum(["global", "project"]).describe("Preference scope"),
      project_path: z.string().optional().describe("Project path (required when scope is 'project')"),
    },
    async ({ key, value, scope, project_path }) => {
      const projectPath = project_path ? resolve(project_path) : undefined;
      if (scope === "project" && !projectPath) {
        return {
          content: [{ type: "text", text: mcpError("MISSING_PROJECT_PATH", "project_path is required when scope is 'project'") }],
          isError: true,
        };
      }
      try {
        setPref(key, value, scope, projectPath);
        return { content: [{ type: "text", text: JSON.stringify({ ok: true, key, value, scope }) }] };
      } catch (e) {
        return { content: [{ type: "text", text: mcpError("SET_PREF_FAILED", (e as Error).message) }], isError: true };
      }
    }
  );

  server.tool(
    "apply_template",
    "Apply a style template to a project",
    {
      template_id: z.string().describe("Template ID to apply"),
      project_path: z.string().describe("Absolute project path"),
    },
    async ({ template_id, project_path }) => {
      const projectPath = resolve(project_path);
      const result = applyTemplate(template_id, projectPath);
      if (!result.success) {
        return {
          content: [{ type: "text", text: mcpError("TEMPLATE_APPLY_FAILED", result.errors.join("; "), result.filesCreated.length > 0 ? [`Partial files created: ${result.filesCreated.join(", ")}`] : undefined) }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "get_context",
    "Get the full style context for a project — active style, principles, anti-patterns, preferences, and latest health score",
    {
      project_path: z.string().optional().describe("Absolute project path (default: auto-detect from cwd)"),
    },
    async ({ project_path }) => {
      const projectPath = resolve(project_path ?? detectProjectPath());

      let profile = getActiveProfile(projectPath);
      if (!profile) profile = getBuiltinStyleProfile("minimalist");

      const prefsArr = listPrefs(projectPath);
      const prefsMap: Record<string, string> = {};
      for (const p of prefsArr) prefsMap[p.key] = p.value;

      const db = getDb();
      const lastCheck = db.prepare(
        "SELECT score, status, run_at FROM health_checks WHERE project_path = ? ORDER BY run_at DESC LIMIT 1"
      ).get(projectPath) as { score: number; status: string; run_at: number } | null;

      const result = {
        projectPath,
        activeStyle: { name: profile.name, displayName: profile.displayName, category: profile.category },
        principles: profile.principles,
        antiPatterns: "antiPatterns" in profile ? profile.antiPatterns : [],
        preferences: prefsMap,
        score: lastCheck?.score ?? null,
        status: lastCheck?.status ?? null,
        lastCheckAgo: formatAgo(lastCheck?.run_at),
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // Prompt: design_context
  server.prompt(
    "design_context",
    {
      project_path: z.string().optional().describe("Project path (auto-detected if omitted)"),
    },
    async ({ project_path }) => {
      let resolvedPath: string;
      if (project_path) {
        resolvedPath = resolve(project_path);
      } else {
        let dir = process.cwd();
        resolvedPath = dir;
        for (let i = 0; i < 10; i++) {
          if (existsSync(join(dir, ".styles")) || existsSync(join(dir, ".claude"))) {
            resolvedPath = dir;
            break;
          }
          const parent = join(dir, "..");
          if (parent === dir) break;
          dir = parent;
        }
      }

      let profile = getActiveProfile(resolvedPath);
      if (!profile) profile = getBuiltinStyleProfile("minimalist");

      const prefsArr = listPrefs(resolvedPath);
      const prefsMap: Record<string, string> = {};
      for (const p of prefsArr) prefsMap[p.key] = p.value;

      const db = getDb();
      const lastCheck = db.prepare(
        "SELECT score, status FROM health_checks WHERE project_path = ? ORDER BY run_at DESC LIMIT 1"
      ).get(resolvedPath) as { score: number; status: string } | null;

      const promptText = buildDesignContextPrompt(profile, prefsMap, lastCheck);

      return {
        messages: [{ role: "user", content: { type: "text", text: promptText } }],
      };
    }
  );
}
