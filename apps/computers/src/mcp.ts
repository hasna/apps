import { ComputersError, VERSION, type PackageSpec } from "./contracts";
import { ComputersClient, EnvironmentCredentialProvider } from "./sdk";
import { assertExactKeys, MCP_INPUT_SCHEMA_FRAGMENTS, validateArgv, validateId, validateIdempotencyKey, validatePackageSpec, validateRequestObject } from "./validation";

const PROTOCOL_VERSION = "2025-03-26";
const MAX_MCP_MESSAGE_BYTES = 1024 * 1024;

type JsonRpcId = string | number;
type JsonRpcResponseId = JsonRpcId | null;
interface JsonRpcResponse { jsonrpc: "2.0"; id: JsonRpcResponseId; result?: unknown; error?: { code: number; message: string; data?: unknown } }

const annotations = (readOnlyHint: boolean, destructiveHint: boolean, idempotentHint: boolean, openWorldHint: boolean) => ({
  readOnlyHint, destructiveHint, idempotentHint, openWorldHint,
});

const TOOLS = [
  { name: "computers_list", description: "List authorized Computers", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: annotations(true, false, true, false) },
  { name: "computers_get", description: "Get one authorized Computer", inputSchema: { type: "object", properties: { id: MCP_INPUT_SCHEMA_FRAGMENTS.id }, required: ["id"], additionalProperties: false }, annotations: annotations(true, false, true, false) },
  { name: "computers_operations", description: "List authorized operations", inputSchema: { type: "object", properties: { computerId: MCP_INPUT_SCHEMA_FRAGMENTS.id }, additionalProperties: false }, annotations: annotations(true, false, true, false) },
  { name: "computers_exec_request", description: "Request typed argv execution; no shell strings", inputSchema: { type: "object", properties: { computerId: MCP_INPUT_SCHEMA_FRAGMENTS.id, argv: MCP_INPUT_SCHEMA_FRAGMENTS.argv, idempotencyKey: MCP_INPUT_SCHEMA_FRAGMENTS.idempotencyKey }, required: ["computerId", "argv", "idempotencyKey"], additionalProperties: false }, annotations: annotations(false, true, true, true) },
  { name: "computers_install_plan", description: "Evaluate a typed package spec against immutable install policy", inputSchema: { type: "object", properties: { computerId: MCP_INPUT_SCHEMA_FRAGMENTS.id, spec: MCP_INPUT_SCHEMA_FRAGMENTS.packageSpec }, required: ["computerId", "spec"], additionalProperties: false }, annotations: annotations(false, false, false, false) },
  { name: "computers_provider_readiness", description: "Report truthful provider readiness", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: annotations(true, false, true, false) },
] as const;

