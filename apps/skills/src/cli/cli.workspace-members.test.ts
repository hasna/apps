import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();

const scratch = mkdtempSync(join(tmpdir(), "skills-workspace-members-"));
const binary = join(scratch, "skills.js"), mcp = join(scratch, "mcp.js"), guard = join(scratch, "guard.js");
const actorId=randomUUID(), actorMid=randomUUID();
const code = "132465", session = randomUUID(), durable = randomUUID(), ignoredKey = randomUUID();
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  await buildCliFixture(resolve(import.meta.dir, "../mcp/index.ts"), mcp);
  writeFileSync(guard, `const deny=()=>{throw Error('OWNED_ROSTER_GUARD')};const f=fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.protocol!=='data:'&&u.origin!==process.env.QA_ALLOWED_ORIGIN)return Promise.reject(Error('OWNED_ROSTER_GUARD'));return f(input,init)};Bun.spawn=deny;Bun.spawnSync=deny;const cp=require('node:child_process');for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync'])cp[k]=deny;`);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function state(root: string): unknown {
  return readdirSync(root).sort().map(name => {
    const path = join(root, name), stat = lstatSync(path);
    return stat.isDirectory() ? [name, state(path)] : [name, stat.mode, stat.ino, stat.mtimeMs, createHash("sha256").update(readFileSync(path)).digest("hex")];
  });
}
function environment(root: string, origin: string) {
  for (const name of ["home", "hasna", "config", "data"]) mkdirSync(join(root, name), { mode: 0o700 });
  mkdirSync(join(root, "config/skills"));
  for (const name of ["credentials", "credentials-selected", "credentials-unrelated"])
    writeFileSync(join(root, "config/skills", name), `HASNA_SKILLS_API_KEY=${durable}\nHASNA_SKILLS_API_URL=${name === "credentials-selected" ? origin : "http://127.0.0.1:1/unselected"}\n`, { mode: 0o600 });
  writeFileSync(join(root, "config/skills/identity-selected.json"), JSON.stringify({ userId: actorId }), { mode: 0o600 });
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(root, "home"), HASNA_HOME: join(root, "hasna"),
    HASNA_CONFIG_HOME: join(root, "config"), HASNA_SKILLS_DIR: join(root, "data"), HASNA_PROFILE: "selected",
    TMPDIR: scratch, NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", SKILLS_TEST_MODE: "1",
    QA_ALLOWED_ORIGIN: new URL(origin).origin };
}
type Call = { path: string; method: string; authorized: boolean };
async function fixture(action: (origin: string, calls: Call[], page: ReturnType<typeof makePage>, setMode: (mode: string) => void) => Promise<void>) {
  const calls: Call[] = [], page = makePage(); let mode = "ok";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url), authorized = [session,durable].some(value=>request.headers.get("authorization") === `Bearer ${value}`);
    calls.push({ path: url.pathname + url.search, method: request.method, authorized });
    const identity={user:{id:actorId,membershipId:actorMid,email:"owner@example.test",displayName:null,role:"owner"},organization:{id:page.organizationId,slug:"selected",name:"Selected"}};
    if(url.pathname==="/prefix/api/auth/whoami") return Response.json({...identity,authMethod:request.headers.get("authorization")===`Bearer ${durable}`?"api_key":"jwt"});
    if(url.pathname==="/prefix/api/v1/account/workspaces/switch") { expect(await request.json()).toEqual({membershipId:actorMid});return Response.json({...identity,token:session}); }
    if (url.pathname === "/prefix/api/auth/login") return Response.json({ sent: true });
    if (url.pathname === "/prefix/api/auth/verify") {
      const body = await request.json() as { email: string; code: string };
      return body.code === code && body.email === "owner@example.test" ? Response.json({ token: session, apiKey: ignoredKey, user:{id:actorId} }) : Response.json({ error: durable }, { status: 401 });
    }
    if (url.pathname !== "/prefix/api/v1/workspace/members" || request.method !== "GET") return Response.json({ error: durable }, { status: 404 });
    if (!authorized || mode === "denied") return Response.json({ error: durable }, { status: 403 });
    if (mode === "missing") return Response.json({ error: durable }, { status: 404 });
    if (mode === "bad") return Response.json({ privateCanary: durable });
    return Response.json(url.searchParams.has("cursor") ? { ...page, members: [], nextCursor: null } : { ...page, privateCanary: durable });
  } });
  try { await action(`${server.url.origin}/prefix/api/v1`, calls, page, next => { mode = next; }); }
  finally { await server.stop(true); }
}
function makePage() {
  return { organizationId: randomUUID(), members: [{ membershipId: randomUUID(), userId: randomUUID(), email: "member@example.test",
    displayName: "Ana 林", role: "admin", createdAt: "2026-01-02T03:04:05.123456Z" }], nextCursor: "opaque_cursor-A1" };
}
function noCanaries(output: string) { for (const value of [code, session, durable, ignoredKey]) expect(output).not.toContain(value); }
async function run(root: string, env: Record<string, string>, args: string[], input = code) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, ...args], { cwd: root, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(input + "\n"); await child.stdin.end();
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { stdout, stderr, exitCode };
  } finally { clearTimeout(timeout); if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; } }
}

