import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const executable = process.env.SWITCHER_TEST_HERMES_EXECUTABLE;
if (!executable) throw new Error("Set SWITCHER_TEST_HERMES_EXECUTABLE to the installed Hermes executable. This check uses local fixtures only.");

const scratch = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace", "scratch", "switcher-native-tests");
await mkdir(scratch, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(scratch, "hermes-cli-"));
const project = join(root, "project");
const home = join(root, "home");
const switcherHome = join(home, "switcher");
const stateDir = join(switcherHome, "state");
const syntheticCredential = "fixture-hermes-upstream-key";
const protocol = process.env.SWITCHER_TEST_HERMES_PROTOCOL === "anthropic-messages" ? "anthropic-messages" : "openai-chat";
const fixtureMarker = "HERMES_READ_FILE_MARKER";
const cwdRuleMarker = "HERMES_CWD_RULE_PROOF";
const calls: Array<{
  model: string;
  path: string;
  hasTools: boolean;
  hasPriorAssistant: boolean;
  hasToolResult: boolean;
  hasCwdRule: boolean;
  credentialMatches: boolean;
}> = [];

await mkdir(project, { recursive: true, mode: 0o700 });
await writeFile(join(project, "AGENTS.md"), `Project instructions: ${cwdRuleMarker}.\n`, { mode: 0o600 });
await writeFile(join(project, "fixture-read.txt"), `${fixtureMarker}\n`, { mode: 0o600 });

