import { z } from "zod";
import { resolve, join } from "path";
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LruCache } from "../../lib/lru-cache.js";
import { buildStyleMdContent } from "../../lib/format.js";
import {
  STYLES,
  getStyle,
  searchStyles,
  getStylesByCategory,
  findSimilarStyles,
} from "../../lib/registry.js";
import {
  createProfile,
  listProfiles,
  getActiveProfile,
  getBuiltinStyleProfile,
  setActiveProfile,
} from "../../lib/profiles.js";
import { setPref } from "../../lib/preferences.js";
import { writeStyleContextFile } from "../../lib/fs.js";
import { injectStyleHook } from "../../lib/hookmanager.js";
import type { Pattern } from "../../lib/examples.js";
import { getExample, listExamples, PATTERNS } from "../../lib/examples.js";

function getStylesRootDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const thisDir = dirname(thisFile);
  return join(thisDir, "..", "..", "..", "styles");
}

function readStyleMd(name: string): string {
  const mdPath = join(getStylesRootDir(), name, "STYLE.md");
  if (existsSync(mdPath)) return readFileSync(mdPath, "utf-8");
  return "";
}

function mcpError(code: string, message: string, suggestions?: string[]): string {
  return JSON.stringify({ code, message, suggestions }, null, 2);
}

const searchCache = new LruCache<string, ReturnType<typeof searchStyles>>(100);

