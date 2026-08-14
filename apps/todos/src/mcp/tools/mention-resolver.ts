import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  resolveId: (partialId: string, table: string) => string | null;
  formatError: (e: unknown) => string;
};

export function registerMentionResolverTools(
  server: McpServer,
  { shouldRegisterTool, formatError }: Helpers,
): void {
  if (shouldRegisterTool("parse_mentions")) {
    server.tool(
      "parse_mentions",
      "Parse @file, @symbol, @task, @plan, @run, git refs, and URLs from text without resolving.",
      {
        text: z.string(),
      },
      async ({ text }) => {
        try {
          const { parseMentions } = await import("../../lib/mention-resolver.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(parseMentions(text), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("resolve_mention")) {
    server.tool(
      "resolve_mention",
      "Resolve a single mention (@file, @symbol, task/plan/run ref, branch, commit, PR, URL) to a local link and snippet.",
      {
        kind: z.enum(["file", "symbol", "task", "plan", "run", "branch", "commit", "pr", "url"]),
        target: z.string(),
        cwd: z.string().optional(),
        redact: z.boolean().optional(),
      },
      async ({ kind, target, cwd, redact }) => {
        try {
          const { resolveMention, formatResolvedMention } = await import("../../lib/mention-resolver.js");
          const resolved = resolveMention(kind, target, { cwd, redact });
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ formatted: formatResolvedMention(resolved), ...resolved }, null, 2),
              },
            ],
          };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("resolve_mentions_in_text")) {
    server.tool(
      "resolve_mentions_in_text",
      "Parse and resolve all mentions in text. Snippets redacted by default.",
      {
        text: z.string(),
        cwd: z.string().optional(),
        redact: z.boolean().optional(),
        format: z.enum(["json", "text"]).optional(),
      },
      async ({ text, cwd, redact, format }) => {
        try {
          const { resolveMentionsInText, formatMentionResolutionResult } = await import("../../lib/mention-resolver.js");
          const result = resolveMentionsInText(text, { cwd, redact });
          const out = format === "text" ? formatMentionResolutionResult(result) : JSON.stringify(result, null, 2);
          return { content: [{ type: "text" as const, text: out }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