const sse = (payload: Record<string, unknown>) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, ...payload }] })}\n\n`;
const messageSse = (events: Record<string, unknown>[]) => events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const expectedHeader = protocol === "anthropic-messages" ? "x-api-key" : "authorization";
    const credentialMatches = expectedHeader === "x-api-key"
      ? request.headers.get("x-api-key") === syntheticCredential
      : request.headers.get("authorization") === `Bearer ${syntheticCredential}`;
    if (!credentialMatches)
      return new Response("Unauthorized", { status: 401 });
    if (request.method === "GET" && url.pathname === "/models") {
      return Response.json({ data: [
        { id: "vendor/fixture", name: "Nested Fixture", supported_parameters: ["tools"] },
        { id: "vendor/second", name: "Nested Second", supported_parameters: ["tools"] },
      ] });
    }
    const expectedPath = protocol === "anthropic-messages" ? "/v1/messages" : "/v1/chat/completions";
    if (request.method !== "POST" || url.pathname !== expectedPath) return new Response("Not found", { status: 404 });
    const body = await request.json() as { model?: string; tools?: unknown[]; messages?: Array<{ role?: string; content?: unknown }>; system?: unknown };
    const messages = body.messages ?? [];
    const serialized = JSON.stringify(body);
    const hasPriorAssistant = messages.some(message => message.role === "assistant");
    const hasToolResult = serialized.includes(fixtureMarker) && (messages.some(message => message.role === "tool") || serialized.includes("tool_result"));
    calls.push({
      model: body.model ?? "",
      path: url.pathname,
      hasTools: Array.isArray(body.tools) && body.tools.some(tool => JSON.stringify(tool).includes("read_file")),
      hasPriorAssistant,
      hasToolResult,
      hasCwdRule: serialized.includes(cwdRuleMarker),
      credentialMatches,
    });
    if (!hasToolResult && protocol === "openai-chat") {
      return new Response(
        sse({ delta: { role: "assistant", content: "" } }) +
        sse({ delta: { tool_calls: [{ index: 0, id: "call_fixture", type: "function", function: { name: "read_file", arguments: JSON.stringify({ path: join(project, "fixture-read.txt") }) } }] } }) +
        sse({ delta: {}, finish_reason: "tool_calls" }) +
        "data: [DONE]\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    }
    if (!hasToolResult && protocol === "anthropic-messages") {
      return new Response(messageSse([
        { type: "message_start", message: { id: "msg_fixture", type: "message", role: "assistant", content: [], model: body.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "call_fixture", name: "read_file", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ path: join(project, "fixture-read.txt") }) } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 1 } },
        { type: "message_stop" },
      ]), { headers: { "content-type": "text/event-stream" } });
    }
    const proof = serialized.includes("Resume the prior proof") ? "HERMES_RESUME_DELETED_PROOF" : "HERMES_TOOL_LOOP_PROOF";
    if (protocol === "anthropic-messages") return new Response(messageSse([
      { type: "message_start", message: { id: "msg_fixture_done", type: "message", role: "assistant", content: [], model: body.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: proof } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" },
    ]), { headers: { "content-type": "text/event-stream" } });
    return new Response(sse({ delta: { role: "assistant", content: proof } }) + sse({ delta: {}, finish_reason: "stop" }) + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
  },
});

const cli = process.env.SWITCHER_TEST_SWITCHER_EXECUTABLE ?? fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const command = async (args: string[]) => {
  const child = Bun.spawn([process.execPath, cli, ...args], {
    cwd: project,
    env: {
      PATH: process.env.PATH ?? "/Users/hasna/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin",
      HOME: home,
      USER: process.env.USER ?? "fixture-user",
      HASNA_SWITCHER_HOME: switcherHome,
      SWITCHER_PROVIDER_FIXTURE: syntheticCredential,
    },
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 45_000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
};

async function credentialHits(dir: string): Promise<string[]> {
  const hits: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) hits.push(...await credentialHits(path));
    else {
      try { if ((await readFile(path)).includes(syntheticCredential)) hits.push(path); } catch { /* SQLite and transient files need no text scan. */ }
    }
  }
  return hits;
}

try {
  const common = ["--provider", `generic-${protocol}`, "--url", `${upstream.url.origin}/v1`, "--catalog-url", upstream.url.origin,
    "--auth-style", protocol === "anthropic-messages" ? "x-api-key" : "bearer",
    "--credential-env", "SWITCHER_PROVIDER_FIXTURE", "--model", "vendor/fixture", "--executable", executable,
    "--cwd", project, "--state-dir", stateDir, "--timeout", "45"];
  // The top-level -z mode enables HERMES_YOLO_MODE in the native CLI. Use the
  // documented chat oneshot path so native approval and project rules remain
  // active during this acceptance check.
  const first = await command(["launch", "hermes", ...common, "--", "chat", "-q", "Read fixture-read.txt with the read_file tool and return its marker.", "--oneshot", "--in", project]);
  const profiles = await command(["profiles", "list"]);
  const profileRows = JSON.parse(profiles.stdout) as { data?: Array<{ id: string }> };
  const profileId = profileRows.data?.[0]?.id;
  if (!profileId) throw new Error(`The CLI did not create a Hermes launch profile: first=${JSON.stringify({code:first.code,stdout:first.stdout,stderr:first.stderr})} profiles=${profiles.stdout}${profiles.stderr}`);
  await rm(join(project, "fixture-read.txt"), { force: true });
  const second = await command(["launch", profileId, "--executable", executable, "--cwd", project, "--state-dir", stateDir,
    "--timeout", "45", "--", "chat", "-q", "Resume the prior proof after the file was deleted.", "--oneshot", "--resume", "latest", "--in", project]);
  const sessionDir = join(stateDir, "sessions", "hermes", profileId);
  const sessionEntries = await readdir(sessionDir);
  const hits = await credentialHits(join(home, "switcher"));
  const passed = first.code === 0 && second.code === 0 && profiles.code === 0 &&
    first.stdout.includes("HERMES_TOOL_LOOP_PROOF") && second.stdout.includes("HERMES_RESUME_DELETED_PROOF") &&
    calls.some(call => call.hasTools && !call.hasPriorAssistant) && calls.some(call => call.hasToolResult && call.hasPriorAssistant) &&
    calls.every(call => call.model === "vendor/fixture" && call.path === (protocol === "anthropic-messages" ? "/v1/messages" : "/v1/chat/completions") && call.credentialMatches) &&
    calls.some(call => call.hasCwdRule) && sessionEntries.includes("state.db") && sessionEntries.includes("sessions") && hits.length === 0;
  const report = {
    executable, cli, hermesVersion: "0.21.0", calls, firstExitCode: first.code, secondExitCode: second.code,
    firstStderr: first.stderr, secondStderr: second.stderr, profileId, sessionEntries, providerKeyFileHits: hits, passed,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await upstream.stop(true);
  await rm(root, { recursive: true, force: true });
}
