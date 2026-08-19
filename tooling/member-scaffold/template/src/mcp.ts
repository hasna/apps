/**
 * MCP entry — `<name>-mcp` bin. A minimal stdio JSON-RPC server so the
 * surface exists without a dependency: implement real tools here.
 */
import { readFileSync } from "node:fs";

const encoder = new TextEncoder();
const send = (msg: unknown) => {
  const payload = JSON.stringify(msg);
  process.stdout.write(encoder.encode(`Content-Length: ${payload.length}\r\n\r\n${payload}`));
};

process.stdin.on("data", (chunk: Buffer) => {
  const text = chunk.toString("utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const req = JSON.parse(trimmed);
      if (req.method === "initialize") {
        send({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "@hasna/__MEMBER__", version: "0.0.0" } } });
      } else if (req.method === "tools/list") {
        send({ jsonrpc: "2.0", id: req.id, result: { tools: [{ name: "ping", description: "ping", inputSchema: { type: "object", properties: {} } }] } });
      } else if (req.method === "tools/call" && req.params?.name === "ping") {
        send({ jsonrpc: "2.0", id: req.id, result: { content: [{ type: "text", text: "pong" }] } });
      } else if (req.id !== undefined) {
        send({ jsonrpc: "2.0", id: req.id, result: {} });
      }
    } catch {
      // not a JSON-RPC line — ignore (keep the stream alive for chunked input)
    }
  }
});
void readFileSync;
