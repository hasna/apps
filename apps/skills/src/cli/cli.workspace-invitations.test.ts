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

const scratch = mkdtempSync(join(tmpdir(), "skills-invitation-actions-"));
const binary = join(scratch, "skills.js"), mcp = join(scratch, "mcp.js"), guard = join(scratch, "guard.js");
const actorId=randomUUID(),actorMid=randomUUID(),requestKey=randomUUID();
const invitationSecret = "r".repeat(43);
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
  const invitation = { id: randomUUID(), organizationId: randomUUID(), email: "recipient@example.test", role: "member", generation: 1,
    status: "pending", createdAt: "2026-09-07T00:00:00.123456Z", expiresAt: "2026-09-14T00:00:00Z", delivery: { state: "queued", attempts: 0 } };
  const accepted = { organizationId: randomUUID(), membershipId: randomUUID(), accepted: true, changed: true };
  let reply: Reply | undefined, role = "owner";
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname + new URL(request.url).search, body = request.method === "GET" ? {} : await request.json();
    const authorized = request.headers.get("authorization") === `Bearer ${session}`;
    calls.push({ path, method: request.method, body, authorized });
    const identity = { user: { id: actorId, membershipId: actorMid, email: "owner@example.test", displayName: null, role }, organization: { id: invitation.organizationId, slug: "selected", name: "Selected" } };
    if (path === "/prefix/api/auth/whoami") return Response.json({ ...identity, authMethod: authorized ? "jwt" : "api_key" });
    if (path === "/prefix/api/v1/account/workspaces/switch") return Response.json({ ...identity, token: session });
    if (path === "/prefix/api/auth/login") return Response.json({ ok: true });
    if (path === "/prefix/api/auth/verify") return Response.json({ token: session, apiKey: ignoredKey, user: { id: actorId } });
    if (!path.includes("/invitations") || !authorized) return Response.json({ error: durable }, { status: 403 });
    if (reply) return reply.raw ? new Response(String(reply.body), { status: reply.status ?? 200 }) : Response.json(reply.body, { status: reply.status ?? 200 });
    if (path.endsWith("/accept")) return Response.json({ ...accepted, token: invitationSecret });
    if (path.endsWith("/resend")) return Response.json({ invitation: { ...invitation, generation: 2 }, changed: true });
    if (request.method === "DELETE") return Response.json({ invitation: { ...invitation, status: "revoked" }, changed: true });
    if (request.method === "POST") return Response.json({ invitation, changed: true }, { status: 201 });
    return path.endsWith("/invitations") ? Response.json({ organizationId: invitation.organizationId, invitations: [invitation], nextCursor: null }) : Response.json({ invitation });
  } });
  const env = environment(root, `${server.url.origin}/prefix/api/v1`), before = state(root);
  return { root, env, before, server, calls, invitation, accepted, role(value: string) { role = value; }, reply(value?: Reply) { reply = value; } };
}
function noCanaries(text: string) { for (const value of [code, session, durable, ignoredKey, invitationSecret]) expect(text).not.toContain(value); }
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

