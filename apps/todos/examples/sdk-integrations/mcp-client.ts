#!/usr/bin/env bun

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "todos-mcp",
  args: [],
});

const client = new Client({
  name: "todos-local-example",
  version: "1.0.0",
});

await client.connect(transport);

try {
  const tasks = await client.callTool({
    name: "list_tasks",
    arguments: { status: "pending", limit: 5 },
  });
  const snapshot = await client.callTool({
    name: "get_local_snapshot",
    arguments: { type: "tasks", limit: 5 },
  });

  console.log(JSON.stringify({ tasks, snapshot }, null, 2));
} finally {
  await client.close();
}
