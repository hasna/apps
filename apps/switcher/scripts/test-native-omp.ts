import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const executable = process.env.SWITCHER_TEST_OMP_EXECUTABLE;
if (!executable) throw new Error("Set SWITCHER_TEST_OMP_EXECUTABLE to the installed OMP executable.");
const cli = join(import.meta.dir, "../src/cli.ts");
const scratch = process.env.SWITCHER_TEST_ROOT ?? join(process.cwd(), "../../scratch/native-omp");
await mkdir(scratch, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(scratch, "run-"));
const project = join(root, "project");
const home = join(root, "home");
const switcherHome = join(root, "switcher");
await mkdir(project, { recursive: true, mode: 0o700 });
await writeFile(join(project, "AGENTS.md"), "OMP_CLI_NATIVE_RULE: preserve this project instruction.\n", { mode: 0o600 });
await writeFile(join(project, ".gitignore"), "\n", { mode: 0o600 });
await execFileAsync("git", ["init", "-q", project]);

 type Protocol = "openai-chat" | "openai-responses" | "anthropic-messages";
 type AuthStyle = "bearer" | "x-api-key" | "none";
 type Case = { protocol: Protocol; authStyle: AuthStyle; model: string; path: string; providerId: string };
 type Call = { protocol: Protocol; path: string; model?: string; bearer: boolean; apiKey: boolean; marker: boolean; tool: boolean; toolResult: boolean; historyProof: boolean };
 const cases: Case[] = [
   { protocol: "openai-chat", authStyle: "bearer", model: "vendor/chat", path: "/v1/chat/completions", providerId: "fixture-chat-bearer" },
   { protocol: "openai-chat", authStyle: "none", model: "vendor/chat-none", path: "/v1/chat/completions", providerId: "fixture-chat-none" },
   { protocol: "openai-responses", authStyle: "bearer", model: "vendor/responses", path: "/v1/responses", providerId: "fixture-responses-bearer" },
   { protocol: "openai-responses", authStyle: "none", model: "vendor/responses-none", path: "/v1/responses", providerId: "fixture-responses-none" },
   { protocol: "anthropic-messages", authStyle: "x-api-key", model: "vendor/messages", path: "/v1/messages", providerId: "fixture-messages-key" },
   { protocol: "anthropic-messages", authStyle: "none", model: "vendor/messages-none", path: "/v1/messages", providerId: "fixture-messages-none" },
 ];
 const key = "fixture-omp-key";
 const proof = "OMP_READ_FILE_PROOF";
 const calls: Call[] = [];
 let current: (Case & { phase: 0 | 1; turn: number; proofPath: string }) | undefined;

 const sse = (type: string, value: unknown) => `event: ${type}\ndata: ${JSON.stringify(value)}\n\n`;
 const stream = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } });
 const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
   const path = new URL(request.url).pathname;
   if (!current) return new Response("No active case", { status: 500 });
   if (request.method === "GET" && path === "/v1/models") {
     return Response.json({ object: "list", data: [
       { id: current.model, name: "Selected", context_length: 64_000, max_output_tokens: 8_000 },
       { id: `${current.model}-other`, name: "Other", context_length: 32_000, max_output_tokens: 4_000 },
     ] });
   }
   if (request.method !== "POST" || path !== current.path) return new Response("Wrong provider route", { status: 404 });
   const body = await request.json() as any;
   current.turn++;
   const serialized = JSON.stringify(body);
   // A request advertises tools on every turn; only the first request of the
   // initial launch is the fixture's actual tool-call turn. The resumed launch
   // must use persisted history and must not trigger another read.
   const tool = current.phase === 0 && current.turn === 1;
   const toolResult = serialized.includes(proof) && (serialized.includes('"role":"tool"') || serialized.includes("function_call_output") || serialized.includes("tool_result"));
   const historyProof = serialized.includes(proof);
   const bearer = request.headers.get("authorization") === `Bearer ${key}`;
   const apiKey = request.headers.get("x-api-key") === key;
   calls.push({ protocol: current.protocol, path, model: body.model, bearer, apiKey, marker: serialized.includes("OMP_CLI_NATIVE_RULE"), tool, toolResult, historyProof });
   const authOk = current.authStyle === "bearer" ? bearer && !apiKey : current.authStyle === "x-api-key" ? apiKey && !bearer : !bearer && !apiKey;
   if (!authOk || !serialized.includes("OMP_CLI_NATIVE_RULE")) return new Response("Unauthorized or missing project instructions", { status: 401 });
   if (current.phase === 0 && current.turn === 1) {
     if (current.protocol === "openai-chat") {
       const call = { index: 0, id: "call_read", type: "function", function: { name: "read", arguments: JSON.stringify({ path: current.proofPath }) } };
       const chunk = (delta: unknown, finish_reason: unknown) => `data: ${JSON.stringify({ id: "chat-fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
       return stream(chunk({ role: "assistant", tool_calls: [call] }, null) + chunk({}, "tool_calls") + "data: [DONE]\n\n");
     }
     if (current.protocol === "openai-responses") {
       const args = JSON.stringify({ path: current.proofPath });
       const response = { id: "response-fixture", object: "response", status: "in_progress", model: body.model, output: [] };
       const item = { id: "fc_read", type: "function_call", call_id: "call_read", name: "read", arguments: args, status: "completed" };
       return stream([sse("response.created", { type: "response.created", response }), sse("response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } }), sse("response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: args }), sse("response.function_call_arguments.done", { type: "response.function_call_arguments.done", item_id: item.id, output_index: 0, arguments: args }), sse("response.output_item.done", { type: "response.output_item.done", output_index: 0, item }), sse("response.completed", { type: "response.completed", response: { ...response, status: "completed", output: [item] } })].join(""));
     }
     const message = { id: "message-fixture", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } };
     return stream([sse("message_start", { type: "message_start", message }), sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_read", name: "read", input: {} } }), sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ path: current.proofPath }) } }), sse("content_block_stop", { type: "content_block_stop", index: 0 }), sse("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } }), sse("message_stop", { type: "message_stop" })].join(""));
   }
   if (current.phase === 0 && current.turn === 2) {
     await rm(current.proofPath, { force: true });
     const text = toolResult ? "OMP_TOOL_LOOP_PROOF" : "OMP_TOOL_RESULT_MISSING";
     if (current.protocol === "openai-chat") {
       const chunk = (delta: unknown, finish_reason: unknown) => `data: ${JSON.stringify({ id: "chat-fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
       return stream(chunk({ role: "assistant", content: text }, "stop") + "data: [DONE]\n\n");
     }
     if (current.protocol === "openai-responses") {
       const response = { id: "response-fixture", object: "response", status: "in_progress", model: body.model, output: [] };
       const item = { id: "message-fixture", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] };
       return stream([sse("response.created", { type: "response.created", response }), sse("response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } }), sse("response.content_part.added", { type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }), sse("response.output_text.delta", { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: text }), sse("response.output_text.done", { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text }), sse("response.content_part.done", { type: "response.content_part.done", item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }), sse("response.output_item.done", { type: "response.output_item.done", output_index: 0, item }), sse("response.completed", { type: "response.completed", response: { ...response, status: "completed", output: [item] } })].join(""));
     }
     const message = { id: "message-fixture", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
     return stream([sse("message_start", { type: "message_start", message }), sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }), sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }), sse("content_block_stop", { type: "content_block_stop", index: 0 }), sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }), sse("message_stop", { type: "message_stop" })].join(""));
   }
   const text = current.phase === 1 && historyProof ? "OMP_RESUME_DELETED_PROOF" : "OMP_RESUME_HISTORY_MISSING";
   if (current.protocol === "openai-chat") {
     const chunk = `data: ${JSON.stringify({ id: "chat-fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`;
     return stream(chunk);
   }
   if (current.protocol === "openai-responses") {
     const response = { id: "response-fixture", object: "response", status: "in_progress", model: body.model, output: [] };
     const item = { id: "message-fixture", type: "message", status: "completed", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] };
     return stream([sse("response.created", { type: "response.created", response }), sse("response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { ...item, status: "in_progress", content: [] } }), sse("response.content_part.added", { type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }), sse("response.output_text.delta", { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: text }), sse("response.output_text.done", { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text }), sse("response.content_part.done", { type: "response.content_part.done", item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }), sse("response.output_item.done", { type: "response.output_item.done", output_index: 0, item }), sse("response.completed", { type: "response.completed", response: { ...response, status: "completed", output: [item] } })].join(""));
   }
   const message = { id: "message-fixture", type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
   return stream([sse("message_start", { type: "message_start", message }), sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }), sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }), sse("content_block_stop", { type: "content_block_stop", index: 0 }), sse("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }), sse("message_stop", { type: "message_stop" })].join(""));
 } });

 const envBase = { PATH: "/Users/hasna/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin", HOME: home, HASNA_SWITCHER_HOME: switcherHome, SWITCHER_PROVIDER_FIXTURE: key };
 async function runCli(args: string[], extra: Record<string, string> = {}) {
   const child = Bun.spawn([process.execPath, cli, ...args], { cwd: project, env: { ...process.env, ...envBase, ...extra }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
   const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
   return { code: await child.exited, stdout, stderr };
 }
 const results: Array<Record<string, unknown>> = [];
 try {
   for (const c of cases) {
     const proofPath = join(project, "fixture-read.txt");
     await writeFile(proofPath, proof, { mode: 0o600 });
     current = { ...c, phase: 0, turn: 0, proofPath };
     const addArgs = ["providers", "add", c.providerId, "--name", c.providerId, "--url", `${server.url.origin}/v1`, "--protocol", c.protocol, "--auth-style", c.authStyle === "none" ? "bearer" : c.authStyle];
     if (c.authStyle !== "none") addArgs.push("--credential-env", "SWITCHER_PROVIDER_FIXTURE");
     const add = await runCli(addArgs);
     assert.equal(add.code, 0, `${c.protocol}/${c.authStyle} provider add failed: ${add.stderr}`);
     const listed = await runCli(["models", c.providerId, "--refresh"]);
     assert.equal(listed.code, 0, `${c.protocol}/${c.authStyle} catalog refresh failed: ${listed.stderr}`);
     assert(listed.stdout.includes(c.model) && listed.stdout.includes(`${c.model}-other`), "source CLI catalog omitted a provider model");
     const base = ["launch", "omp", "--provider", c.providerId, "--model", c.model, "--executable", executable, "--cwd", project, "--state-dir", join(root, c.providerId), "--timeout", "20", "--"];
     const first = await runCli([...base, "-p", "Read fixture-read.txt with the read tool and return its marker."]);
     assert.equal(first.code, 0, `${c.protocol}/${c.authStyle} first launch failed: ${first.stderr}`);
     assert(first.stdout.includes("OMP_TOOL_LOOP_PROOF"), `${c.protocol}/${c.authStyle} did not complete a real tool loop`);
     assert.equal(current.turn, 2, `${c.protocol}/${c.authStyle} expected tool request and tool-result request`);
     current.phase = 1; current.turn = 0;
     const sessionRoot = join(root, c.providerId, "sessions", "omp");
     const sessionFiles: string[] = [];
     async function walk(path: string) { try { for (const entry of await readdir(path, { withFileTypes: true })) { const child = join(path, entry.name); if (entry.isDirectory()) await walk(child); else if (entry.isFile() && child.endsWith(".jsonl")) sessionFiles.push(child); } } catch {} }
     await walk(sessionRoot);
     assert.equal(sessionFiles.length, 1, `${c.protocol}/${c.authStyle} expected one persisted native session`);
     const second = await runCli([...base, "--resume", sessionFiles[0], "-p", "Resume the prior proof after the file was deleted."]);
     assert.equal(second.code, 0, `${c.protocol}/${c.authStyle} resume launch failed: ${second.stderr}`);
     assert(second.stdout.includes("OMP_RESUME_DELETED_PROOF"), `${c.protocol}/${c.authStyle} did not resume deleted-file history`);
     assert.equal(current.turn, 1, `${c.protocol}/${c.authStyle} resume unexpectedly requested another read`);
     const caseCalls = calls.filter(call => call.protocol === c.protocol && call.model === c.model);
     assert(caseCalls.length >= 3 && caseCalls.filter(call => call.tool).length === 1 && caseCalls.some(call => call.toolResult) && caseCalls.some(call => call.historyProof), `${c.protocol}/${c.authStyle} call evidence incomplete`);
     assert(caseCalls.every(call => call.marker && call.path === c.path), `${c.protocol}/${c.authStyle} route or AGENTS evidence failed`);
     const authExpected = c.authStyle === "bearer" ? caseCalls.every(call => call.bearer && !call.apiKey) : c.authStyle === "x-api-key" ? caseCalls.every(call => call.apiKey && !call.bearer) : caseCalls.every(call => !call.bearer && !call.apiKey);
     assert(authExpected, `${c.protocol}/${c.authStyle} upstream auth contract failed`);
     results.push({ protocol: c.protocol, authStyle: c.authStyle, firstExit: first.code, resumeExit: second.code, toolLoop: true, deletedFile: true, persistedSession: sessionFiles.length === 1, catalogModels: [c.model, `${c.model}-other`], path: c.path });
   }
   const files: string[] = [];
   async function walkAll(path: string) { try { for (const entry of await readdir(path, { withFileTypes: true, recursive: true })) if (entry.isFile()) files.push(join(path, entry.name)); } catch {} }
   await walkAll(root);
   const keyHits: string[] = [];
   for (const path of files) { try { if ((await readFile(path, "utf8")).includes(key)) keyHits.push(path); } catch {} }
   assert.equal(keyHits.length, 0, "credential appeared in a generated file");
   console.log(JSON.stringify({ executable, cli, passed: true, results, calls: calls.map(call => ({ ...call, model: call.model })), keyHits }, null, 2));
 } finally { await server.stop(true); await rm(root, { recursive: true, force: true }); }