function success(id: JsonRpcResponseId, result: unknown): JsonRpcResponse { return { jsonrpc: "2.0", id, result }; }
function failure(id: JsonRpcResponseId, code: number, message: string, data?: unknown): JsonRpcResponse {
  const error: { code: number; message: string; data?: unknown } = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

function requestId(value: unknown): JsonRpcId | undefined {
  if (typeof value === "string" || (typeof value === "number" && Number.isSafeInteger(value))) return value;
  return undefined;
}

export class ComputersMcpServer {
  readonly #client: ComputersClient;
  #initializeReceived = false;
  #initialized = false;

  constructor(client: ComputersClient) { this.#client = client; }

  async handle(raw: unknown): Promise<string | undefined> {
    if (Array.isArray(raw)) {
      if (raw.length === 0) return JSON.stringify(failure(null, -32600, "Invalid Request"));
      const responses = (await Promise.all(raw.map((item) => this.#handleSingle(item, true)))).filter((item): item is JsonRpcResponse => item !== undefined);
      return responses.length === 0 ? undefined : JSON.stringify(responses);
    }
    const result = await this.#handleSingle(raw);
    return result === undefined ? undefined : JSON.stringify(result);
  }

  async #handleSingle(raw: unknown, inBatch = false): Promise<JsonRpcResponse | undefined> {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return failure(null, -32600, "Invalid Request");
    const request = raw as Record<string, unknown>;
    const idPresent = Object.hasOwn(request, "id");
    const id = idPresent ? requestId(request.id) : undefined;
    if (request.jsonrpc !== "2.0" || typeof request.method !== "string" || (idPresent && id === undefined)
      || Object.keys(request).some((key) => !["jsonrpc", "id", "method", "params"].includes(key))
      || (request.params !== undefined && (typeof request.params !== "object" || request.params === null || Array.isArray(request.params)))) {
      return failure(null, -32600, "Invalid Request");
    }
    const notification = !idPresent;
    const respond = (value: JsonRpcResponse): JsonRpcResponse | undefined => notification ? undefined : value;

    if (request.method === "initialize") {
      if (notification || inBatch || this.#initializeReceived) return respond(failure(id ?? null, -32600, "Invalid Request"));
      try {
        const params = validateRequestObject(request.params);
        assertExactKeys(params, ["protocolVersion", "capabilities", "clientInfo"]);
        if (typeof params.protocolVersion !== "string" || params.protocolVersion.length < 1 || params.protocolVersion.length > 64) throw new Error("invalid protocol version");
        const capabilities = validateRequestObject(params.capabilities);
        assertExactKeys(capabilities, ["roots", "sampling", "elicitation", "experimental"]);
        if (capabilities.roots !== undefined) {
          const roots = validateRequestObject(capabilities.roots); assertExactKeys(roots, ["listChanged"]);
          if (roots.listChanged !== undefined && typeof roots.listChanged !== "boolean") throw new Error("invalid roots capability");
        }
        for (const name of ["sampling", "elicitation", "experimental"] as const) {
          if (capabilities[name] !== undefined) validateRequestObject(capabilities[name]);
        }
        const clientInfo = validateRequestObject(params.clientInfo); assertExactKeys(clientInfo, ["name", "version"]);
        if (typeof clientInfo.name !== "string" || clientInfo.name.length < 1 || clientInfo.name.length > 128
          || typeof clientInfo.version !== "string" || clientInfo.version.length < 1 || clientInfo.version.length > 64) throw new Error("invalid client info");
      } catch { return failure(id ?? null, -32602, "Invalid params"); }
      this.#initializeReceived = true;
      return success(id ?? null, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "computers-mcp", version: VERSION }, instructions: "Safe Computers subset; no delete, restore, reassignment, policy, or Sandbox mutation." });
    }
    if (request.method === "notifications/initialized") {
      if (!notification || !this.#initializeReceived || this.#initialized) return respond(failure(id ?? null, -32600, "Invalid Request"));
      if (request.params !== undefined) {
        try { const params = validateRequestObject(request.params); assertExactKeys(params, []); }
        catch { return undefined; }
      }
      this.#initialized = true;
      return undefined;
    }
    if (!this.#initialized) return respond(failure(id ?? null, -32002, "Server not initialized"));
    if (request.method === "notifications/cancelled") {
      if (!notification) return failure(id ?? null, -32600, "Invalid Request");
      try {
        const params = validateRequestObject(request.params); assertExactKeys(params, ["requestId", "reason"]);
        if (requestId(params.requestId) === undefined || (params.reason !== undefined && (typeof params.reason !== "string" || params.reason.length > 1024))) throw new Error("invalid cancellation");
      } catch { return undefined; }
      return undefined;
    }
    if (request.method === "ping") {
      if (request.params !== undefined) {
        try { const params = validateRequestObject(request.params); assertExactKeys(params, []); }
        catch { return respond(failure(id ?? null, -32602, "Invalid params")); }
      }
      return respond(success(id ?? null, {}));
    }
    if (request.method === "tools/list") {
      if (request.params !== undefined) {
        try { const params = validateRequestObject(request.params); assertExactKeys(params, ["cursor"]); if (params.cursor !== undefined) throw new Error("pagination unsupported"); }
        catch { return respond(failure(id ?? null, -32602, "Invalid params")); }
      }
      return respond(success(id ?? null, { tools: TOOLS }));
    }
    if (request.method !== "tools/call") return respond(failure(id ?? null, -32601, "Method not found"));
    if (notification) return undefined;

    let name: string; let args: Record<string, unknown>;
    try {
      const params = validateRequestObject(request.params); assertExactKeys(params, ["name", "arguments"]);
      if (typeof params.name !== "string") throw new Error("invalid name");
      name = params.name; args = validateRequestObject(params.arguments ?? {});
      this.#validateToolArguments(name, args);
    } catch { return failure(id ?? null, -32602, "Invalid params"); }

    try {
      let value: unknown;
      if (name === "computers_list") value = { data: await this.#client.listComputers() };
      else if (name === "computers_get") value = await this.#client.getComputer(String(args.id));
      else if (name === "computers_operations") value = { data: await this.#client.listOperations(args.computerId === undefined ? undefined : String(args.computerId)) };
      else if (name === "computers_exec_request") value = await this.#client.requestExec(String(args.computerId), { argv: args.argv as string[], idempotencyKey: String(args.idempotencyKey) });
      else if (name === "computers_install_plan") value = await this.#client.installPlan(String(args.computerId), args.spec as PackageSpec);
      else if (name === "computers_provider_readiness") value = { data: await this.#client.providerReadiness() };
      else return failure(id ?? null, -32602, "Unknown tool");
      return success(id ?? null, { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
    } catch (error) {
      const domain = error instanceof ComputersError ? error : new ComputersError("storage_error", "Tool call failed", 500);
      return success(id ?? null, { isError: true, content: [{ type: "text", text: JSON.stringify({ code: domain.code, message: domain.message }) }] });
    }
  }

  #validateToolArguments(name: string, args: Record<string, unknown>): void {
    if (name === "computers_list" || name === "computers_provider_readiness") { assertExactKeys(args, []); return; }
    if (name === "computers_get") { assertExactKeys(args, ["id"]); validateId(args.id); return; }
    if (name === "computers_operations") { assertExactKeys(args, ["computerId"]); if (args.computerId !== undefined) validateId(args.computerId, "computerId"); return; }
    if (name === "computers_exec_request") {
      assertExactKeys(args, ["computerId", "argv", "idempotencyKey"]); validateId(args.computerId, "computerId"); validateArgv(args.argv); validateIdempotencyKey(args.idempotencyKey); return;
    }
    if (name === "computers_install_plan") {
      assertExactKeys(args, ["computerId", "spec"]); validateId(args.computerId, "computerId"); validatePackageSpec(args.spec); return;
    }
    throw new Error("unknown tool");
  }
}

export async function runMcpStdio(): Promise<void> {
  const baseUrl = Bun.env.COMPUTERS_API_URL;
  if (baseUrl === undefined) throw new ComputersError("authentication_required", "MCP controller configuration is invalid", 500);
  const server = new ComputersMcpServer(new ComputersClient({ baseUrl, credentials: new EnvironmentCredentialProvider() }));
  const decoder = new TextDecoder(); let buffered = "";
  const reader = Bun.stdin.stream().getReader();
  while (true) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(chunk, { stream: true });
    if (new TextEncoder().encode(buffered).byteLength > MAX_MCP_MESSAGE_BYTES) {
      process.stdout.write(`${JSON.stringify(failure(null, -32600, "Invalid Request"))}\n`); buffered = ""; continue;
    }
    const lines = buffered.split("\n"); buffered = lines.pop() ?? "";
    for (const line of lines) await processLine(server, line);
  }
  if (buffered.trim().length > 0) await processLine(server, buffered);
}

async function processLine(server: ComputersMcpServer, line: string): Promise<void> {
  if (line.trim().length === 0) return;
  let parsed: unknown;
  try { parsed = JSON.parse(line); }
  catch { process.stdout.write(`${JSON.stringify(failure(null, -32700, "Parse error"))}\n`); return; }
  const result = await server.handle(parsed);
  if (result !== undefined) process.stdout.write(`${result}\n`);
}

export { TOOLS as SAFE_MCP_TOOLS };