export function registerStyleTools(server: McpServer) {
  server.tool(
    "list_styles",
    "List all available styles, optionally filtered by category",
    {
      category: z.string().optional().describe("Filter by category (e.g. Minimalist, Brutalist, Corporate)"),
    },
    async ({ category }) => ({
      content: [{ type: "text", text: JSON.stringify(category ? getStylesByCategory(category) : STYLES, null, 2) }],
    })
  );

  server.tool(
    "get_style_info",
    "Get full info for a style including STYLE.md content from disk",
    {
      name: z.string().describe("Style name (e.g. minimalist, brutalist)"),
    },
    async ({ name }) => {
      const style = getStyle(name);
      if (!style) {
        const similar = findSimilarStyles(name);
        return {
          content: [{ type: "text", text: mcpError("STYLE_NOT_FOUND", `Style not found: "${name}"`, similar) }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ ...style, styleMd: readStyleMd(name) }, null, 2) }],
      };
    }
  );

  server.tool(
    "search_styles",
    "Fuzzy search styles by name, description, or tags",
    {
      query: z.string().describe("Search query"),
    },
    async ({ query }) => {
      const cacheKey = query.toLowerCase().trim();
      let results = searchCache.get(cacheKey);
      if (!results) {
        results = searchStyles(query);
        searchCache.set(cacheKey, results);
      }
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  server.tool(
    "use_style",
    "Set the active style for a project or globally",
    {
      name: z.string().describe("Style name to activate"),
      project_path: z.string().optional().describe("Absolute project path"),
      global: z.boolean().optional().describe("If true, set as global default"),
    },
    async ({ name, project_path, global: isGlobal }) => {
      const style = getStyle(name);
      if (!style) {
        const similar = findSimilarStyles(name);
        return {
          content: [{ type: "text", text: mcpError("STYLE_NOT_FOUND", `Style not found: "${name}"`, similar) }],
          isError: true,
        };
      }

      const profile = getBuiltinStyleProfile(name);

      if (isGlobal) {
        setPref("active_profile", profile.id, "global");
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, scope: "global", style: name, profileId: profile.id }) }],
        };
      }

      const projectPath = resolve(project_path ?? process.cwd());
      setActiveProfile(projectPath, profile.id);
      writeStyleContextFile(projectPath, buildStyleMdContent(name));

      let hookInjected = false;
      const claudeDir = join(projectPath, ".claude");
      if (existsSync(claudeDir)) {
        hookInjected = !injectStyleHook(projectPath).alreadyInstalled;
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, scope: "project", project: projectPath, style: name, profileId: profile.id, hookInjected }) }],
      };
    }
  );

  server.tool(
    "get_active_style",
    "Get the active style profile for a project",
    {
      project_path: z.string().describe("Absolute project path"),
    },
    async ({ project_path }) => {
      const projectPath = resolve(project_path);
      const profile = getActiveProfile(projectPath);
      if (!profile) {
        return {
          content: [{ type: "text", text: mcpError("NO_ACTIVE_PROFILE", `No active profile set for: ${projectPath}`, ["Run: styles use <name> --project " + projectPath]) }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
    }
  );

  server.tool(
    "list_profiles",
    "List all custom (user-created) style profiles",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(listProfiles(), null, 2) }],
    })
  );

  server.tool(
    "create_profile",
    "Create a custom style profile",
    {
      name: z.string().describe("Profile slug name (lowercase, no spaces)"),
      displayName: z.string().describe("Human-readable display name"),
      description: z.string().optional().describe("Profile description"),
      category: z.string().describe("Category (e.g. Minimalist, Corporate)"),
      principles: z.array(z.string()).describe("Design principles list"),
      antiPatterns: z.array(z.string()).describe("Anti-patterns to avoid"),
      tags: z.array(z.string()).describe("Tags for discovery"),
    },
    async ({ name, displayName, description, category, principles, antiPatterns, tags }) => {
      const profile = createProfile({
        name, displayName, description: description ?? "", category, principles, antiPatterns,
        typography: {}, colors: {}, componentRules: {}, tags,
      });
      return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
    }
  );

  server.tool(
    "get_example",
    "Get a copyable TSX code example for a UI pattern in a given style",
    {
      pattern: z.string().describe(`UI pattern to get an example for. Valid values: ${PATTERNS.join(", ")}`),
      style: z.string().optional().describe("Style name (e.g. minimalist, brutalist). Defaults to active project style."),
      project_path: z.string().optional().describe("Absolute project path for resolving the active style"),
    },
    async ({ pattern, style, project_path }) => {
      if (!PATTERNS.includes(pattern as Pattern)) {
        return {
          content: [{ type: "text", text: mcpError("INVALID_PATTERN", `Unknown pattern: "${pattern}"`, [`Valid patterns: ${PATTERNS.join(", ")}`]) }],
          isError: true,
        };
      }

      let styleName: string;
      if (style) {
        styleName = style;
      } else {
        const projectPath = resolve(project_path ?? process.cwd());
        const profile = getActiveProfile(projectPath);
        styleName = profile?.name ?? "minimalist";
      }

      const code = getExample(styleName, pattern as Pattern);
      if (!code) {
        const available = listExamples(styleName);
        return {
          content: [{ type: "text", text: mcpError("EXAMPLE_NOT_FOUND", `No example found for pattern "${pattern}" in style "${styleName}"`, available.length > 0 ? [`Available patterns for ${styleName}: ${available.join(", ")}`] : [`Style "${styleName}" has no examples yet`]) }],
          isError: true,
        };
      }

      return { content: [{ type: "text", text: JSON.stringify({ style: styleName, pattern, code }, null, 2) }] };
    }
  );

  // Resources
  server.resource(
    "styles-registry",
    "styles://registry",
    { description: "Full styles registry as JSON", mimeType: "application/json" },
    async () => ({
      contents: [{ uri: "styles://registry", mimeType: "application/json", text: JSON.stringify(STYLES, null, 2) }],
    })
  );

  import("@modelcontextprotocol/sdk/server/mcp.js").then(({ ResourceTemplate }) => {
    server.resource(
      "style-by-name",
      new ResourceTemplate("styles://{name}", { list: undefined }),
      { description: "Individual style metadata and STYLE.md content", mimeType: "application/json" },
      async (uri, variables) => {
        const rawName = variables["name"];
        const name = Array.isArray(rawName) ? rawName[0] : rawName;
        const style = getStyle(name);
        if (!style) {
          return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: mcpError("STYLE_NOT_FOUND", `Style not found: "${name}"`) }] };
        }
        return { contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify({ ...style, styleMd: readStyleMd(name) }, null, 2) }] };
      }
    );
  });
}
