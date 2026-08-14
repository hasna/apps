// Minimal MCP-over-HTTP (streamable) client — just enough to talk to the ui.sh
// MCP server (or any MCP server) and call tools / read resources. This is the
// "does what the MCP does" client half: it speaks the same protocol the agent's
// built-in MCP transport speaks, so we can mirror the ui.sh resources locally.

export interface RpcResult {
  result?: any;
  error?: { code: number; message: string };
}

/** Parse either a plain JSON body or an SSE (`event:`/`data:`) framed body. */
function parseBody(text: string): any {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return JSON.parse(trimmed);
  }
  // SSE: collect the JSON from `data:` lines (last data event wins for a single id).
  const dataLines = text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter(Boolean);
  if (dataLines.length === 0) {
    throw new Error(`Unparseable MCP body: ${text.slice(0, 200)}`);
  }
  // Return the first data payload that carries a JSON-RPC result/error.
  for (const d of dataLines) {
    const obj = JSON.parse(d);
    if (obj.result !== undefined || obj.error !== undefined) return obj;
  }
  return JSON.parse(dataLines[dataLines.length - 1]);
}

export class McpHttpClient {
  private url: string;
  private token?: string;
  private sessionId?: string;
  private nextId = 1;

  constructor(opts: { url: string; token?: string }) {
    this.url = opts.url;
    this.token = opts.token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  private async rpc(method: string, params?: unknown): Promise<any> {
    const id = this.nextId++;
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const sid = res.headers.get("mcp-session-id");
    if (sid) this.sessionId = sid;
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`MCP ${method} HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const body = parseBody(text) as RpcResult;
    if (body.error) throw new Error(`MCP ${method} error ${body.error.code}: ${body.error.message}`);
    return body.result;
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", method, params }),
    });
  }

  async initialize(): Promise<void> {
    await this.rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "ui-local", version: "0.0.1" },
    });
    await this.notify("notifications/initialized");
  }

  async listTools(): Promise<any[]> {
    const r = await this.rpc("tools/list");
    return r?.tools ?? [];
  }

  /** Call a tool and return the concatenated text content. */
  async callToolText(name: string, args: Record<string, unknown>): Promise<string> {
    const r = await this.rpc("tools/call", { name, arguments: args });
    const content = r?.content ?? [];
    return content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }
}
