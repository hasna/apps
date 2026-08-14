import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerLlmTools(server: McpServer, stripped: (text: string) => Promise<{ content: { type: "text"; text: string }[] }>) {
  // --- Tool: get_llm_config ---
  server.registerTool(
    "get_llm_config",
    {
      title: "Get LLM Config",
      description: "Get current LLM provider config and strip status.",
      inputSchema: {},
    },
    async () => {
      const { getLlmConfig: getConfig, maskKey: mask } = await import("../../lib/llm.js");
      const config = getConfig();
      if (!config) return { content: [{ type: "text" as const, text: JSON.stringify({ configured: false }) }] };
      return { content: [{ type: "text" as const, text: JSON.stringify({ configured: true, provider: config.provider, model: config.model, key: mask(config.api_key), strip: config.strip }) }] };
    }
  );

  // --- Tool: set_llm_strip ---
  server.registerTool(
    "set_llm_strip",
    {
      title: "Set LLM Strip",
      description: "Enable or disable global output stripping.",
      inputSchema: { enabled: z.boolean() },
    },
    async ({ enabled }) => {
      const { setLlmStrip } = await import("../../lib/llm.js");
      try {
        setLlmStrip(enabled);
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, strip: enabled }) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }) }], isError: true };
      }
    }
  );
}
