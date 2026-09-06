import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// This is a local, synthetic acceptance fixture for legacy OpenCode 1.18.29.
// It intentionally runs the Switcher source CLI as a fresh process for each
// operation; the native process is also fresh for the resume operation.
const executable = process.env.SWITCHER_TEST_NATIVE_EXECUTABLE;
if (!executable) throw new Error("Set SWITCHER_TEST_NATIVE_EXECUTABLE to OpenCode 1.18.29.");
const protocols = ["openai-chat", "openai-responses", "anthropic-messages"] as const;
type Protocol = (typeof protocols)[number];
const protocol = (process.argv[2] ?? "all") as Protocol | "all";
if (protocol !== "all" && !protocols.includes(protocol)) throw new Error("Choose all, openai-chat, openai-responses, or anthropic-messages.");
const selected = protocol === "all" ? protocols : [protocol];
const scratch = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace/scratch/universal-harness-switcher/live/opencode-legacy-cli");
await mkdir(scratch, { recursive: true, mode: 0o700 });
const runRoot = await mkdtemp(join(scratch, "run-"));
const sourceCli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const syntheticCredential = `legacy-fixture-${crypto.randomUUID()}`;
const model = "vendor/fixture";
const secondModel = "vendor/second";
const readMarker = `LEGACY_READ_${crypto.randomUUID()}`;
const agentMarker = `LEGACY_AGENTS_${crypto.randomUUID()}`;
const toolProof = `LEGACY_TOOL_LOOP_${crypto.randomUUID()}`;
const resumeProof = `LEGACY_RESUME_DELETED_${crypto.randomUUID()}`;

const scrub = (value: string) => value.replaceAll(syntheticCredential, "[fixture-key-redacted]");
const sse = (event: Record<string, unknown>, name?: string) => `${name ? `event: ${name}\n` : ""}data: ${JSON.stringify(event)}\n\n`;
const response = (body: string) => new Response(body, { headers: { "content-type": "text/event-stream" } });

type Call = {
  phase: number;
  path: string;
  model: string;
  auth: boolean;
  hasReadTool: boolean;
  hasToolResult: boolean;
  hasAssistantHistory: boolean;
  hasAgentMarker: boolean;
};

