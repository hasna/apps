import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { extractStylesFromUrl, enrichTokensWithAi } from "../../lib/extractor.js";
import { tokenizeStyles } from "../../lib/tokenizer.js";
import { transform, type TransformFormat } from "../../lib/transformer.js";
import { saveKit, getKit, listKits, deleteKit } from "../../lib/kits.js";

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
    },
    async ({ url, name, save, format = "shadcn", tags }) => {
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
            text: JSON.stringify({
              url, extractedAt: raw.extractedAt, enrichment,
              summary: {
                colors: tokens.colors.length,
                namedColors: tokens.colors.filter(c => c.name).length,
                fonts: tokens.typography.fontFamilies,
                borderRadii: tokens.borderRadius,
                shadows: tokens.shadows.length,
                detectedStyle: enrichment?.detectedStyle,
                suggestedName: enrichment?.suggestedName,
              },
              code: result.code,
              kit: kit ? { id: kit.id, name: kit.name } : null,
            }, null, 2),
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
    },
    async ({ search, tags }) => {
      const kits = listKits({ search, tags });
      return {
        content: [{
          type: "text",
          text: JSON.stringify(kits.map((k) => ({
            id: k.id, name: k.name, url: k.url,
            tags: k.tags, createdAt: k.createdAt,
            summary: { colors: k.tokens.colors.length, fonts: k.tokens.typography.fontFamilies, shadows: k.tokens.shadows.length },
          })), null, 2),
        }],
      };
    }
  );

  server.tool(
    "get_kit",
    "Get a saved style kit by ID",
    { id: z.string().describe("Kit ID") },
    async ({ id }) => {
      const kit = getKit(id);
      if (!kit) return { content: [{ type: "text", text: `Kit not found: ${id}` }], isError: true };
      return { content: [{ type: "text", text: JSON.stringify(kit, null, 2) }] };
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
      return { content: [{ type: "text", text: JSON.stringify(profile, null, 2) }] };
    }
  );
}