const actions = ["list", "get", "issue", "resend", "revoke", "accept"] as const;
type Action = typeof actions[number];
function cliArgs(action: Action, id: string) {
  const targeted = ["get", "resend", "revoke", "accept"].includes(action);
  return [binary, "workspace", "invitations", action, ...(targeted ? [id] : []), "--user-id", actorId, "--membership-id", actorMid, "--email", "owner@example.test", "--json",
    ...(["list", "get"].includes(action) ? [] : ["--confirm"]), action === "accept" ? "--secrets-stdin" : "--code-stdin",
    ...(action === "issue" ? ["--recipient", "recipient@example.test", "--role", "member"] : []),
    ...(["issue", "resend"].includes(action) ? ["--idempotency-key", requestKey] : []),
    ...(["resend", "revoke"].includes(action) ? ["--expected-generation", "1"] : [])];
}
function toolArgs(action: Action, id: string) {
  return { userId: actorId, membershipId: actorMid, email: "owner@example.test", code,
    ...(["get", "resend", "revoke", "accept"].includes(action) ? { invitationId: id } : {}),
    ...(["list", "get"].includes(action) ? {} : { confirm: true }),
    ...(action === "issue" ? { recipient: "recipient@example.test", role: "member" } : {}),
    ...(["issue", "resend"].includes(action) ? { idempotencyKey: requestKey } : {}),
    ...(["resend", "revoke"].includes(action) ? { expectedGeneration: 1 } : {}),
    ...(action === "accept" ? { token: invitationSecret } : {}) };
}
test("built CLI performs all six invitation operations with exact fields and unchanged profiles", () => fixture(async f => {
  for (const action of actions) {
    const before = f.calls.length, result = await run(f.root, f.env, cliArgs(action, f.invitation.id), action === "accept" ? `${code}\n${invitationSecret}` : code);
    expect(result.exitCode).toBe(0); noCanaries(result.stdout + result.stderr);
    expect(f.calls.slice(before).filter(c => c.path.includes("/invitations"))).toHaveLength(1);
    expect(f.calls.at(-1)?.authorized).toBe(true);
    if (action === "issue") expect(f.calls.at(-1)?.body).toEqual({ email: "recipient@example.test", role: "member", idempotencyKey: requestKey });
    if (action === "accept") { expect(JSON.parse(result.stdout)).toEqual(f.accepted); expect(f.calls.at(-1)?.body).toEqual({ invitationId: f.invitation.id, token: invitationSecret }); }
    expect(state(f.root)).toEqual(f.before);
  }
}));
test("CLI rejects missing confirmation, changed profile targets, invalid keys and token input before invitation requests", () => fixture(async f => {
  const valid = cliArgs("issue", f.invitation.id);
  for (const args of [valid.filter(s => s !== "--confirm"), valid.map(s => s === requestKey ? "invalid" : s)]) {
    expect((await run(f.root, f.env, args)).exitCode).toBe(1); expect(f.calls).toEqual([]);
  }
  for (const args of [valid.map(s => s === actorMid ? randomUUID() : s), valid.map(s => s === actorId ? randomUUID() : s)]) {
    const before = f.calls.length, result = await run(f.root, f.env, args);
    expect(result.exitCode).toBe(1); noCanaries(result.stdout + result.stderr);
    expect(f.calls.slice(before).map(c => c.path)).toEqual(["/prefix/api/auth/whoami"]);
  }
  for (const input of [invitationSecret, `${code}\ninvalid`, `${code}\n${invitationSecret}\nextra`, "x".repeat(65)]) {
    const before = f.calls.length, result = await run(f.root, f.env, cliArgs("accept", f.invitation.id), input);
    expect(result.exitCode).toBe(1); noCanaries(result.stdout + result.stderr);
    expect(f.calls.slice(before).map(c => c.path)).toEqual(["/prefix/api/auth/whoami"]);
  }
}));
test("CLI preserves request keys and all profiles through refused or uncertain issue/resend/accept outcomes", () => fixture(async f => {
  for (const action of ["issue", "resend", "accept"] as const) for (const reply of [
    { status: 403, body: { code: "INVITATION_FORBIDDEN", error: invitationSecret } },
    { status: 409, body: { code: "INVITATION_CHANGED", error: durable } },
    { body: { token: invitationSecret } }, { body: durable, raw: true },
  ]) {
    f.reply(reply); const before = f.calls.length;
    const result = await run(f.root, f.env, cliArgs(action, f.invitation.id), action === "accept" ? `${code}\n${invitationSecret}` : code);
    expect(result.exitCode).toBe(1); noCanaries(result.stdout + result.stderr);
    expect(JSON.parse(result.stdout).code).toBe(reply.status ? reply.body.code : "INVITATION_UNCONFIRMED");
    const sent = f.calls.slice(before).filter(c => c.path.includes("/invitations")); expect(sent).toHaveLength(1);
    if (action !== "accept") expect(sent[0].body).toMatchObject({ idempotencyKey: requestKey });
    expect(state(f.root)).toEqual(f.before);
  }
}));
test("MCP stdio exposes six strict tools and shares confirmed operations with no credential mutation", () => fixture(async f => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", "--preload", guard, mcp, "--stdio"], cwd: join(f.root, "project"), env: f.env, stderr: "pipe" });
  const client = new Client({ name: "owned-invitations", version: "1.0.0" }); let stderr = "";
  transport.stderr?.on("data", chunk => { stderr += chunk.toString(); if (stderr.length > 30_000 && transport.pid) process.kill(transport.pid, "SIGKILL"); });
  const name = (action: Action) => action === "list" ? "list_workspace_invitations" : `${action}_workspace_invitation`;
  const invoke = (action: Action, args: Record<string, unknown>) => client.callTool({ name: name(action), arguments: args }, undefined, { timeout: 5000 });
  try {
    await client.connect(transport); const tools = (await client.listTools()).tools;
    for (const action of actions) {
      expect(tools.find(t => t.name === name(action))?.annotations).toMatchObject({ readOnlyHint: ["list", "get"].includes(action), idempotentHint: true });
      const before = f.calls.length, result = await invoke(action, toolArgs(action, f.invitation.id));
      expect(result.isError).not.toBe(true); noCanaries(JSON.stringify(result));
      expect(f.calls.slice(before).filter(c => c.path.includes("/invitations"))).toHaveLength(1);
    }
    for (const input of [{ ...toolArgs("issue", f.invitation.id), confirm: false }, { ...toolArgs("issue", f.invitation.id), idempotencyKey: undefined }, { ...toolArgs("accept", f.invitation.id), token: "invalid" }]) {
      const before = f.calls.length, result = await invoke("token" in input ? "accept" : "issue", input);
      expect(result.isError).toBe(true); expect(f.calls.length).toBe(before); noCanaries(JSON.stringify(result));
    }
    const beforeMismatch = f.calls.length, mismatch = await invoke("accept", { ...toolArgs("accept", f.invitation.id), membershipId: randomUUID() });
    expect(mismatch.isError).toBe(true); expect(f.calls.slice(beforeMismatch).map(c => c.path)).toEqual(["/prefix/api/auth/whoami"]); noCanaries(JSON.stringify(mismatch));
    for (const reply of [{ status: 403, body: { code: "INVITATION_FORBIDDEN", error: invitationSecret } }, { body: { token: invitationSecret } }]) {
      f.reply(reply); const before = f.calls.length, result = await invoke("issue", toolArgs("issue", f.invitation.id));
      expect(result.isError).toBe(true); noCanaries(JSON.stringify(result));
      expect(f.calls.slice(before).filter(c => c.path.includes("/invitations"))).toHaveLength(1);
      expect(JSON.stringify(result)).toContain(reply.status ? "INVITATION_FORBIDDEN" : "INVITATION_UNCONFIRMED");
    }
  } finally { await client.close(); await transport.close(); noCanaries(stderr); expect(stderr.length).toBeLessThan(30_001); }
}));
test("viewer accepts using explicit fresh context without named profile or durable key", () => fixture(async f => {
  f.role("viewer"); const env: Record<string, string> = { ...f.env, HASNA_SKILLS_API_URL: `${f.server.url.origin}/prefix/api/v1` }; delete env.HASNA_PROFILE;
  const result = await run(f.root, env, cliArgs("accept", f.invitation.id), `${code}\n${invitationSecret}`);
  expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout)).toEqual(f.accepted); noCanaries(result.stdout + result.stderr);
  expect(f.calls[0].path).toBe("/prefix/api/auth/verify"); expect(f.calls.at(-1)?.path).toBe("/prefix/api/v1/account/invitations/accept");
}));

