import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID, createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildCliFixture } from "./cli-build.fixture.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-email-recovery-"));
const binary = join(scratch, "skills.js"), mcp = join(scratch, "mcp.js"), guard = join(scratch, "guard.js");
const token = "q".repeat(43), code = "987123", oldKey = randomUUID();
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  await buildCliFixture(resolve(import.meta.dir, "../mcp/index.ts"), mcp);
  writeFileSync(guard, `import{appendFileSync}from'node:fs';import cp from'node:child_process';import{syncBuiltinESMExports}from'node:module';const deny=()=>{appendFileSync(process.env.QA_GUARD_EVENTS,'denied\\n');throw Error('OWNED_RECOVERY_GUARD')};const f=fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.origin!==process.env.QA_ALLOWED_ORIGIN)return Promise.reject(Error('OWNED_RECOVERY_GUARD'));return f(input,init)};Bun.spawn=deny;Bun.spawnSync=deny;for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=deny;syncBuiltinESMExports();`);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
function state(path: string): unknown {
  const s = lstatSync(path);
  return [s.ino, s.mode, s.mtimeMs, s.isDirectory() ? readdirSync(path).sort().map(name => [name, state(join(path, name))]) : createHash("sha256").update(readFileSync(path)).digest("hex")];
}
type Call = { path: string; method: string; body: unknown; auth: boolean; cookie: boolean };
async function fixture(run: (value: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const f = await setup();
  try { await run(f); } finally { f.server.stop(true); try { expect(state(f.root)).toEqual(f.before); } finally { rmSync(f.root, { recursive: true, force: true }); } }
}
async function setup() {
  const root = mkdtempSync(join(scratch, "owned-")), calls: Call[] = [];
  const ids = { invitationId: randomUUID(), challengeId: randomUUID() }, accepted = { organizationId: randomUUID(), membershipId: randomUUID(), accepted: true, changed: true, signInRequired: true };
  let reply: { body: unknown; status: number } | undefined, checkpointCount = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const path = new URL(request.url).pathname + new URL(request.url).search;
    if (path === "/owned-pty-checkpoint" && request.method === "GET") return Response.json({ requestsSinceCheckpoint: calls.length - checkpointCount });
    const body = await request.json();
    calls.push({ path, body, method: request.method, auth: request.headers.has("authorization"), cookie: request.headers.has("cookie") });
    if (reply) return Response.json(reply.body, { status: reply.status });
    if (path.endsWith("email-challenge")) return Response.json({ challengeId: ids.challengeId, message: "Conditional", expiresIn: 600, token }, { status: 202 });
    if (path.endsWith("email-accept")) return Response.json({ ...accepted, token, code });
    return Response.json({ error: oldKey }, { status: 404 });
  } });
  for (const name of ["home", "config", "emptyconfig", "data", "project", "hasna"]) mkdirSync(join(root, name), { mode: 0o700 });
  mkdirSync(join(root, "config/skills"));
  for (const name of ["credentials", "credentials-selected", "credentials-unrelated"]) writeFileSync(join(root, "config/skills", name), `HASNA_SKILLS_API_KEY=${oldKey}\nHASNA_SKILLS_API_URL=http://127.0.0.1:1/unrelated\n`, { mode: 0o600 });
  writeFileSync(join(root, "config/skills/identity-selected.json"), JSON.stringify({ userId: randomUUID(), orgId: randomUUID() }), { mode: 0o600 });
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(root, "home"), HASNA_HOME: join(root, "hasna"), HASNA_CONFIG_HOME: join(root, "config"),
    HASNA_SKILLS_DIR: join(root, "data"), HASNA_PROFILE: "selected", HASNA_SKILLS_API_URL: server.url.origin + "/prefix/api/v1", HASNA_SKILLS_API_KEY_REF: "vault/this-must-never-be-resolved",
    TMPDIR: scratch, NO_COLOR: "1", TERM: "dumb", SKILLS_TEST_MODE: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", QA_ALLOWED_ORIGIN: server.url.origin, QA_GUARD_EVENTS: join(root, "unexpected-credential-call") };
  return { root, env, ids, accepted, calls, server, before: state(root), checkpoint() { checkpointCount = calls.length; }, reply(body: unknown, status = 200) { reply = { body, status }; } };
}
function safe(output: string) { for (const value of [token, code, oldKey]) expect(output).not.toContain(value); }
async function processResult(f: Awaited<ReturnType<typeof setup>>, args: string[], input = "", env: Record<string, string> = f.env) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, ...args], { cwd: join(f.root, "project"), env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 12000);
  child.stdin.write(input); await child.stdin.end();
  try { const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); safe(stdout + stderr); expect(stdout.length + stderr.length).toBeLessThan(30000); return { stdout, stderr, status }; }
  finally { clearTimeout(timer); }
}
function cli(f: Awaited<ReturnType<typeof setup>>, action: "challenge" | "accept", piped = true) {
  return [binary, "workspace", "invitations", `email-${action}`, f.ids.invitationId, "--challenge-id", f.ids.challengeId, "--confirm", ...(piped ? ["--json", action === "challenge" ? "--token-stdin" : "--secrets-stdin"] : [])];
}
function validCalls(f: Awaited<ReturnType<typeof setup>>, actions: string[]) {
  expect(f.calls).toHaveLength(actions.length);
  actions.forEach((action, index) => { const call = f.calls[index]; expect(call).toEqual({ path: `/prefix/api/v1/account/invitations/email-${action}`, method: "POST", auth: false, cookie: false, body: { ...f.ids, token, ...(action === "accept" ? { code } : {}) } }); });
}
test("actual recovery CLI uses two explicit anonymous commands and preserves every profile", async () => fixture(async f => {
  const challenge = await processResult(f, cli(f, "challenge"), token + "\n"); expect(challenge).toMatchObject({ status: 0 }); expect(JSON.parse(challenge.stdout).challengeId).toBe(f.ids.challengeId); expect(challenge.stdout).toContain("Delivery is not confirmed");
  const accepted = await processResult(f, cli(f, "accept"), `${code}\n${token}\n`); expect(accepted.status).toBe(0); expect(JSON.parse(accepted.stdout)).toEqual(f.accepted); validCalls(f, ["challenge", "accept"]);
}));
test("CLI refuses missing confirmation, unknown secret flags, invalid input and absent/conflicting explicit target", async () => fixture(async f => {
  const args = cli(f, "challenge");
  for (const invalid of [args.filter(v => v !== "--confirm"), [...args, "--token", "not-a-secret"], [...args, "unexpected"], args.filter(v => v !== "--token-stdin")]) expect((await processResult(f, invalid, token)).status).toBe(1);
  for (const [action, flag, secret] of [["challenge", "--token", token], ["accept", "--code", code]] as const) {
    const rejected = await processResult(f, [...cli(f, action), `${flag}=${secret}`]);
    expect(rejected.status).toBe(1); expect(rejected.stderr).toContain("Invitation recovery arguments were refused"); expect(rejected.stdout).toBe("");
  }
  for (const input of [token + "x", token + "\nextra", "", "invalid"]) expect((await processResult(f, args, input)).status).toBe(1);
  for (const env of [{ ...f.env, HASNA_SKILLS_API_URL: "" }, { ...f.env, SKILLS_API_URL: "http://127.0.0.1:1" }]) expect((await processResult(f, args, token, env)).status).toBe(1);
  expect(f.calls).toHaveLength(0);
}));
test("CLI preserves ambiguous and known refused outcomes without automatic acceptance or recovery retry", async () => fixture(async f => {
  f.reply({ ...f.accepted, signInRequired: false, error: token });
  const ambiguous = await processResult(f, cli(f, "accept"), `${code}\n${token}`); expect(ambiguous.status).toBe(1); expect(JSON.parse(ambiguous.stdout).code).toBe("INVITATION_EMAIL_UNCONFIRMED"); expect(ambiguous.stdout).toContain("ordinary sign-in");
  f.reply({ code: "INVITATION_PROOF_UNAVAILABLE", error: token }, 401);
  const refused = await processResult(f, cli(f, "accept"), `${code}\n${token}`); expect(refused.status).toBe(1); expect(JSON.parse(refused.stdout).code).toBe("INVITATION_PROOF_UNAVAILABLE"); validCalls(f, ["accept", "accept"]);
}));
test("dedicated actual MCP initializes only two recovery tools without resolving unusable profile credentials", async () => fixture(async f => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", "--preload", guard, mcp, "--invitation-recovery", "--stdio"], cwd: join(f.root, "project"), env: f.env, stderr: "pipe" });
  let stderr = ""; transport.stderr?.on("data", chunk => { stderr += chunk.toString(); });
  const client = new Client({ name: "owned-recovery", version: "1" });
  try {
    await client.connect(transport);
    const listed = await client.listTools(); expect(listed.tools.map(tool => tool.name).sort()).toEqual(["accept_invitation_email_challenge", "request_invitation_email_challenge"]);
    for (const name of ["request_invitation_email_challenge", "accept_invitation_email_challenge"]) {
      const result = await client.callTool({ name, arguments: { ...f.ids, token, confirm: true, ...(name.startsWith("accept") ? { code } : {}) } });
      expect(result.isError).not.toBe(true); safe(JSON.stringify(result));
    }
    const bad = await client.callTool({ name: "accept_invitation_email_challenge", arguments: { ...f.ids, token, code, confirm: false } }); expect(bad.isError).toBe(true);
    const ordinary = await client.callTool({ name: "list_workspace_members", arguments: {} }); expect(ordinary.isError).toBe(true);
    f.reply({ ...f.accepted, changed: false }); const ambiguous = await client.callTool({ name: "accept_invitation_email_challenge", arguments: { ...f.ids, token, code, confirm: true } }); expect(ambiguous.isError).toBe(true); expect(JSON.stringify(ambiguous)).toContain("INVITATION_EMAIL_UNCONFIRMED"); safe(JSON.stringify(ambiguous));
    validCalls(f, ["challenge", "accept", "accept"]);
  } finally { await client.close(); await transport.close(); safe(stderr); }
}));
test("recovery MCP refuses incompatible flags and keeps the ordinary credential startup gate fail-closed", async () => fixture(async f => {
  for (const flags of [["--invitation-recovery"], ["--invitation-recovery", "--stdio", "--http"], ["--invitation-recovery", "--stdio", "--help"], ["--invitation-recovery=1", "--stdio"], ["--invitation-recovery", "--stdio", "--port", "0"]]) {
    const result = await processResult(f, [mcp, ...flags]); expect(result.status).toBe(1); expect(result.stdout).toBe("");
  }
  for (const env of [{ ...f.env, HASNA_SKILLS_API_URL: "" }, { ...f.env, MCP_HTTP: "1" }, { ...f.env, HASNA_SKILLS_LOCAL: "1" }, { ...f.env, SKILLS_LOCAL: "1" }]) expect((await processResult(f, [mcp, "--invitation-recovery", "--stdio"], "", env)).status).toBe(1);
  const ordinary: Record<string, string> = { ...f.env, HASNA_CONFIG_HOME: join(f.root, "emptyconfig"), QA_GUARD_EVENTS: join(scratch, "normal-credential-denials") };
  delete ordinary.HASNA_PROFILE; delete ordinary.HASNA_SKILLS_API_KEY_REF;
  const refused = await processResult(f, [mcp, "--stdio"], "", ordinary);
  expect(refused.status).toBe(1); expect(refused.stdout).toBe("");
  // Only macOS attempts the guarded Keychain subprocess; other hosts reach the missing-key refusal directly.
  expect(refused.stderr).toContain(process.platform === "darwin" ? "OWNED_RECOVERY_GUARD" : "no API key resolved — refusing to run locally instead.");
  expect(f.calls).toHaveLength(0);
}));
test("actual recovery terminal masks token/code, rejects overflow, and restores raw mode on completion and cancellation", async () => fixture(async f => {
  for (const mode of ["challenge", "accept", "overflow", "code-overflow", "code-invalid", "cancel"] as const) {
    const accepting = mode === "accept" || mode.startsWith("code-"), cancel = mode === "cancel", before = f.calls.length;
    f.checkpoint();
    const steps: Array<{ waitFor: string; send: string; checkUrl?: string }> = [{ waitFor: "Enter the invitation token from your email:", send: cancel ? "\u0003" : mode === "overflow" ? token + "xx\n" : token + "\n" }];
    if (mode === "overflow") steps.push({ waitFor: "Enter exactly 43 invitation token characters:", send: token + "\n", checkUrl: f.server.url.origin + "/owned-pty-checkpoint" });
    if (accepting) steps.push({ waitFor: "Enter the six-digit recovery code from your email:", send: code + (mode === "code-overflow" ? "7\n" : mode === "code-invalid" ? "x\n" : "\n") });
    if (mode.startsWith("code-")) steps.push({ waitFor: "Enter exactly 6 recovery code characters:", send: code + "\n", checkUrl: f.server.url.origin + "/owned-pty-checkpoint" });
    const child = Bun.spawn(["python3", resolve(import.meta.dir, "cli.invitation-pty.fixture.py"), process.execPath, "--no-env-file", "--preload", guard, ...cli(f, accepting ? "accept" : "challenge", false)], { cwd: join(f.root, "project"), env: { ...f.env, PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin` }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    child.stdin.write(JSON.stringify({ steps, canaries: [token, code, oldKey], expectedExit: cancel ? 130 : 0, expectedOutput: cancel ? [] : accepting ? [f.accepted.membershipId, '"signInRequired": true'] : [f.ids.challengeId, "Delivery is not confirmed"] }));
    await child.stdin.end();
    const [output, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); safe(output + stderr); expect(status).toBe(0); expect(JSON.parse(output)).toMatchObject({ passed: true, rawModeRestored: true, canaryLeak: false, checkpoints: mode === "overflow" || mode.startsWith("code-") ? 1 : 0 }); expect(f.calls.length - before).toBe(cancel ? 0 : 1);
  }
}));
