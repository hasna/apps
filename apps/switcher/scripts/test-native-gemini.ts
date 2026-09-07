import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const executable = process.env.SWITCHER_TEST_NATIVE_EXECUTABLE;
if (!executable) throw new Error("Set SWITCHER_TEST_NATIVE_EXECUTABLE to Gemini CLI 0.58.0.");
const scratch = process.env.SWITCHER_TEST_ROOT ?? join(homedir(), "Workspace/scratch/universal-harness-switcher/live/gemini-cli");
await mkdir(scratch, { recursive: true, mode: 0o700 });
const root = await mkdtemp(join(scratch, "source-cli-"));
const project = join(root, "project");
const home = join(root, "home");
const switcherHome = join(home, "switcher");
const stateDir = join(switcherHome, "state");
await mkdir(project, { recursive: true, mode: 0o700 });
await mkdir(join(home, ".gemini"), {recursive:true,mode:0o700});
await writeFile(join(home,".gemini","trustedFolders.json"),JSON.stringify({[project]:"TRUST_FOLDER"}),{mode:0o600});
const readPath = join(project, "fixture-read.txt");
const readMarker = `GEMINI_READ_${crypto.randomUUID()}`;
const agentMarker = `GEMINI_INSTRUCTIONS_${crypto.randomUUID()}`;
const importedMarker = `GEMINI_IMPORTED_GLOBAL_${crypto.randomUUID()}`;
const projectImportMarker = `GEMINI_IMPORTED_PROJECT_${crypto.randomUUID()}`;
const toolProof = `GEMINI_TOOL_LOOP_${crypto.randomUUID()}`;
const resumeProof = `GEMINI_RESUME_DELETED_${crypto.randomUUID()}`;
const secondModelProof = `GEMINI_SECOND_MODEL_${crypto.randomUUID()}`;
const concurrentMarkers = [`CONCURRENT_A_${crypto.randomUUID()}`,`CONCURRENT_B_${crypto.randomUUID()}`];
const denyMarker = `DENIED_CONTENT_${crypto.randomUUID()}`;
const credential = `gemini-fixture-${crypto.randomUUID()}`;
await writeFile(readPath, `${readMarker}\n`, { mode: 0o600 });
await mkdir(join(home,".gemini","context"),{recursive:true,mode:0o700});
await writeFile(join(home,".gemini","GEMINI.md"),'Global instructions: @./context/first.md\nCode example: `@./missing.md`\n',{mode:0o600});
await writeFile(join(home,".gemini","context","first.md"),`Nested instructions: @${join(home,".gemini","context","second.md")}\n`,{mode:0o600});
await writeFile(join(home,".gemini","context","second.md"),`${importedMarker}\n`,{mode:0o600});
await writeFile(join(project, "GEMINI.md"), `Project instructions: ${agentMarker}. @./project-instructions.md\n`, { mode: 0o600 });
await writeFile(join(project,"project-instructions.md"),projectImportMarker,{mode:0o600});
await mkdir(join(project, ".gemini"), { recursive: true, mode: 0o700 });
await writeFile(join(project, ".gemini", "settings.json"), JSON.stringify({
  model: { name: "project-redirect-model" },
  general: { defaultApprovalMode: "plan" },
  security: { disableYoloMode: true },
}, null, 2) + "\n", { mode: 0o600 });

