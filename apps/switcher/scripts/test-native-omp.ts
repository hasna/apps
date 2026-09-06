import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { prepareHarnessLaunch } from "../src/harnesses";
import type { HarnessLaunchInput } from "../src/harness-types";

const executable = process.env.SWITCHER_TEST_OMP_EXECUTABLE;
if (!executable) throw new Error("Set SWITCHER_TEST_OMP_EXECUTABLE to the installed OMP executable. This check uses local fixtures only.");
const scratch = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace", "scratch", "switcher-native-tests");
await mkdir(scratch, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(scratch, "omp-cli-"));
const project = join(root, "project");
const home = join(root, "home");
const stateDir = join(root, "state");
const sessionDir = join(root, "sessions");
const credential = "fixture-omp-upstream-key";
const authStyle = process.env.SWITCHER_TEST_OMP_AUTH_STYLE === "x-api-key" ? "x-api-key" : "bearer";
const fileMarker = "OMP_READ_FILE_MARKER";
const ruleMarker = "OMP_PROJECT_RULE_MARKER";
const calls: Array<{path: string; model: string; hasReadTool: boolean; hasToolResult: boolean; hasRule: boolean; credentialMatches: boolean}> = [];

await mkdir(project, { recursive: true, mode: 0o700 });
await writeFile(join(project, "AGENTS.md"), `Project instruction ${ruleMarker}.\n`, { mode: 0o600 });
await writeFile(join(project, "fixture-read.txt"), `${fileMarker}\n`, { mode: 0o600 });
const chunk = (payload: Record<string, unknown>) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, ...payload }] })}\n\n`;
const server = Bun.serve({
  hostname: "127.0.0.1", port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const credentialMatches = authStyle === "x-api-key"
      ? request.headers.get("x-api-key") === credential
      : request.headers.get("authorization") === `Bearer ${credential}`;
    if (!credentialMatches) return new Response("Unauthorized", { status: 401 });
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") return new Response("Not found", { status: 404 });
    const body = await request.json() as {model?: string; tools?: unknown[]; messages?: Array<{role?: string; content?: unknown}>};
    const serialized = JSON.stringify(body);
    const messages = body.messages ?? [];
    const hasToolResult = serialized.includes(fileMarker) && messages.some(message => message.role === "tool");
    calls.push({path: url.pathname, model: body.model ?? "", hasReadTool: body.tools?.some(tool => JSON.stringify(tool).includes('"name":"read"')) ?? false, hasToolResult, hasRule: serialized.includes(ruleMarker), credentialMatches});
    if (!hasToolResult) return new Response(
      chunk({ delta: { role: "assistant", content: "" } }) +
      chunk({ delta: { tool_calls: [{ index: 0, id: "call_fixture", type: "function", function: { name: "read", arguments: JSON.stringify({ path: join(project, "fixture-read.txt") }) } }] } }) +
      chunk({ delta: {}, finish_reason: "tool_calls" }) + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    );
    const text = serialized.includes("Resume the prior proof") ? "OMP_RESUME_DELETED_PROOF" : "OMP_TOOL_LOOP_PROOF";
    return new Response(chunk({ delta: { role: "assistant", content: text } }) + chunk({ delta: {}, finish_reason: "stop" }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  },
});

const command = async (args: string[], env: Record<string, string>) => {
  const child = Bun.spawn([process.execPath, executable!, ...args], { cwd: project, env: { PATH: process.env.PATH ?? "/Users/hasna/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin", HOME: home, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGTERM"), 45_000);
  try { const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]); return { code, stdout, stderr }; }
  finally { clearTimeout(timer); }
};

async function filesUnder(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) files.push(...await filesUnder(child));
      else if (entry.isFile()) files.push(child);
    }
    return files;
  } catch { return []; }
}

try {
  const input: HarnessLaunchInput = { harness: "omp", baseUrl: `${server.url.origin}/v1`, protocol: "openai-chat", authStyle, model: "vendor/fixture", models: [{ id: "vendor/fixture", name: "Fixture", contextWindow: 64_000, maxOutputTokens: 8_000, supportedParameters: ["tools"], outputModalities: ["text"] }, { id: "vendor/team/nested", name: "Nested", supportedParameters: ["tools"], outputModalities: ["text"] }], credential, executable, args: ["-p", "Read fixture-read.txt with the read tool and return its marker."], stateDir, cwd: project, version: "omp/18.1.11", sessionDir };
  const prepared = await prepareHarnessLaunch(input);
  const env = { ...prepared.env };
  const first = await command(prepared.args, env);
  const sessionFile = (await filesUnder(sessionDir)).find(path => path.endsWith(".jsonl"));
  await rm(join(project, "fixture-read.txt"), { force: true });
  const second = await command(["--model", "switcher/vendor/fixture", "--models", "switcher/**", "--session-dir", sessionDir, ...(sessionFile ? ["--resume", sessionFile] : ["--resume", "missing"]), "-p", "Resume the prior proof after the file was deleted."], env);
  const sessionPresent = (await filesUnder(sessionDir)).length > 0;
  const passed = first.code === 0 && second.code === 0 && first.stdout.includes("OMP_TOOL_LOOP_PROOF") && second.stdout.includes("OMP_RESUME_DELETED_PROOF") && calls.some(call => call.hasReadTool && !call.hasToolResult) && calls.some(call => call.hasToolResult) && calls.every(call => call.path === "/v1/chat/completions" && call.model === "vendor/fixture" && call.credentialMatches) && calls.some(call => call.hasRule) && sessionPresent && !(await readFile(join(prepared.configPaths[0]), "utf8")).includes(credential);
  console.log(JSON.stringify({ executable, ompVersion: "18.1.11", authStyle, calls, firstExitCode: first.code, secondExitCode: second.code, firstStderr: first.stderr, secondStderr: second.stderr, sessionPresent, sessionFileFound: Boolean(sessionFile), passed }, null, 2));
  if (!passed) process.exitCode = 1;
  await prepared.cleanup?.();
} finally { await server.stop(true); await rm(root, { recursive: true, force: true }); }
