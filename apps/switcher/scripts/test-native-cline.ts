import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareClineLaunch } from "../src/cline-backend";

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
await writeFile(proofPath, "CLINE_FILE_PROOF");

type Protocol = "openai-chat" | "openai-responses" | "anthropic-messages";
type Call = { protocol: Protocol; path: string; model?: string; authorization: boolean; apiKey: boolean; marker: boolean; tool: boolean; historyHasProof: boolean };
const calls: Call[] = [];
const turns = new Map<Protocol, number>();
const deletedProofProtocols = new Set<Protocol>();
const sse = (type: string, value: unknown) => `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
const response = (body: unknown) => new Response(body as BodyInit, { headers: { "content-type": "text/event-stream" } });

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  const protocol: Protocol = path.endsWith("/messages") ? "anthropic-messages" : path.endsWith("/responses") ? "openai-responses" : "openai-chat";
  if (request.method !== "POST" || !["/v1/messages", "/v1/responses", "/v1/chat/completions"].includes(path)) return new Response("Not found", { status: 404 });
  const body = await request.json() as any;
  const text = JSON.stringify(body);
  const turn = (turns.get(protocol) ?? 0) + 1;
  turns.set(protocol, turn);
  const record: Call = {
    protocol, path, model: body.model, authorization: request.headers.get("authorization") === "Bearer fixture-cline-key",
    apiKey: request.headers.get("x-api-key") === "fixture-cline-key", marker: text.includes("CLINE_NATIVE_RULE"),
    tool: text.includes("read_files"), historyHasProof: text.includes("CLINE_FILE_PROOF"),
  };
  calls.push(record);
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
  await rm(proofPath, { force: true });
  deletedProofProtocols.add(protocol);
  const proof = record.historyHasProof ? "CLINE_TOOL_AND_HISTORY_PROOF" : "CLINE_TOOL_RESULT_MISSING";
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

function quote(value: string) { return JSON.stringify(value); }
async function runWithScopedReadApproval(command: string[], env: Record<string, string>) {
  const script = join(root, `approve-${Math.random().toString(36).slice(2)}.exp`);
  await writeFile(script, `set timeout 30\nlog_user 1\nset command [list ${command.map(quote).join(" ")}]\nspawn {*}$command\nexpect {\n  -re {read_files} { send "y\\r"; exp_continue }\n  eof { set result [wait]; exit [lindex $result 3] }\n  timeout { exit 124 }\n}\n`);
  const child = Bun.spawn(["/usr/bin/expect", script], { cwd: project, env: { ...process.env, ...env, HOME: root }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
  await rm(script, { force: true });
  return { code: await child.exited, stdout, stderr };
}

const cases: Array<{ protocol: Protocol; authStyle: "bearer" | "x-api-key"; path: string; model: string }> = [
  { protocol: "openai-chat", authStyle: "bearer", path: "/v1/chat/completions", model: "vendor/chat" },
  { protocol: "openai-responses", authStyle: "bearer", path: "/v1/responses", model: "vendor/responses" },
  { protocol: "anthropic-messages", authStyle: "x-api-key", path: "/v1/messages", model: "vendor/messages" },
];
const results: Array<Record<string, unknown>> = [];
try {
  for (const c of cases) {
    await writeFile(proofPath, "CLINE_FILE_PROOF");
    const state = join(root, c.protocol);
    const prepared = await prepareClineLaunch({ harness: "cline", baseUrl: `${server.url.origin}/v1`, protocol: c.protocol, authStyle: c.authStyle, model: c.model, models: [
      { id: c.model, name: "Selected", contextWindow: 32_000, maxOutputTokens: 512, supportedParameters: ["tools"], outputModalities: ["text"] },
      { id: "vendor/other", name: "Other", contextWindow: 32_000, maxOutputTokens: 512, supportedParameters: ["tools"], outputModalities: ["text"] },
    ], credential: "fixture-cline-key", executable, stateDir: state, cwd: project, version: "cline 3.0.61", sessionDir: join(state, "session") });
    const providers = JSON.parse(await readFile(prepared.configPaths[0], "utf8"));
    const models = JSON.parse(await readFile(prepared.configPaths[1], "utf8"));
    const providerId = c.protocol === "anthropic-messages" ? "anthropic" : c.protocol === "openai-responses" ? "openai-native" : "openai-compatible";
    const run = await runWithScopedReadApproval([prepared.executable, ...prepared.args, "Read proof.txt with the read_files tool."], prepared.env);
    results.push({ protocol: c.protocol, code: run.code, proof: run.stdout.includes("CLINE_TOOL_AND_HISTORY_PROOF"), deletedFile: deletedProofProtocols.has(c.protocol), selectedModel: models.providers[providerId].models[c.model] !== undefined, fullCatalog: Object.keys(models.providers[providerId].models).length === 2, providerId, providerPath: prepared.configPaths[0], stdout: run.stdout.slice(-300), stderr: run.stderr.slice(-500) });
    await prepared.cleanup?.();
  }
  const keyFiles = (await readdir(root, { recursive: true })).filter(path => /(?:^|[/\\])(key|token|secret)(?:$|[/\\])/i.test(String(path)));
  const passed = results.length === cases.length && results.every(result => result.code === 0 && result.proof && result.deletedFile && result.selectedModel && result.fullCatalog) && calls.every(call => call.marker && call.model?.startsWith("vendor/") && (call.protocol === "anthropic-messages" ? call.apiKey && !call.authorization : call.authorization && !call.apiKey)) && keyFiles.length === 0;
  console.log(JSON.stringify({ executable, passed, results, calls: calls.map(call => ({ ...call, model: call.model })), keyFiles }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await server.stop(true);
  await rm(root, { recursive: true, force: true });
}