test("the actual child invocation loads HTTP and native-denial guards", async () => {
  const root = mkdtempSync(join(scratch, "guard-")), env = environment(root, "http://127.0.0.1:1/prefix");
  const result = await run(root, env, ["-e", `let count=0;try{await fetch('http://127.0.0.1:2/control')}catch(e){if(e.message==='OWNED_ROSTER_GUARD')count++}try{Bun.spawn([process.execPath,'-e',''])}catch(e){if(e.message==='OWNED_ROSTER_GUARD')count++}console.log(count);if(count!==2)process.exitCode=1`]);
  expect(result.exitCode).toBe(0); expect(result.stdout.trim()).toBe("2");
});

test("built CLI paginates with fresh session, refuses malformed/denied requests and preserves all owned profiles", async () => fixture(async (origin, calls, page, setMode) => {
  const root = mkdtempSync(join(scratch, "cli-")), env = environment(root, origin), before = state(root);
  const common = [binary, "--profile", "selected", "workspace", "members", "--email", "owner@example.test", "--code-stdin"];
  const invoke = async (args: string[], input = code) => {
    const result = await run(root, env, args, input); noCanaries(result.stdout + result.stderr); expect(state(root)).toEqual(before); return result;
  };
  const first = await invoke([...common, "--limit", "1", "--json"]);
  expect(first.exitCode).toBe(0); expect(JSON.parse(first.stdout)).toEqual(page);
  const last = await invoke([...common, "--limit", "1", "--cursor", page.nextCursor, "--json"]);
  expect(last.exitCode).toBe(0); expect(JSON.parse(last.stdout)).toEqual({ ...page, members: [], nextCursor: null });
  const human = await invoke(common); expect(human.exitCode).toBe(0); expect(human.stdout).toContain(page.members[0]!.createdAt); expect(human.stdout).toContain(`Next cursor: ${page.nextCursor}`);
  expect(calls.filter(call => call.method === "GET" && call.path.includes("/workspace/members")).map(call => call.path)).toEqual([
    "/prefix/api/v1/workspace/members?limit=1", "/prefix/api/v1/workspace/members?limit=1&cursor=opaque_cursor-A1", "/prefix/api/v1/workspace/members"]);
  expect(calls.every(call => call.path.includes("/verify") ? !call.authorized : call.authorized)).toBe(true);
  let count = calls.length;
  for (const args of [[...common, "--limit", "0"], [...common, "--limit", "101"], [...common, "--limit", "1.5"], [...common, "--cursor", ""], [...common.filter(arg => arg !== "--code-stdin"), "--json"], [...common, "extra"], [...common, "--organization-id", randomUUID()]]) expect((await invoke(args)).exitCode).toBe(1);
  expect((await invoke(common, "invalid")).exitCode).toBe(1); expect(calls.length).toBe(count);
  expect((await invoke(common, "000000")).exitCode).toBe(1); expect(calls.length).toBe(count + 2);
  for (const mode of ["denied", "missing", "bad"]) {
    setMode(mode);
    for (const json of [false, true]) { const result = await invoke([...common, ...(json ? ["--json"] : [])]); expect(result.exitCode).toBe(1); if (json) expect(JSON.parse(result.stdout).error).toContain("Unable to list workspace members"); }
  }
}));

test("actual stdio MCP roster tool shares the client and never persists its fresh session", async () => fixture(async (origin, calls, page, setMode) => {
  const root = mkdtempSync(join(scratch, "mcp-")), env = environment(root, origin), before = state(root);
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", "--preload", guard, mcp, "--stdio"], cwd: root, env, stderr: "pipe" });
  const client = new Client({ name: "owned-roster-test", version: "1.0.0" }); let pid: number | null = null, stderr = "";
  let closed = Promise.resolve();
  transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
  try {
    await client.connect(transport); pid = transport.pid; expect(pid).not.toBeNull();
    const previousClose = transport.onclose;
    closed = new Promise<void>(resolveClose => { transport.onclose = () => { previousClose?.(); resolveClose(); }; });
    expect((await client.listTools()).tools.some(tool => tool.name === "list_workspace_members")).toBe(true);
    for (const cursor of [undefined, page.nextCursor]) {
      const result = await client.callTool({ name: "list_workspace_members", arguments: { email: "owner@example.test", code, limit: 1, ...(cursor ? { cursor } : {}) } });
      expect(result.isError).not.toBe(true); noCanaries(JSON.stringify(result));
      const content = result.content as Array<{ type: string; text: string }>;
      expect(JSON.parse(content[0]!.text)).toEqual(cursor ? { ...page, members: [], nextCursor: null } : page);
    }
    const count = calls.length;
    const invalid = await client.callTool({ name: "list_workspace_members", arguments: { email: "owner@example.test", code, organizationId: randomUUID() } });
    expect(invalid.isError).toBe(true); noCanaries(JSON.stringify(invalid)); expect(calls.length).toBe(count);
    setMode("denied");
    const denied = await client.callTool({ name: "list_workspace_members", arguments: { email: "owner@example.test", code } });
    expect(denied.isError).toBe(true); expect(JSON.stringify(denied)).toContain("WORKSPACE_MEMBERS_FAILED"); noCanaries(JSON.stringify(denied));
    expect(calls.every(call => call.path.includes("/verify") ? !call.authorized : call.authorized)).toBe(true);
  } finally {
    pid ??= transport.pid;
    await client.close(); await transport.close();
    if (pid !== null) {
      const alive = () => { try { process.kill(pid!, 0); return true; } catch { return false; } };
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try { await Promise.race([closed, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Owned MCP child close was not observed")), 3000); })]); }
      finally { clearTimeout(deadline); }
      expect(alive()).toBe(false);
    }
    noCanaries(stderr); expect(state(root)).toEqual(before);
  }
}));
