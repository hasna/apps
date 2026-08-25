import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkgDir = join(import.meta.dir, "..", "..");
const pkgVersion = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version as string;

const TIMEOUT_MS = 10_000;

/** Read one newline-delimited line from a subprocess stdout stream, bounded. */
async function readLine(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const chunk = await Promise.race([
      reader.read(),
      new Promise<"TIMEOUT">((resolve) => setTimeout(() => resolve("TIMEOUT"), TIMEOUT_MS)),
    ]);
    if (chunk === "TIMEOUT") {
      await reader.cancel();
      throw new Error(`timeout reading MCP stdout line; buffered: ${JSON.stringify(buf)}`);
    }
    if (chunk.done) throw new Error(`stream closed before a full line; buffered: ${JSON.stringify(buf)}`);
    buf += decoder.decode(chunk.value, { stream: true });
    const nl = buf.indexOf("\n");
    if (nl >= 0) {
      reader.releaseLock();
      return buf.slice(0, nl);
    }
  }
}

interface McpMessage {
  jsonrpc: string;
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

interface SpawnHandle {
  stdin: { write: (data: string) => void; end: () => void };
  stdout: ReadableStream<Uint8Array>;
}

async function send(proc: SpawnHandle, id: number, method: string, params: Record<string, unknown>): Promise<McpMessage> {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return JSON.parse(await readLine(proc.stdout)) as McpMessage;
}

async function startMcp(args: string[] = []) {
  return Bun.spawn(["bun", "src/mcp/index.ts", ...args], {
    cwd: pkgDir,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("workflows-mcp (slice 1 scaffold)", () => {
  test("--version answers before starting and exits 0", async () => {
    const proc = await startMcp(["--version"]);
    const stdout = (await new Response(proc.stdout).text()).trim();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toBe(pkgVersion);
  });

  test("--help answers before starting and exits 0", async () => {
    const proc = await startMcp(["--help"]);
    const stdout = (await new Response(proc.stdout).text()).trim();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toContain("workflows-mcp");
  });

  test("initialize returns protocol version, capabilities and server info", async () => {
    const proc = await startMcp();
    try {
      const resp = await send(proc, 1, "initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "workflows-test", version: "0.0.0" },
      });
      expect(resp.id).toBe(1);
      expect(resp.error).toBeUndefined();
      const result = resp.result as { protocolVersion: string; capabilities: { tools: Record<string, unknown> }; serverInfo: { name: string; version: string } };
      expect(result.protocolVersion).toBe("2024-11-05");
      expect(result.capabilities.tools).toBeDefined();
      expect(result.serverInfo.name).toBe("workflows-mcp");
      expect(result.serverInfo.version).toBe(pkgVersion);
    } finally {
      proc.stdin.end();
      await proc.exited;
    }
  });

  test("tools/list exposes the workflows tools", async () => {
    const proc = await startMcp();
    try {
      await send(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "workflows-test", version: "0.0.0" } });
      const resp = await send(proc, 2, "tools/list", {});
      const result = resp.result as { tools: { name: string }[] };
      const names = result.tools.map((t) => t.name);
      expect(names).toEqual([
        "workflows_version",
        "workflows_health",
        "workflows_ready",
        "workflows_validate",
        "workflows_run",
        "workflows_runs_list",
        "workflows_lanes_list",
      ]);
    } finally {
      proc.stdin.end();
      await proc.exited;
    }
  });

  test("tools/call workflows_version returns the version", async () => {
    const proc = await startMcp();
    try {
      await send(proc, 1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "workflows-test", version: "0.0.0" } });
      const resp = await send(proc, 3, "tools/call", { name: "workflows_version", arguments: {} });
      const result = resp.result as { content: { type: string; text: string }[]; isError: boolean };
      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain(pkgVersion);
    } finally {
      proc.stdin.end();
      await proc.exited;
    }
  });

  test("an unknown method returns a JSON-RPC error", async () => {
    const proc = await startMcp();
    try {
      const resp = await send(proc, 9, "no/such-method", {});
      expect(resp.error?.code).toBe(-32601);
    } finally {
      proc.stdin.end();
      await proc.exited;
    }
  });
});
