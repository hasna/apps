import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpAdapterConfig } from "../types/index.js";
import type { AdapterResponse } from "./http.js";

export async function callMcpAdapter(
  config: McpAdapterConfig,
  input: string
): Promise<AdapterResponse> {
  const start = Date.now();
  const [command, ...args] = config.command;

  if (!command) {
    return { output: "", durationMs: 0, error: "MCP adapter: command is empty" };
  }

  const transport = new StdioClientTransport({ command, args });
  const client = new Client({ name: "evals-mcp-adapter", version: "1.0.0" });

  try {
    await client.connect(transport);

    // Build tool arguments — either from inputMapping or wrap input as { input }
    let toolArgs: Record<string, unknown>;
    if (config.inputMapping) {
      toolArgs = {};
      for (const [key, value] of Object.entries(config.inputMapping)) {
        toolArgs[key] = value === "{{input}}" ? input : value;
      }
    } else {
      toolArgs = { input };
    }

    const result = await client.callTool(
      { name: config.tool, arguments: toolArgs },
      undefined,
      { timeout: config.timeoutMs ?? 30_000 }
    );

    // Extract text content from MCP result
    const content = result.content;
    let output = "";
    if (Array.isArray(content)) {
      output = content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
    } else {
      output = JSON.stringify(content);
    }

    return { output, durationMs: Date.now() - start };
  } catch (err) {
    return {
      output: "",
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}