const requests: Array<{ phase: number; path: string; model: string; auth: boolean; hasFunctionCall: boolean; hasFunctionResponse: boolean; hasReadMarker: boolean; hasHistory: boolean; hasInstructions: boolean; hasConcurrent: boolean[]; denied: boolean }> = [];
let phase = 0;
const stream = (chunk: Record<string, unknown>) => new Response(`data: ${JSON.stringify(chunk)}\n\n`, { headers: { "content-type": "text/event-stream" } });
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    const auth = request.headers.get("x-goog-api-key") === credential && !request.headers.has("authorization");
    if (request.method === "GET" && url.pathname === "/v1beta/models") {
      if (!auth) return new Response("unauthorized", { status: 401 });
      return Response.json({ models: [
        { name: "models/fixture-model", displayName: "Fixture Model", description: "Synthetic fixture", inputTokenLimit: 32000, outputTokenLimit: 2048, supportedGenerationMethods: ["generateContent"] },
        { name: "models/fixture-second", displayName: "Fixture Second", inputTokenLimit: 32000, outputTokenLimit: 2048, supportedGenerationMethods: ["generateContent"] },
      ] });
    }
    const modelMatch = url.pathname.match(/^\/v1beta\/models\/([^:]+):streamGenerateContent$/);
    if (request.method !== "POST" || !modelMatch || !["fixture-model", "fixture-second"].includes(modelMatch[1])) return new Response("wrong route", { status: 404 });
    if (!auth) return new Response("unauthorized", { status: 401 });
    const body = await request.json() as any;
    const serialized = JSON.stringify(body);
    const contents = body.contents ?? [];
    const model = modelMatch[1];
    const hasFunctionCall = serialized.includes('"functionCall"');
    const hasFunctionResponse = serialized.includes('"functionResponse"') || serialized.includes(readMarker);
    const hasHistory = serialized.includes(toolProof);
    const hasInstructions = serialized.includes(agentMarker)&&serialized.includes(importedMarker)&&serialized.includes(projectImportMarker);
    const hasConcurrent=concurrentMarkers.map(marker=>serialized.includes(marker));
    const denied=/denied|not (found|registered|available|allowed)|policy/i.test(serialized)&&hasFunctionResponse;
    requests.push({ hasConcurrent,denied,phase, path: url.pathname, model: url.pathname.match(/\/models\/([^:]+)/)?.[1] ?? "", auth, hasFunctionCall, hasFunctionResponse, hasReadMarker: serialized.includes(readMarker), hasHistory, hasInstructions });
    if(phase===2&&!hasFunctionResponse)return stream({candidates:[{content:{role:"model",parts:[{functionCall:{name:"read_file",args:{file_path:join(project,"denied.txt")}}}]},finishReason:"STOP"}]});
    if(phase===2)return stream({candidates:[{content:{role:"model",parts:[{text:denied&&!serialized.includes(denyMarker)?"DENY_POLICY_PRESERVED":"DENY_POLICY_MISSING"}]},finishReason:"STOP"}]});
    if(phase===3){
      const index=serialized.includes("Read concurrent-a.txt and return its marker.")?0:1;
      if(!hasFunctionResponse)return stream({candidates:[{content:{role:"model",parts:[{functionCall:{name:"read_file",args:{file_path:join(project,index?"concurrent-b.txt":"concurrent-a.txt")}}}]},finishReason:"STOP"}]});
      return stream({candidates:[{content:{role:"model",parts:[{text:hasConcurrent[index]&&!hasConcurrent[1-index]?concurrentMarkers[index]:"CONCURRENT_HISTORY_MIXED"}]},finishReason:"STOP"}]});
    }
    const shouldCallTool = model === "fixture-model" && phase === 0 && !hasFunctionResponse && contents.length > 0;
    if (shouldCallTool) return stream({ candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "read_file", args: { file_path: readPath } } }] }, finishReason: "STOP" }] });
    const answer = model === "fixture-second" ? secondModelProof : phase === 1 && hasHistory ? resumeProof : toolProof;
    return stream({ candidates: [{ content: { role: "model", parts: [{ text: answer }] }, finishReason: "STOP" }] });
  },
});

const sourceCli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const children: ReturnType<typeof Bun.spawn>[] = [];
const results: Array<{ label: string; code: number; stdout: string; stderr: string }> = [];
const invoke = async (args: string[], label: string) => {
  const child = Bun.spawn([process.execPath, sourceCli, ...args], {
    cwd: project,
    env: { PATH: process.env.PATH ?? "/Users/hasna/.bun/bin:/usr/bin:/bin", HOME: home, USER: process.env.USER ?? "fixture-user", HASNA_SWITCHER_HOME: switcherHome, SWITCHER_PROVIDER_FIXTURE: credential },
    stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true,
  });
  children.push(child);
  const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} }, 45_000);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const result = { label, code, stdout: stdout.replaceAll(credential, "[fixture-key-redacted]"), stderr: stderr.replaceAll(credential, "[fixture-key-redacted]") };
    results.push(result);
    await writeFile(join(root, `${label}.stdout`), result.stdout, { mode: 0o600 });
    await writeFile(join(root, `${label}.stderr`), result.stderr, { mode: 0o600 });
    return result;
  } finally { clearTimeout(timer); }
};

