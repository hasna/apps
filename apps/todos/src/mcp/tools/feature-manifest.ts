import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerFeatureManifestTools(
  server: McpServer,
  { shouldRegisterTool, formatError }: Helpers,
): void {
  if (shouldRegisterTool("get_feature_manifest")) {
    server.tool(
      "get_feature_manifest",
      "Get the local feature manifest: CLI commands, MCP tools, profiles, and env vars.",
      {
        profile: z.string().optional().describe("Access profile override (minimal|standard|full|...)"),
        format: z.enum(["json", "text"]).optional().describe("Output format (default: json)"),
      },
      async (params) => {
        try {
          const { buildFeatureManifest, formatFeatureManifestReport } = await import("../../lib/feature-manifest.js");
          const { resolveAccessProfile } = await import("../../lib/access-profiles.js");
          const profile = params.profile ? resolveAccessProfile(params.profile) : resolveAccessProfile();
          const manifest = buildFeatureManifest({ profile });
          const text = params.format === "text"
            ? formatFeatureManifestReport(manifest)
            : JSON.stringify(manifest, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_capability_discovery")) {
    server.tool(
      "get_capability_discovery",
      "Search local CLI/MCP capabilities, profiles, and env vars by keyword.",
      {
        query: z.string().optional().describe("Search keyword"),
        surface: z.enum(["all", "cli", "mcp"]).optional().describe("Filter by surface"),
        profile: z.string().optional().describe("Access profile for MCP tool filtering"),
        limit: z.number().int().min(1).max(200).optional().describe("Max matches (default 50)"),
        format: z.enum(["json", "text"]).optional().describe("Output format (default: json)"),
      },
      async (params) => {
        try {
          const { getCapabilityDiscovery } = await import("../../lib/feature-manifest.js");
          const { resolveAccessProfile } = await import("../../lib/access-profiles.js");
          const discovery = getCapabilityDiscovery({
            query: params.query,
            surface: params.surface,
            profile: params.profile ? resolveAccessProfile(params.profile) : undefined,
            limit: params.limit,
          });

          if (params.format === "text") {
            const lines = discovery.matches.map(
              (m) => `[${m.kind}] ${m.name} (${m.surface}) — ${m.description}`,
            );
            lines.unshift(
              `Capability discovery${discovery.query ? `: "${discovery.query}"` : ""}`,
              `Matched: ${discovery.totals.matched} | CLI: ${discovery.totals.cli} | MCP: ${discovery.totals.mcp}`,
              "",
            );
            return { content: [{ type: "text" as const, text: lines.join("\n") }] };
          }

          return { content: [{ type: "text" as const, text: JSON.stringify(discovery, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("get_feature_manifest_docs")) {
    server.tool(
      "get_feature_manifest_docs",
      "Quickstart docs for local feature manifest and capability discovery.",
      {},
      async () => {
        try {
          const { getFeatureManifestDocs } = await import("../../lib/feature-manifest.js");
          return { content: [{ type: "text" as const, text: getFeatureManifestDocs() }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
