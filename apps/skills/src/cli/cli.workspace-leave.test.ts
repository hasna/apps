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

const scratch = mkdtempSync(join(tmpdir(), "skills-member-actions-"));
const binary = join(scratch, "skills.js"), mcp = join(scratch, "mcp.js"), guard = join(scratch, "guard.js");
const actorId=randomUUID(),actorMid=randomUUID();
const code = "132465", session = randomUUID(), durable = randomUUID(), ignoredKey = randomUUID();
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  await buildCliFixture(resolve(import.meta.dir, "../mcp/index.ts"), mcp);
  writeFileSync(guard, `import cp from'node:child_process';import{syncBuiltinESMExports}from'node:module';const deny=()=>{throw Error('OWNED_MEMBER_GUARD')};const f=fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.protocol!=='data:'&&u.origin!==process.env.QA_ALLOWED_ORIGIN)return Promise.reject(Error('OWNED_MEMBER_GUARD'));return f(input,init)};Bun.spawn=deny;Bun.spawnSync=deny;for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=deny;syncBuiltinESMExports();`);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function state(root: string): unknown {
  const s = lstatSync(root);
  return [s.mode, s.ino, s.mtimeMs, s.isDirectory() ? readdirSync(root).sort().map(name => [name, state(join(root, name))]) : createHash("sha256").update(readFileSync(root)).digest("hex")];
}
function environment(root: string, origin: string) {
  for (const name of ["home", "hasna", "config", "data", "project"]) mkdirSync(join(root, name), { mode: 0o700 });
  mkdirSync(join(root, "config/skills"));
  for (const name of ["credentials", "credentials-selected", "credentials-unrelated"])
    writeFileSync(join(root, "config/skills", name), `HASNA_SKILLS_API_KEY=${durable}\nHASNA_SKILLS_API_URL=${name === "credentials-selected" ? origin : "http://127.0.0.1:1/unselected"}\n`, { mode: 0o600 });
  writeFileSync(join(root, "config/skills/identity-selected.json"), JSON.stringify({ userId: actorId }), { mode: 0o600 });
  writeFileSync(join(root, "project/keep.txt"), "owned caller content");
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(root, "home"), HASNA_HOME: join(root, "hasna"),
    HASNA_CONFIG_HOME: join(root, "config"), HASNA_SKILLS_DIR: join(root, "data"), HASNA_PROFILE: "selected", TMPDIR: scratch,
    NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", SKILLS_TEST_MODE: "1", QA_ALLOWED_ORIGIN: new URL(origin).origin };
}
type Call = { path: string; method: string; body: unknown; authorized: boolean };
type Reply = { status?: number; body: unknown; raw?: boolean };
async function fixture(action: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup(); try { await action(f); } finally {
    await f.server.stop(true);
    try { expect(state(f.root)).toEqual(f.before); } finally { rmSync(f.root, { recursive: true, force: true }); }
  }
}
async function setup() {
  const root = mkdtempSync(join(scratch, "owned-")), calls: Call[] = [];
  const member = { membershipId: randomUUID(), userId: randomUUID(), email: "member@example.test", displayName: "Ana 林", role: "viewer", createdAt: "2026-09-07T00:00:00.123456Z" };
  const changed = { organizationId: randomUUID(), member, changed: true };
  const removed = { organizationId: changed.organizationId, membershipId: actorMid, removed: true, signInRequired: true };
  let reply: Reply = { body: removed }, role = "owner";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname + new URL(request.url).search, body = request.method === "GET" ? {} : await request.json() as { email?: string; code?: string; membershipId?: string };
    const authorized = [session,durable].some(value=>request.headers.get("authorization") === `Bearer ${value}`);
    calls.push({ path, method: request.method, body, authorized });
    const identity={user:{id:actorId,membershipId:actorMid,email:"owner@example.test",displayName:null,role},organization:{id:changed.organizationId,slug:"selected",name:"Selected"}};
    if(path==="/prefix/api/auth/whoami")return Response.json({...identity,authMethod:request.headers.get("authorization")===`Bearer ${durable}`?"api_key":"jwt"});
    if(path==="/prefix/api/v1/account/workspaces/switch"){expect(body).toEqual({membershipId:actorMid});return Response.json({...identity,token:session});}
    if (path === "/prefix/api/auth/verify") return body.email === "owner@example.test" && body.code === code
      ? Response.json({ token: session, apiKey: ignoredKey, user:{id:actorId} }) : Response.json({ error: durable }, { status: 401 });
    if (path !== "/prefix/api/v1/account/workspaces/leave" || request.method !== "POST") return Response.json({ error: durable }, { status: 404 });
    if (!authorized) return Response.json({ error: durable }, { status: 403 });
    return reply.raw ? new Response(String(reply.body), { status: reply.status ?? 200 }) : Response.json(reply.body, { status: reply.status ?? 200 });
  } });
  const env = environment(root, `${server.url.origin}/prefix/api/v1`), before = state(root);
  return { root, env, before, server, calls, member, changed, removed, role(value: string) { role = value; }, reply(value: Reply) { reply = value; } };
}
function noCanaries(text: string) { for (const value of [code, session, durable, ignoredKey]) expect(text).not.toContain(value); }
async function run(root: string, env: Record<string, string>, args: string[], input = code) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, ...args], { cwd: join(root, "project"), env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  let expired = false, bytes = 0;
  const timeout = setTimeout(() => { expired = true; child.kill("SIGKILL"); }, 10_000);
  async function capture(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader(), decoder = new TextDecoder(); let output = "";
    try { while (true) {
      const next = await reader.read(); if (next.done) return output + decoder.decode();
      bytes += next.value.byteLength;
      if (bytes > 30_000) { child.kill("SIGKILL"); throw new Error("Owned member child output exceeded limit"); }
      output += decoder.decode(next.value, { stream: true });
    } } finally { reader.releaseLock(); }
  }
  const stdoutDone = capture(child.stdout), stderrDone = capture(child.stderr);
  try {
    child.stdin.write(input + "\n"); await child.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([stdoutDone, stderrDone, child.exited]);
    expect(expired).toBe(false); return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timeout); if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; }
    await Promise.allSettled([stdoutDone, stderrDone]);
  }
}