test("actual PTY masks token and OTP, restores terminal modes after success/cancel and rejects overlong input before correction", () => fixture(async f => {
  const prompt = "Enter the invitation token from your email: ", otpPrompt = "Enter the six-digit code sent to your email: ";
  for (const mode of ["success", "cancel", "overflow-correct", "invalid-correct"] as const) {
    const steps = mode === "cancel" ? [{ waitFor: prompt, send: "\u0003" }]
      : mode === "success" ? [{ waitFor: prompt, send: invitationSecret + "\r" }, { waitFor: otpPrompt, send: code + "\r" }]
      : [{ waitFor: prompt, send: invitationSecret + (mode === "overflow-correct" ? "xx\r" : "=\r") }, { waitFor: "Enter exactly 43 invitation token characters: ", send: invitationSecret + "\r" }, { waitFor: otpPrompt, send: code + "\r" }];
    const args = cliArgs("accept", f.invitation.id).filter(value => value !== "--secrets-stdin" && value !== "--json");
    const before = f.calls.length;
    const child = Bun.spawn(["python3", resolve(import.meta.dir, "cli.invitation-pty.fixture.py"), process.execPath, "--no-env-file", "--preload", guard, ...args],
      { cwd: join(f.root, "project"), env: { ...f.env, PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin` }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
    child.stdin.write(JSON.stringify({ steps, expectedExit: mode === "cancel" ? 130 : 0, canaries: [invitationSecret, code, session, durable, ignoredKey], expectedOutput: mode === "cancel" ? [] : ['"accepted": true', f.accepted.membershipId] }));
    await child.stdin.end();
    try {
      const [out, err, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      noCanaries(out + err); expect({ mode, status, report: JSON.parse(out) }).toMatchObject({ mode, status: 0, report: { passed: true, rawModeRestored: true, canaryLeak: false, steps: steps.length } });
      expect(f.calls.slice(before).filter(c => c.path.includes("/invitations"))).toHaveLength(mode === "cancel" ? 0 : 1);
      if (mode === "cancel") expect(f.calls.slice(before).map(c => c.path)).toEqual(["/prefix/api/auth/whoami"]);
    } finally { clearTimeout(timer); if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; } }
  }
}));
