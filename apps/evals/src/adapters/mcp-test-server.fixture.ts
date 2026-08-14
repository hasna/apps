import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const tools = ["echo", "json_tool", "multi_content", "error_tool", "mapped_tool"].map((name) => ({
  name,
  description: `Test fixture tool: ${name}`,
  inputSchema: { type: "object" as const, additionalProperties: true },
}));

const server = new Server(
  { name: "evals-mcp-adapter-test", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;

  switch (request.params.name) {
    case "echo":
      return { content: [{ type: "text", text: `echo: ${String(args["input"] ?? "")}` }] };
    case "json_tool":
      return { content: [{ type: "text", text: '{"result": "ok"}' }] };
    case "multi_content":
      return {
        content: [
          { type: "text", text: "part one" },
          { type: "text", text: "part two" },
        ],
      };
    case "error_tool":
      throw new Error("Tool execution failed");
    case "mapped_tool":
      return { content: [{ type: "text", text: `query was: ${String(args["query"] ?? "")}` }] };
    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

await server.connect(new StdioServerTransport());