const leaveArgs = [binary, "workspace", "leave", actorMid, "--expected-role", "owner", "--email", "owner@example.test", "--code-stdin", "--confirm", "--json"];
test("built CLI leaves only the profile's observed membership and preserves all files", async () => fixture(async f => {
  const result = await run(f.root, f.env, leaveArgs);
  expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout)).toEqual(f.removed); noCanaries(result.stdout + result.stderr);
  expect(f.calls.at(-1)).toMatchObject({ path: "/prefix/api/v1/account/workspaces/leave", method: "POST", body: { membershipId: actorMid, expectedRole: "owner" } });
  expect(f.calls.filter(c => c.path.endsWith("/leave"))).toHaveLength(1);
  expect(f.calls.filter(c => c.path.endsWith("/verify"))).toHaveLength(1);
}));
test("CLI requires confirmation and refuses to retarget a named profile", async () => fixture(async f => {
  expect((await run(f.root, f.env, leaveArgs.filter(v => v !== "--confirm"))).exitCode).toBe(1); expect(f.calls).toEqual([]);
  for (const args of [leaveArgs.map(v => v === actorMid ? randomUUID() : v), [...leaveArgs, "--user-id", randomUUID()]]) {
    const before = f.calls.length, result = await run(f.root, f.env, args);
    expect(result.exitCode).toBe(1); noCanaries(result.stdout + result.stderr);
    expect(f.calls.slice(before).map(c => c.path)).toEqual(["/prefix/api/auth/whoami"]);
  }
}));
test("CLI reports server refusals and uncertain replies without credential deletion or retries", async () => fixture(async f => {
  for (const reply of [{ status: 409, body: { code: "LAST_WORKSPACE_REQUIRED", error: durable } }, { status: 409, body: { code: "LAST_OWNER_REQUIRED", error: durable } }, { body: {} }, { body: "broken", raw: true }]) {
    f.reply(reply); const before = f.calls.length, result = await run(f.root, f.env, leaveArgs);
    expect(result.exitCode).toBe(1); noCanaries(result.stdout + result.stderr);
    expect(JSON.parse(result.stdout).code).toBe(reply.status ? reply.body.code : "WORKSPACE_LEAVE_UNCONFIRMED");
    expect(f.calls.slice(before).filter(c => c.path.endsWith("/leave"))).toHaveLength(1);
    expect(f.calls.at(-1)?.path).toBe("/prefix/api/v1/account/workspaces/leave");
    expect(state(f.root)).toEqual(f.before);
  }
}));
test("actual MCP stdio self-leave requires explicit context and confirmation with unchanged profiles", async () => fixture(async f => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", "--preload", guard, mcp, "--stdio"], cwd: join(f.root, "project"), env: f.env, stderr: "pipe" });
  const client = new Client({ name: "owned-leave-test", version: "1.0.0" }); let stderr = "";
  transport.stderr?.on("data", chunk => { stderr += chunk.toString(); if (stderr.length > 30_000 && transport.pid) process.kill(transport.pid, "SIGKILL"); });
  try {
    await client.connect(transport);
    const tool = (await client.listTools()).tools.find(t => t.name === "leave_workspace");
    expect(tool?.annotations).toMatchObject({ destructiveHint: true, idempotentHint: false, readOnlyHint: false });
    const args = { membershipId: actorMid, userId: actorId, expectedRole: "owner", confirm: true, email: "owner@example.test", code };
    const invoke = (input: Record<string, unknown>) => client.callTool({ name: "leave_workspace", arguments: input }, undefined, { timeout: 5000 });
    for (const invalid of [{ ...args, confirm: false }, { ...args, confirm: undefined }, { ...args, userId: undefined }, { ...args, force: true }]) {
      expect((await invoke(invalid)).isError).toBe(true); expect(f.calls).toEqual([]);
    }
    const mismatch = await invoke({ ...args, membershipId: randomUUID() }); expect(mismatch.isError).toBe(true);
    expect(f.calls.map(c => c.path)).toEqual(["/prefix/api/auth/whoami"]);
    const result = await invoke(args); expect(result.isError).not.toBe(true);
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual(f.removed); noCanaries(JSON.stringify(result));
    f.reply({ body: {} }); const before = f.calls.length, uncertain = await invoke(args);
    expect(uncertain.isError).toBe(true); expect(JSON.stringify(uncertain)).toContain("WORKSPACE_LEAVE_UNCONFIRMED"); noCanaries(JSON.stringify(uncertain));
    expect(f.calls.slice(before).filter(c => c.path.endsWith("/leave"))).toHaveLength(1);
  } finally { await client.close(); await transport.close(); noCanaries(stderr); expect(stderr.length).toBeLessThan(30_001); }
}));

test("CLI permits explicit viewer context without a named profile or an API key", async () => fixture(async f => {
  f.role("viewer");
  const env: Record<string, string> = { ...f.env, HASNA_SKILLS_API_URL: `${f.server.url.origin}/prefix/api/v1` };
  delete env.HASNA_PROFILE;
  const result = await run(f.root, env, [...leaveArgs.map(v => v === "owner" ? "viewer" : v), "--user-id", actorId]);
  expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout)).toEqual(f.removed);
  expect(f.calls[0]?.path).toBe("/prefix/api/auth/verify");
  expect(f.calls.at(-1)?.body).toEqual({ membershipId: actorMid, expectedRole: "viewer" });
  noCanaries(result.stdout + result.stderr);
}));
