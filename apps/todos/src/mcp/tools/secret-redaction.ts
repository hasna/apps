import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

type Helpers = {
  shouldRegisterTool: (name: string) => boolean;
  formatError: (e: unknown) => string;
};

export function registerSecretRedactionTools(server: McpServer, { shouldRegisterTool, formatError }: Helpers): void {
  if (shouldRegisterTool("scan_text_for_secrets")) {
    server.tool(
      "scan_text_for_secrets",
      "Scan text for secret patterns (API keys, tokens, private keys). Returns redacted output — never raw secrets.",
      {
        text: z.string(),
        redact: z.boolean().optional(),
      },
      async ({ text, redact }) => {
        try {
          const { scanTextForSecrets, scanAndRedactText } = await import("../../lib/secret-redaction.js");
          const result = redact ? scanAndRedactText(text) : scanTextForSecrets(text);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("scan_file_for_secrets")) {
    server.tool(
      "scan_file_for_secrets",
      "Scan a local file for secret patterns before release or export.",
      { path: z.string() },
      async ({ path }) => {
        try {
          const { scanFileForSecrets } = await import("../../lib/secret-redaction.js");
          const result = scanFileForSecrets(path);
          return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }

  if (shouldRegisterTool("list_secret_patterns")) {
    server.tool(
      "list_secret_patterns",
      "List built-in secret detection patterns (denylist).",
      {},
      async () => {
        try {
          const { getDefaultSecretPatterns } = await import("../../lib/secret-redaction.js");
          return { content: [{ type: "text" as const, text: JSON.stringify(getDefaultSecretPatterns(), null, 2) }] };
        } catch (e) {
          return { content: [{ type: "text" as const, text: formatError(e) }], isError: true };
        }
      },
    );
  }
}
