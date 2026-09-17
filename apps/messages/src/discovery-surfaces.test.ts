import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SqliteMessagesStore } from "./server/sqlite-store";
import { MessagesService } from "./service";
import { buildHandler } from "./server/serve-entry";
import { createAuthGate } from "./server/auth";

test("CLI and MCP advertise stations, discover peers and acknowledge durable inboxes over authenticated HTTP", async () => {
  const root = await mkdtemp(join(tmpdir(), "messages-surfaces-"));
  const key = randomUUID();
  const store = new SqliteMessagesStore(new Database(":memory:"));
  const handler = buildHandler({
    service: new MessagesService(store),
    backend: "sqlite",
    auth: createAuthGate({
      env: { HASNA_MESSAGES_API_KEY: key },
      warn: () => {},
    }),
  });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: root,
    HASNA_HOME: root,
    HASNA_MESSAGES_API_URL: server.url.origin,
    HASNA_MESSAGES_API_KEY_OVERRIDE: key,
  };
  const client = new Client({ name: "messages-proof", version: "1" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("./mcp/index.ts", import.meta.url).pathname],
    env,
    stderr: "pipe",
  });
  async function cli(...args: string[]) {
    const proc = Bun.spawn(
      [
        process.execPath,
        new URL("./cli/index.ts", import.meta.url).pathname,
        ...args,
      ],
      { env, stdout: "pipe", stderr: "pipe" },
    );
    const output = await new Response(proc.stdout).text();
    await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(0);
    return JSON.parse(output);
  }
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    expect(result.isError).not.toBe(true);
    return JSON.parse((result.content as Array<{ text: string }>)[0]!.text);
  }
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    for (const name of [
      "messages_discover",
      "messages_heartbeat",
      "messages_inbox",
      "messages_ack",
    ])
      expect(names).toContain(name);
    await cli(
      "heartbeat",
      "--runtime",
      "one",
      "--station",
      "desk-one",
      "--agents",
      "alice",
    );
    await call("messages_heartbeat", {
      runtime_id: "two",
      station: "desk-two",
      application: "any-harness",
      agents: [{ name: "bob" }],
    });
    const found = await cli("discover", "--station", "desk-two", "--online");
    expect(found.agents[0]).toMatchObject({
      name: "bob",
      station: "desk-two",
      online: true,
    });
    const sent = await cli(
      "send",
      "--from",
      "alice",
      "--to",
      "bob",
      "--content",
      "hello",
      "--idempotency-key",
      "surface-retry",
    );
    const again = await call("messages_send", {
      from: "alice",
      to: "bob",
      content: "hello",
      idempotencyKey: "surface-retry",
    });
    expect(again.message.id).toBe(sent.message.id);
    const inbox = await call("messages_inbox", { runtime_id: "two" });
    expect(inbox.messages).toHaveLength(1);
    expect((await cli("inbox", "--runtime", "two")).messages).toHaveLength(1);
    expect(
      (
        await call("messages_ack", {
          runtime_id: "two",
          message_ids: [sent.message.id],
        })
      ).acknowledged,
    ).toBe(1);
    expect((await cli("inbox", "--runtime", "two")).messages).toEqual([]);
    expect(
      (await call("messages_discover", { station: "desk-one" })).agents[0].name,
    ).toBe("alice");
  } finally {
    await client.close();
    server.stop(true);
    store.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