try {
  const add = await invoke(["providers", "add", "fixture", "--name", "Gemini Fixture", "--url", `${server.url.origin}/v1beta`, "--protocol", "gemini-generate-content", "--credential-env", "SWITCHER_PROVIDER_FIXTURE", "--auth-style", "x-api-key", "--catalog-url", `${server.url.origin}/v1beta`, "--catalog-format", "gemini", "--catalog-auth-style", "x-api-key"], "provider-add");
  assert.equal(add.code, 0, add.stderr);
  const models = await invoke(["models", "fixture", "--refresh"], "models");
  assert.equal(models.code, 0, models.stderr); assert(models.stdout.includes("fixture-model") && models.stdout.includes("fixture-second"));
  const first = await invoke(["launch", "gemini", "--provider", "fixture", "--model", "fixture-model", "--executable", executable, "--cwd", project, "--state-dir", stateDir, "--timeout", "45", "--", "--prompt", "Read fixture-read.txt with read_file and report its marker.", "--output-format", "json", "--approval-mode", "plan"], "first");
  assert.equal(first.code, 0, first.stderr); assert(first.stdout.includes(toolProof));
  const profiles = await invoke(["profiles", "list"], "profiles"); assert.equal(profiles.code, 0);
  const profileId = (JSON.parse(profiles.stdout).data ?? [])[0]?.id; assert(profileId);
  const second = await invoke(["launch", "gemini", "--provider", "fixture", "--model", "fixture-second", "--executable", executable, "--cwd", project, "--state-dir", stateDir, "--timeout", "45", "--", "--prompt", "Use the second catalog model.", "--output-format", "json", "--approval-mode", "plan"], "second-model");
  assert.equal(second.code, 0, second.stderr); assert(second.stdout.includes(secondModelProof));
  await rm(readPath);
  phase = 1;
  const resume = await invoke(["launch", profileId, "--executable", executable, "--cwd", project, "--state-dir", stateDir, "--timeout", "45", "--", "--resume", "latest", "--prompt", "Recall the prior proof after the file was deleted.", "--output-format", "json", "--approval-mode", "plan"], "resume");
  assert.equal(resume.code, 0, resume.stderr); assert(resume.stdout.includes(resumeProof));
  phase=3;
  await Promise.all(concurrentMarkers.map((marker,index)=>writeFile(join(project,index?"concurrent-b.txt":"concurrent-a.txt"),marker,{mode:0o600})));
  const simultaneous=await Promise.all(concurrentMarkers.map((_marker,index)=>invoke(["launch",profileId,"--executable",executable,"--cwd",project,"--state-dir",stateDir,"--timeout","30","--","--prompt",`Read ${index?"concurrent-b.txt":"concurrent-a.txt"} and return its marker.`,"--output-format","json","--approval-mode","plan"],`concurrent-${index}`)));
  for(const[result,index]of simultaneous.map((result,index)=>[result,index] as const)){assert.equal(result.code,0,result.stderr);assert(result.stdout.includes(concurrentMarkers[index]));assert(!result.stdout.includes(concurrentMarkers[1-index]));}
  const concurrentSessions=simultaneous.map(result=>JSON.parse(result.stdout).session_id);
  assert(concurrentSessions.every(id=>typeof id==="string"&&id.length>0));assert.notEqual(concurrentSessions[0],concurrentSessions[1]);
  phase=2;
  await mkdir(join(home,".gemini","policies"),{recursive:true,mode:0o700});
  await writeFile(join(home,".gemini","policies","deny-read.toml"),'[[rule]]\ntoolName = "read_file"\ndecision = "deny"\npriority = 999\n',{mode:0o600});
  await writeFile(join(project,"denied.txt"),denyMarker,{mode:0o600});
  const deny=await invoke(["launch",profileId,"--executable",executable,"--cwd",project,"--state-dir",stateDir,"--timeout","30","--","--prompt","Read denied.txt using read_file.","--output-format","json","--approval-mode","plan"],"user-policy-deny");
  assert.equal(deny.code,0,deny.stderr);assert(deny.stdout.includes("DENY_POLICY_PRESERVED"));assert(!deny.stdout.includes(denyMarker));
  assert(requests.length >= 4 && requests.every(request => request.path === `/v1beta/models/${request.model}:streamGenerateContent` && request.auth));
  assert(requests.some(request => request.model === "fixture-second" && request.hasFunctionCall === false));
  assert(requests.filter(request => request.model === "fixture-model").every(request => request.path === "/v1beta/models/fixture-model:streamGenerateContent"));
  assert(requests.some(request => request.phase === 0 && request.hasFunctionCall));
  assert(requests.some(request => request.phase === 0 && request.hasFunctionResponse && request.hasReadMarker));
  assert(requests.some(request => request.phase === 1 && request.hasHistory));
  const resumeRequests = requests.filter(request => request.phase === 1);
  assert.equal(resumeRequests.length, 1, "resume must make exactly one fresh model request");
  assert(resumeRequests.every(request => request.hasHistory), "resume made a fresh request without persisted history");
  assert(requests.filter(request => request.phase === 0 && request.hasFunctionCall).every(request => request.hasInstructions));
  const durablePath = join(stateDir,"sessions","gemini",profileId,"gemini-home",".gemini");
  assert(await Bun.file(join(durablePath,"settings.json")).exists() === false,"per-launch native settings must not be shared in durable state");
  assert.equal((await readdir(stateDir)).filter(name=>name.startsWith("launch-")).length,0);
  const providerKeyFileHits: string[] = [];
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    try { if ((await readFile(path)).includes(Buffer.from(credential))) providerKeyFileHits.push(path); } catch { /* SQLite and binary state are not text credential sinks. */ }
  }
  assert.equal(providerKeyFileHits.length, 0, "fixture credential must remain process-only");
  const report = { version: "0.58.0", executable, sourceCli, root, profileId, concurrentSessions, requests, results: results.map(({ label, code, stderr }) => ({ label, code, stderr })), durablePath, projectSettingsPath: join(project, ".gemini", "settings.json"), providerKeyFileHits, passed: true };
  await writeFile(join(root, "result.json"), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await writeFile(join(root, "result.json"), JSON.stringify({ version: "0.58.0", executable, sourceCli, root, requests, results: results.map(({ label, code, stderr }) => ({ label, code, stderr })), error: String(error), passed: false }, null, 2) + "\n", { mode: 0o600 });
  console.error(JSON.stringify({ error: String(error), root }, null, 2)); process.exitCode = 1;
} finally {
  for (const child of children) if (child.exitCode === null) { try { process.kill(-child.pid, "SIGKILL"); } catch {} await child.exited; }
  await server.stop(true);
}
