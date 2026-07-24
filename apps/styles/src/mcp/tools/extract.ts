import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extractStylesFromUrl, enrichTokensWithAi, type AiEnrichment } from "../../lib/extractor.js";
import { tokenizeStyles } from "../../lib/tokenizer.js";
import { transform, type TransformFormat } from "../../lib/transformer.js";
import { saveKit, getKit, listKits, deleteKit } from "../../lib/kits.js";
import { pageItems, prettyJson, truncateText } from "../../lib/format.js";

export function registerExtractTools(server: McpServer) {
  server.tool(
    "extract_styles",
    "Extract design tokens from a live website URL and optionally save as a kit",
    {
      url: z.string().url().describe("Website URL to extract styles from"),
      name: z.string().optional().describe("Name to save the kit as"),
      save: z.boolean().optional().describe("Save the extracted kit to the database"),
      format: z.enum(["shadcn", "tailwind", "css-vars", "mui", "radix"]).optional().describe("Output format (default: shadcn)"),
      tags: z.array(z.string()).optional().describe("Tags for the saved kit"),
      include_code: z.boolean().optional().describe("Include generated config code in the response"),
      verbose: z.boolean().optional().describe("Include richer token/config details"),
    },
    async ({ url, name, save, format = "shadcn", tags, include_code, verbose }) => {
      try {
        const raw = await extractStylesFromUrl(url);
        const tokens = tokenizeStyles(raw);

        let enrichment = null;
        if (process.env["CEREBRAS_API_KEY"]) {
          enrichment = await enrichTokensWithAi(tokens, url);
          for (const color of tokens.colors) {
            const colorName = enrichment.colorNames[color.value];
            if (colorName) color.name = colorName;
          }
        }

        const result = transform(tokens, format as TransformFormat);
        let kit = null;
        if (save && name) {
          kit = saveKit({ name, url, tokens, raw, tags, extractedAt: raw.extractedAt });
        }

        return {
          content: [{
            type: "text",
            text: prettyJson({
              url,
              extractedAt: raw.extractedAt,
              summary: {
                colors: tokens.colors.length,
                namedColors: tokens.colors.filter(c => c.name).length,
                fontCount: tokens.typography.fontFamilies.length,
                fontSample: tokens.typography.fontFamilies.slice(0, 5),
                borderRadiusCount: tokens.borderRadius.length,
                borderRadiusSample: tokens.borderRadius.slice(0, 8),
                shadows: tokens.shadows.length,
                enrichment: summarizeEnrichment(enrichment),
              },
              ...(include_code || verbose ? { code: result.code } : {}),
              ...(verbose ? { enrichment, config: result.config, sampleColors: tokens.colors.slice(0, 10) } : {}),
              kit: kit ? { id: kit.id, name: kit.name } : null,
              hint: include_code || verbose ? "Code included by request." : "Pass include_code=true for generated config or verbose=true for richer token details.",
            }),
          }],
        };
      } catch (e) {
        return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  server.tool(
    "list_kits",
    "List all saved style kits",
    {
      search: z.string().optional().describe("Search by name, URL, or tags"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
      limit: z.number().int().positive().optional().describe("Maximum kits to return in compact output (default: 20)"),
      cursor: z.number().int().nonnegative().optional().describe("Zero-based pagination offset"),
      verbose: z.boolean().optional().describe("Include tags and more token counts"),
    },
    async ({ search, tags, limit, cursor, verbose }) => {
      const kits = listKits({ search, tags });
      const page = pageItems(kits, { limit, cursor, defaultLimit: 20, maxLimit: 100 });
      return {
        content: [{
          type: "text",
          text: prettyJson({
            kits: page.items.map((k) => ({
            id: k.id, name: k.name, url: k.url,
            createdAt: k.createdAt,
            summary: {
              colors: k.tokens.colors.length,
              fonts: k.tokens.typography.fontFamilies.length,
              shadows: k.tokens.shadows.length,
              ...(verbose ? { tags: k.tags, radii: k.tokens.borderRadius.length, spacing: k.tokens.spacing.length } : {}),
            },
          })),
            total: page.total,
            limit: page.limit,
            cursor: page.cursor,
            nextCursor: page.nextCursor,
            hint: "Use get_kit with verbose=true for full token/raw data.",
          }),
        }],
      };
    }
  );

  server.tool(
    "get_kit",
    "Get a saved style kit by ID",
    {
      id: z.string().describe("Kit ID"),
      verbose: z.boolean().optional().describe("Return full token/raw data"),
    },
    async ({ id, verbose }) => {
      const kit = getKit(id);
      if (!kit) return { content: [{ type: "text", text: `Kit not found: ${id}` }], isError: true };
      return { content: [{ type: "text", text: prettyJson(verbose ? kit : {
        id: kit.id,
        name: kit.name,
        url: kit.url,
        tags: kit.tags,
        extractedAt: kit.extractedAt,
        updatedAt: kit.updatedAt,
        summary: {
          colors: kit.tokens.colors.length,
          fonts: kit.tokens.typography.fontFamilies,
          radii: kit.tokens.borderRadius.length,
          shadows: kit.tokens.shadows.length,
        },
        notes: kit.notes ? truncateText(kit.notes, 160) : undefined,
        hint: "Pass verbose=true for full token/raw data.",
      }) }] };
    }
  );

  server.tool(
    "export_kit",
    "Export a saved kit as a config string",
    {
      id: z.string().describe("Kit ID"),
      format: z.enum(["shadcn", "tailwind", "css-vars", "mui", "radix"]).optional().describe("Output format (default: shadcn)"),
    },
    async ({ id, format = "shadcn" }) => {
      const kit = getKit(id);
      if (!kit) return { content: [{ type: "text", text: `Kit not found: ${id}` }], isError: true };
      const result = transform(kit.tokens, format as TransformFormat);
      return { content: [{ type: "text", text: result.code }] };
    }
  );

  server.tool(
    "delete_kit",
    "Delete a saved style kit",
    { id: z.string().describe("Kit ID to delete") },
    async ({ id }) => {
      deleteKit(id);
      return { content: [{ type: "text", text: `Deleted kit ${id}` }] };
    }
  );

  server.tool(
    "kit_to_profile",
    "Convert a saved style kit into a reusable style profile",
    {
      id: z.string().describe("Kit ID"),
      name: z.string().describe("Profile name (kebab-case)"),
    },
    async ({ id, name }) => {
      const { kitToProfile } = await import("../../lib/kits.js");
      const { createProfile } = await import("../../lib/profiles.js");
      const kit = getKit(id);
      if (!kit) return { content: [{ type: "text", text: `Kit not found: ${id}` }], isError: true };
      const profileInput = kitToProfile(kit, name);
      const profile = createProfile(profileInput);
      return { content: [{ type: "text", text: prettyJson({
        id: profile.id,
        name: profile.name,
        displayName: profile.displayName,
        category: profile.category,
        colorKeys: Object.keys(profile.colors).length,
        componentRuleKeys: Object.keys(profile.componentRules).length,
        hint: "Use list_profiles/get_active_style verbose paths for more profile details.",
      }) }] };
    }
  );
}

function summarizeEnrichment(enrichment: AiEnrichment | null) {
  if (!enrichment) return null;
  return {
    detectedStyle: enrichment.detectedStyle,
    suggestedName: enrichment.suggestedName,
    profileDescription: truncateText(enrichment.profileDescription, 160),
    colorNameCount: Object.keys(enrichment.colorNames).length,
  };
}
