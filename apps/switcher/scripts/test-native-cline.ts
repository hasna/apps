import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const executable = process.env.SWITCHER_TEST_CLINE_EXECUTABLE ?? Bun.which("cline");
if (!executable) throw new Error("Set SWITCHER_TEST_CLINE_EXECUTABLE to the installed Cline 3.0.61 executable.");
const scratch = process.env.SWITCHER_TEST_ROOT ?? join(process.cwd(), "../../scratch/native-cline");
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(join(scratch, "run-"));
const project = join(root, "project");
await mkdir(project, { recursive: true });
await writeFile(join(project, "AGENTS.md"), "CLINE_NATIVE_RULE: preserve this instruction in the model request.\n");
await execFileAsync("git", ["init", "-q", project]);
const proofPath = join(project, "proof.txt");

 type Protocol = "openai-chat" | "openai-responses" | "anthropic-messages";
 type Call = { protocol: Protocol; path: string; model?: string; authorization: boolean; apiKey: boolean; marker: boolean; toolResult: boolean; turn: number };
 const calls: Call[] = [];
 const catalogCalls: Array<{ protocol: Protocol; path: string; authorization: boolean; apiKey: boolean }> = [];
 const turns = new Map<Protocol, number>();
 const sse = (type: string, value: unknown) => `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
 const response = (body: unknown) => new Response(body as BodyInit, { headers: { "content-type": "text/event-stream" } });

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const protocol: Protocol = path.endsWith("/messages") || path.endsWith("/models") && request.headers.has("x-api-key") ? "anthropic-messages" : path.endsWith("/responses") ? "openai-responses" : "openai-chat";
  const expectedKeyHeader = protocol === "anthropic-messages" ? "x-api-key" : "authorization";
  if (request.method === "GET" && path === "/v1/models") {
    const authorization = request.headers.get("authorization") === "Bearer fixture-cline-key";
    const apiKey = request.headers.get("x-api-key") === "fixture-cline-key";
    catalogCalls.push({ protocol, path, authorization, apiKey });
    if (protocol === "anthropic-messages" ? !apiKey || authorization : !authorization || apiKey)
      return Response.json({ error: "wrong catalog authentication" }, { status: 401 });
    return Response.json({ data: [
      { id: "vendor/selected", name: "Selected", context_window: 32_000, max_output_tokens: 512, supported_parameters: ["tools"], architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
      { id: "vendor/other", name: "Other", context_window: 32_000, max_output_tokens: 512, supported_parameters: ["tools"], architecture: { input_modalities: ["text"], output_modalities: ["text"] } },
    ], has_more: false });
  }
  if (request.method !== "POST" || !["/v1/messages", "/v1/responses", "/v1/chat/completions"].includes(path)) return new Response("Not found", { status: 404 });
  const body = await request.json() as any;
  const text = JSON.stringify(body);
  const turn = (turns.get(protocol) ?? 0) + 1;
  turns.set(protocol, turn);
  const authorization = request.headers.get("authorization") === "Bearer fixture-cline-key";
  const apiKey = request.headers.get("x-api-key") === "fixture-cline-key";
  const toolResult = text.includes("CLINE_FILE_PROOF");
  const record: Call = { protocol, path, model: body.model, authorization, apiKey, marker: text.includes("CLINE_NATIVE_RULE"), toolResult, turn };
  calls.push(record);
  if (protocol === "anthropic-messages" ? !apiKey || authorization : !authorization || apiKey) {
    return Response.json({ error: `expected ${expectedKeyHeader} authentication` }, { status: 401 });
  }
  if (!record.marker) return Response.json({ error: "project instructions were omitted from the native request" }, { status: 500 });
  if (turn === 1) {
    if (protocol === "openai-chat") {
      const tool = { index: 0, id: "call_read", type: "function", function: { name: "read_files", arguments: JSON.stringify({ paths: [proofPath] }) } };
      const first = { id: "chat-fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [tool] }, finish_reason: null }] };
      const done = { id: "chat-fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] };
      return response(`data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`);
    }
    if (protocol === "openai-responses") {
      const args = JSON.stringify({ paths: [proofPath] });
      const responseValue = { id: "response-fixture", object: "response", status: "in_progress", model: body.model, output: [] };
      const item = { id: "fc_read", type: "function_call", call_id: "call_read", name: "read_files", arguments: args, status: "completed" };
      return response([
        sse("response.created", { type: "response.created", response: responseValue }),
        sse("response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } }),
        sse("response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: args }),
        sse("response.function_call_arguments.done", { type: "response.function_call_arguments.done", item_id: item.id, output_index: 0, arguments: args }),
        sse("response.output_item.done", { type: "response.output_item.done", output_index: 0, item }),
        sse("response.completed", { type: "response.completed", response: { ...responseValue, status: "completed", output: [item] } }),
      ].join(""));
    }
    const message = { id: "message-fixture", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
    return response([
      sse("message_start", { type: "message_start", message }),
      sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_read", name: "read_files", input: {} } }),
      sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ paths: [proofPath] }) } }),
      sse("content_block_stop", { type: "content_block_stop", index: 0 }),
      sse("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } }),
      sse("message_stop", { type: "message_stop" }),
    ].join(""));
  }
  if (turn === 2) await rm(proofPath, { force: true });
  const proof = toolResult ? "CLINE_TOOL_AND_HISTORY_PROOF" : "CLINE_TOOL_RESULT_MISSING";
  if (protocol === "openai-chat") {
    const chunk = { id: "chat-fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: proof }, finish_reason: "stop" }] };
    return response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  }
  if (protocol === "openai-responses") {
    const rv = { id: "response-fixture", object: "response", status: "in_progress", model: body.model, output: [] };
    const item = { id: "msg-fixture", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text: proof, annotations: [] }] };
    return response([sse("response.created", { type: "response.created", response: rv }), sse("response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } }), sse("response.content_part.added", { type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }), sse("response.output_text.delta", { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: proof }), sse("response.output_text.done", { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text: proof }), sse("response.content_part.done", { type: "response.content_part.done", item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }), sse("response.output_item.done", { type: "response.output_item.done", output_index: 0, item }), sse("response.completed", { type: "response.completed", response: { ...rv, status: "completed", output: [item] } })].join(""));
  }
  const message = { id: "message-fixture", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
  return response([sse("message_start", { type: "message_start", message }), sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }), sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: proof } }), sse("content_block_stop", { type: "content_block_stop", index: 0 }), sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }), sse("message_stop", { type: "message_stop" })].join(""));
} });

const switcherCli = join(import.meta.dir, "../src/cli.ts");
const fixtureKey = "fixture-cline-key";
function testEnv(home: string): Record<string, string> {
  const env: Record<string, string> = {...process.env as Record<string, string>, PATH: "/Users/hasna/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin", HOME: home, HASNA_SWITCHER_HOME: join(home, "switcher"), SWITCHER_PROVIDER_FIXTURE: fixtureKey};
  for (const key of ["CLINE_API_KEY", "CLINE_PROVIDER", "CLINE_MODEL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY"]) delete env[key];
  return env;
}
function scrub(value: string): string { return value.replaceAll(fixtureKey, "[fixture-key-redacted]").slice(-1200); }
async function command(args: string[], home: string) {
  const child = Bun.spawn([process.execPath, switcherCli, ...args], { cwd: process.cwd(), env: testEnv(home), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code: await child.exited, stdout, stderr };
}

type Rpc = { id?: string | number; method?: string; params?: any; result?: any; error?: any };
async function runAcpLaunch(args: string[], home: string, sessionId?: string) {
  const child = Bun.spawn([process.execPath, switcherCli, ...args], { cwd: process.cwd(), env: testEnv(home), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const updates: any[] = [];
  const permissions: string[] = [];
  const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
  const next = async (): Promise<Rpc> => {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd >= 0) {
        const line = buffer.slice(0, lineEnd).trim();
        buffer = buffer.slice(lineEnd + 1);
        if (!line) continue;
        return JSON.parse(line) as Rpc;
      }
      if (Date.now() > deadline) throw new Error("Timed out waiting for Cline ACP response.");
      const read = await reader.read();
      if (read.done) throw new Error("Cline ACP closed before completing the request.");
      buffer += decoder.decode(read.value, { stream: true });
    }
  };
  const request = async (id: number, method: string, params: unknown) => {
    send({ jsonrpc: "2.0", id, method, params });
    for (;;) {
      const message = await next();
      if (message.method === "session/update") { updates.push(message.params?.update); continue; }
      if (message.method === "session/request_permission") {
        const title = String(message.params?.toolCall?.title ?? "");
        permissions.push(title);
        const readOnly = /read_files\b/.test(title);
        send({ jsonrpc: "2.0", id: message.id, result: { outcome: { outcome: "selected", optionId: readOnly ? "allow_once" : "reject_once" } } });
        continue;
      }
      if (message.id === id) {
        if (message.error) throw new Error(`Cline ACP ${method} failed: ${JSON.stringify(message.error)}`);
        return message.result;
      }
    }
  };
  try {
    await request(1, "initialize", { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: "switcher-cline-fixture", version: "1" } });
    let loaded: any;
    if (sessionId) loaded = await request(2, "session/load", { sessionId, cwd: project, mcpServers: [] });
    else loaded = await request(2, "session/new", { cwd: project, mcpServers: [] });
    const actualSessionId = sessionId ?? loaded.sessionId;
    if (!actualSessionId) throw new Error("Cline ACP did not return a session ID.");
    const prompt = await request(3, "session/prompt", { sessionId: actualSessionId, prompt: [{ type: "text", text: sessionId ? "Report the existing proof from your restored history; do not read files again." : "Read proof.txt with the read_files tool." }] });
    child.stdin.end();
    const stderr = await new Response(child.stderr).text();
    const code = await child.exited;
    return { code, sessionId: actualSessionId, loadedModels: (loaded.models?.availableModels ?? []).map((model: any) => model.modelId), prompt, permissions, updates, stderr: scrub(stderr) };
  } finally {
    try { child.stdin.end(); } catch {}
  }
}

const cases: Array<{ protocol: Protocol; authStyle: "bearer" | "x-api-key"; path: string; model: string }> = [
  { protocol: "openai-chat", authStyle: "bearer", path: "/v1/chat/completions", model: "vendor/selected" },
  { protocol: "openai-responses", authStyle: "bearer", path: "/v1/responses", model: "vendor/selected" },
  { protocol: "anthropic-messages", authStyle: "x-api-key", path: "/v1/messages", model: "vendor/selected" },
];
const results: Array<Record<string, unknown>> = [];
const reportPath = join(scratch, `cline-native-${new Date().toISOString().replaceAll(":", "-")}.json`);
try {
  for (const c of cases) {
    const providerId = `fixture-cline-${c.protocol}`;
    const home = join(root, c.protocol);
    await mkdir(home, { recursive: true });
    await writeFile(proofPath, "CLINE_FILE_PROOF");
    const catalogCallsBefore = catalogCalls.length;
    const add = await command(["providers", "add", providerId, "--url", `${server.url.origin}/v1`, "--protocol", c.protocol, "--auth-style", c.authStyle, "--credential-env", "SWITCHER_PROVIDER_FIXTURE"], home);
    if (add.code !== 0) throw new Error(`providers add failed for ${c.protocol}: ${scrub(add.stderr)}`);
    const modelsRun = await command(["models", providerId, "--refresh"], home);
    if (modelsRun.code !== 0) throw new Error(`models refresh failed for ${c.protocol}: ${scrub(modelsRun.stderr)}`);
    const catalog = JSON.parse(modelsRun.stdout);
    const state = join(home, "state");
    const launchArgs = ["launch", "cline", "--provider", providerId, "--model", c.model, "--executable", executable, "--cwd", project, "--state-dir", state, "--timeout", "45", "--", "--acp"];
    const first = await runAcpLaunch(launchArgs, home);
    if (first.code !== 0) throw new Error(`first Cline ACP launch failed for ${c.protocol}: ${first.code} ${first.stderr}`);
    if (await Bun.file(proofPath).exists()) throw new Error(`first Cline ACP launch did not delete proof for ${c.protocol}`);
    const second = await runAcpLaunch(launchArgs, home, first.sessionId);
    const protocolCalls = calls.filter(call => call.protocol === c.protocol);
    const protocolCatalog = (catalog.data ?? []).map((model: any) => model.id);
    results.push({ protocol: c.protocol, firstCode: first.code, secondCode: second.code, sessionId: first.sessionId, selectedModel: protocolCalls.every(call => call.model === c.model), path: protocolCalls.every(call => call.path === c.path), fullCatalog: protocolCatalog.length === 2 && protocolCatalog.includes(c.model) && protocolCatalog.includes("vendor/other") && first.loadedModels.length === 2, firstToolPermission: first.permissions.length === 1 && /read_files\b/.test(first.permissions[0]), noSecondToolPermission: second.permissions.length === 0, toolResultRoundTrip: protocolCalls.some(call => call.turn === 2 && call.toolResult), restoredProof: second.updates.some(update => JSON.stringify(update).includes("CLINE_TOOL_AND_HISTORY_PROOF")), marker: protocolCalls.every(call => call.marker), deletedFile: !(await Bun.file(proofPath).exists()), catalogRequests: catalogCalls.length - catalogCallsBefore, stdout: scrub(add.stdout), stderr: `${first.stderr} ${second.stderr}` });
  }
  const keyFiles = (await readdir(root, { recursive: true })).filter(path => /(?:^|[/\\])(key|token|secret)(?:$|[/\\])/i.test(String(path)));
  const inferenceByProtocol = cases.map(c => calls.filter(call => call.protocol === c.protocol));
  const passed = results.length === cases.length && results.every(result => result.firstCode === 0 && result.secondCode === 0 && result.selectedModel && result.path && result.fullCatalog && result.firstToolPermission && result.noSecondToolPermission && result.toolResultRoundTrip && result.restoredProof && result.marker && result.deletedFile && Number(result.catalogRequests) >= 1) && inferenceByProtocol.every(rows => rows.length >= 3 && rows[0].turn === 1 && rows[1].turn === 2 && rows[2].turn >= 3 && rows[0].authorization === (rows[0].protocol !== "anthropic-messages") && rows[0].apiKey === (rows[0].protocol === "anthropic-messages")) && keyFiles.length === 0;
  const report = { generatedAt: new Date().toISOString(), executable, sourceCli: switcherCli, nativeContract: "Cline 3.0.61 ACP session/new + session/load", passed, results, calls: calls.map(call => ({ ...call })), catalogCalls, keyFiles };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await server.stop(true);
  await rm(root, { recursive: true, force: true });
}