async function runCase(caseProtocol: Protocol) {
  const root = await mkdtemp(join(runRoot, `${caseProtocol}-`));
  const home = join(root, "home");
  const switcherHome = join(home, "switcher");
  const stateDir = join(switcherHome, "state");
  const project = join(root, "project");
  await mkdir(project, { recursive: true, mode: 0o700 });
  await writeFile(join(project, "fixture-read.txt"), `${readMarker}\n`, { mode: 0o600 });
  await writeFile(join(project, "AGENTS.md"), `Project instructions: ${agentMarker}.\n`, { mode: 0o600 });
  // This narrowly allows the synthetic read tool. The adapter copies this
  // policy into its private config while suppressing project provider config.
  await writeFile(join(project, "opencode.json"), JSON.stringify({ permission: { read: "allow" } }) + "\n", { mode: 0o600 });

  let phase = 0;
  const calls: Call[] = [];
  const catalogCalls: Array<{ path: string; auth: boolean }> = [];
  const rejectedPaths: string[] = [];
  const expectedPath = caseProtocol === "openai-chat" ? "/v1/chat/completions" : caseProtocol === "openai-responses" ? "/v1/responses" : "/v1/messages";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const auth = request.headers.get("authorization") === `Bearer ${syntheticCredential}` && !request.headers.has("x-api-key");
      if (request.method === "GET" && url.pathname === "/v1/models") {
        if (!auth) return new Response("unauthorized", { status: 401 });
        catalogCalls.push({ path: url.pathname, auth });
        return Response.json({ data: [
          { id: model, name: "Nested Fixture", context_length: 32000, max_output_tokens: 1024, supported_parameters: ["tools"] },
          { id: secondModel, name: "Nested Second", context_length: 32000, max_output_tokens: 1024, supported_parameters: ["tools"] },
        ] });
      }
      if (request.method !== "POST" || url.pathname !== expectedPath) {
        rejectedPaths.push(`${request.method} ${url.pathname}`);
        return new Response("wrong fixture route", { status: 404 });
      }
      if (!auth) return new Response("unauthorized", { status: 401 });
      const body = await request.json() as any;
      const messages = body.messages ?? body.input ?? [];
      const serialized = JSON.stringify(body);
      const hasReadTool = Array.isArray(body.tools) && body.tools.some((tool: any) => JSON.stringify(tool).includes('"read"'));
      const hasToolResult = /LEGACY_READ_|tool_result|function_call_output|"role":"tool"/.test(serialized) &&
        (messages.some((message: any) => message.role === "tool" || message.type === "function_call_output") || serialized.includes(readMarker));
      const hasAssistantHistory = messages.some((message: any) => message.role === "assistant" && serialized.includes(toolProof));
      const hasAgentMarker = serialized.includes(agentMarker);
      calls.push({ phase, path: url.pathname, model: body.model ?? "", auth, hasReadTool, hasToolResult, hasAssistantHistory, hasAgentMarker });
      const answer = phase === 1 && hasAssistantHistory ? resumeProof : toolProof;
      const shouldCallTool = phase === 0 && hasReadTool && !hasToolResult;
      const filePath = join(project, "fixture-read.txt");
      if (caseProtocol === "openai-chat") {
        const delta = shouldCallTool
          ? { role: "assistant", tool_calls: [{ index: 0, id: "call_read_fixture", type: "function", function: { name: "read", arguments: JSON.stringify({ filePath }) } }] }
          : { role: "assistant", content: answer };
        return response(sse({ id: "chat_fixture", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] }) +
          sse({ id: "chat_fixture", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: shouldCallTool ? "tool_calls" : "stop" }] }) + "data: [DONE]\n\n");
      }
      if (caseProtocol === "anthropic-messages") {
        const events = shouldCallTool
          ? [
            { type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", content: [], model: body.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
            { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_read_fixture", name: "read", input: {} } },
            { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ filePath }) } },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } },
            { type: "message_stop" },
          ]
          : [
            { type: "message_start", message: { id: "msg_fixture_done", type: "message", role: "assistant", content: [], model: body.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: answer } },
            { type: "content_block_stop", index: 0 },
            { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
            { type: "message_stop" },
          ];
        return response(events.map(event => sse(event, String(event.type))).join(""));
      }
      const item = shouldCallTool
        ? { id: "call_read_fixture", type: "function_call", call_id: "call_read_fixture", name: "read", arguments: JSON.stringify({ filePath }), status: "completed" }
        : { id: "msg_fixture", type: "message", role: "assistant", content: [{ type: "output_text", text: answer, annotations: [] }], status: "completed" };
      const responseValue = { id: "resp_fixture", object: "response", created_at: 1, model: body.model, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
      const events = [
        { type: "response.created", response: { ...responseValue, status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: shouldCallTool ? { ...item, arguments: "", status: "in_progress" } : { ...item, content: [], status: "in_progress" } },
        ...(shouldCallTool
          ? [{ type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: item.arguments }, { type: "response.function_call_arguments.done", item_id: item.id, output_index: 0, arguments: item.arguments }]
          : [{ type: "response.content_part.added", item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } }, { type: "response.output_text.delta", item_id: item.id, output_index: 0, content_index: 0, delta: answer }, { type: "response.output_text.done", item_id: item.id, output_index: 0, content_index: 0, text: answer }]),
        { type: "response.output_item.done", output_index: 0, item },
        { type: "response.completed", response: responseValue },
      ];
      return response(events.map(event => sse(event, event.type)).join(""));
    },
  });

  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/Users/hasna/.bun/bin:/usr/bin:/bin",
    HOME: home,
    USER: process.env.USER ?? "fixture-user",
    HASNA_SWITCHER_HOME: switcherHome,
    SWITCHER_PROVIDER_FIXTURE: syntheticCredential,
  };
  const children: ReturnType<typeof Bun.spawn>[] = [];
  const results: Array<{ label: string; code: number; stdout: string; stderr: string }> = [];
  const invoke = async (args: string[], label: string) => {
    const child = Bun.spawn([process.execPath, sourceCli, ...args], { cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
    children.push(child);
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 45_000);
    try {
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      const result = { label, code, stdout: scrub(stdout), stderr: scrub(stderr) };
      results.push(result);
      await writeFile(join(root, `${label}.stdout`), result.stdout, { mode: 0o600 });
      await writeFile(join(root, `${label}.stderr`), result.stderr, { mode: 0o600 });
      return result;
    } finally { clearTimeout(timer); }
  };

  try {
    const base = ["--provider", "fixture", "--model", model, "--executable", executable, "--cwd", project, "--state-dir", stateDir, "--timeout", "45"];
    const add = await invoke(["providers", "add", "fixture", "--name", "Fixture", "--url", `${server.url.origin}/v1`, "--protocol", caseProtocol,
      "--credential-env", "SWITCHER_PROVIDER_FIXTURE", "--auth-style", "bearer"], "provider-add");
    assert.equal(add.code, 0, `${caseProtocol}: provider add failed`);
    const models = await invoke(["models", "fixture", "--refresh"], "models");
    assert.equal(models.code, 0, `${caseProtocol}: model refresh failed`);
    assert(models.stdout.includes(model) && models.stdout.includes(secondModel), `${caseProtocol}: full catalog missing`);
    const first = await invoke(["launch", "opencode", ...base, "--", "run", "--format", "json", "Read fixture-read.txt with the read tool and report its marker."], "first");
    assert.equal(first.code, 0, `${caseProtocol}: first source CLI launch failed: ${first.stderr}`);
    assert(first.stdout.includes(toolProof), `${caseProtocol}: first response lacks tool proof`);
    const profiles = await invoke(["profiles", "list"], "profiles");
    assert.equal(profiles.code, 0);
    const profileId = (JSON.parse(profiles.stdout).data ?? [])[0]?.id;
    assert(profileId, `${caseProtocol}: source CLI did not persist profile`);
    await rm(join(project, "fixture-read.txt"));
    phase = 1;
    const resume = await invoke(["launch", profileId, "--executable", executable, "--cwd", project, "--state-dir", stateDir, "--timeout", "45", "--",
      "run", "--format", "json", "--continue", "Recall the previous tool proof after the file was deleted."], "resume");
    assert.equal(resume.code, 0, `${caseProtocol}: resume source CLI launch failed: ${resume.stderr}`);
    assert(resume.stdout.includes(resumeProof), `${caseProtocol}: deleted-file resume lacks persisted proof`);
    const durable = join(stateDir, "sessions", "opencode", profileId, "data", "opencode", "opencode.db");
    const durableExists = await Bun.file(durable).exists();
    assert(durableExists, `${caseProtocol}: durable legacy session database missing`);
    const keyHits: string[] = [];
    for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      try { if ((await readFile(path)).includes(Buffer.from(syntheticCredential))) keyHits.push(path); } catch { /* SQLite/binary files are irrelevant to text credential leakage. */ }
    }
    assert.equal(keyHits.length, 0, `${caseProtocol}: credential was persisted to fixture files`);
    assert(calls.length > 0 && calls.every(call => call.path === expectedPath && call.model === model && call.auth), `${caseProtocol}: route/model/auth authority mismatch`);
    assert(calls.some(call => call.phase === 0 && call.hasReadTool && !call.hasToolResult), `${caseProtocol}: native did not request read tool`);
    assert(calls.some(call => call.phase === 0 && call.hasToolResult), `${caseProtocol}: native tool result was not returned`);
    assert(calls.some(call => call.phase === 1 && call.hasAssistantHistory), `${caseProtocol}: upstream did not receive persisted assistant history`);
    assert(calls.filter(call => call.phase === 1).length === 1 && calls.filter(call => call.phase === 1).every(call => call.hasAssistantHistory), `${caseProtocol}: resume made an unexpected fresh/read request`);
    assert(calls.filter(call => call.hasReadTool).every(call => call.hasAgentMarker), `${caseProtocol}: AGENTS marker absent from native request`);
    const stateEntries = await readdir(stateDir, { withFileTypes: true });
    assert(stateEntries.every(entry => entry.name === "sessions"), `${caseProtocol}: temporary launch state was not cleaned`);
    const report = { caseProtocol, version: "1.18.29", executable, sourceCli, root, profileId, durableExists, catalogCalls, calls, rejectedPaths, results: results.map(({ label, code, stderr }) => ({ label, code, stderr })), passed: true };
    await writeFile(join(root, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    return report;
  } catch (error) {
    const report = { caseProtocol, version: "1.18.29", executable, sourceCli, root, catalogCalls, calls, rejectedPaths, results: results.map(({ label, code, stderr }) => ({ label, code, stderr })), error: String(error), passed: false };
    await writeFile(join(root, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
    throw error;
  } finally {
    for (const child of children) if (child.exitCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch {} await child.exited; }
    server.stop(true);
  }
}

const reports: unknown[] = [];
try {
  for (const item of selected) reports.push(await runCase(item));
  console.log(JSON.stringify({ version: "1.18.29", executable, protocols: selected, reports }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: String(error), reports }, null, 2));
  process.exitCode = 1;
}
