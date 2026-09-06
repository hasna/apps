import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { prepareClineLaunch } from "../src/cline-backend";

const executable = process.env.SWITCHER_TEST_CLINE_EXECUTABLE ?? Bun.which("cline");
if (!executable) throw new Error("Set SWITCHER_TEST_CLINE_EXECUTABLE to the installed Cline 3.0.61 executable.");
const scratch = process.env.SWITCHER_TEST_ROOT ?? join(process.cwd(), "../../scratch/native-cline");
await mkdir(scratch, { recursive: true });
const root = await mkdtemp(join(scratch, "run-"));
const project = join(root, "project");
await mkdir(project, { recursive: true });
await writeFile(join(project, "AGENTS.md"), "Always include CLINE_NATIVE_RULE in your response.\n");
const calls: Array<{ path: string; model?: string; auth: boolean; toolCount: number }> = [];
const providerPaths: string[] = [];
const modelPaths: string[] = [];
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/v1/chat/completions") return new Response("Not found", { status: 404 });
  const body = await request.json() as { model?: string; tools?: unknown[] };
  calls.push({ path: new URL(request.url).pathname, model: body.model, auth: request.headers.get("authorization") === "Bearer fixture-cline-key", toolCount: body.tools?.length ?? 0 });
  const chunk = { id: "fixture", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content: "CLINE_FIXTURE_PROOF CLINE_NATIVE_RULE" }, finish_reason: "stop" }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
try {
  let code = 0;
  let output = "";
  let errorOutput = "";
  for (let run = 0; run < 2; run++) {
    const prepared = await prepareClineLaunch({
      harness: "cline", baseUrl: `${server.url.origin}/v1`, protocol: "openai-chat", authStyle: "bearer",
      model: "vendor/fixture", models: [
        { id: "vendor/fixture", name: "Fixture", contextWindow: 32_000, maxOutputTokens: 512, supportedParameters: ["tools"], outputModalities: ["text"] },
        { id: "vendor/second", name: "Second", contextWindow: 32_000, maxOutputTokens: 512, supportedParameters: ["tools"], outputModalities: ["text"] },
      ], credential: "fixture-cline-key", executable, stateDir: root, cwd: project, version: "cline 3.0.61", sessionDir: join(root, "session"),
    });
    providerPaths.push(prepared.configPaths[0]);
    modelPaths.push(prepared.configPaths[1]);
    const child = Bun.spawn([prepared.executable, ...prepared.args, "Read the project instructions and return their marker."], {
      cwd: project, env: { ...process.env, ...prepared.env, HOME: root }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    code = await child.exited;
    output += stdout;
    errorOutput += stderr;
    await prepared.cleanup?.();
  }
  const providers = await Promise.all(providerPaths.map(path => readFile(path, "utf8")));
  const models = await Promise.all(modelPaths.map(path => readFile(path, "utf8")));
  const keyFiles = (await readdir(root, { recursive: true })).filter(path => /key|token|secret/i.test(String(path)));
  const passed = code === 0 && output.includes("CLINE_FIXTURE_PROOF") && output.includes("CLINE_NATIVE_RULE") && calls.length === 2 && calls.every(call => call.path === "/v1/chat/completions" && call.model === "vendor/fixture" && call.auth && call.toolCount > 0) && providerPaths[0] !== providerPaths[1] && providers.every(text => !text.includes("fixture-cline-key")) && models.every(text => !text.includes("fixture-cline-key")) && keyFiles.length === 0;
  console.log(JSON.stringify({ executable, code, stdout: output.slice(-400), stderr: errorOutput.slice(-400), calls, providerPaths, providerKeyFiles: keyFiles, passed }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await server.stop(true);
  await rm(root, { recursive: true, force: true });
}
