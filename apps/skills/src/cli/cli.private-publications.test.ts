import { afterAll, beforeAll, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { useDefaultTestTimeout } from "../test-preload.js";
import { scaffoldPortableSkill } from "../lib/portable-skills.js";
import { buildCliFixture } from "./cli-build.fixture.js";

useDefaultTestTimeout();
const installedPackage = process.env.SKILLS_PUBLICATION_TEST_PACKAGE;
const root = mkdtempSync(join(realpathSync(tmpdir()), "publication-surface-")), binary = installedPackage ? join(installedPackage, "bin/index.js") : join(root, "skills.js"), mcp = installedPackage ? join(installedPackage, "bin/mcp.js") : join(root, "mcp.js"), guard = join(root, "guard.js");
const [userId, organizationId, membershipId, skillId, versionId] = Array.from({ length: 5 }, () => randomUUID());
const token = "owned-publication-session-canary", key = "owned-selected-key-canary", code = "123456";
const identity = { user: { id: userId, membershipId, role: "owner", email: "publisher@example.test", displayName: null }, organization: { id: organizationId, name: "Owned", slug: "owned" } };
beforeAll(async () => {
  if (!installedPackage) {
    await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
    await buildCliFixture(resolve(import.meta.dir, "../mcp/index.ts"), mcp);
  }
  writeFileSync(guard, `import {createHash} from "node:crypto";const original=fetch;globalThis.fetch=async(input,init)=>{const u=new URL(input instanceof Request?input.url:String(input));if(u.protocol==='data:'&&createHash('sha256').update(String(input)).digest('hex')==='2a3af1723c9ab5dd5a0bf6ac4440cee82a86d74bb1de1b5ed95c75ef7ce05f87')return original(input,init);if(u.hostname==='owned-publications.s3.us-east-1.amazonaws.com'&&u.protocol==='https:'&&u.pathname.startsWith('/private-publication-staging/')){u.protocol='http:';u.host=new URL(process.env.QA_ORIGIN).host;}if(u.origin!==process.env.QA_ORIGIN)throw Error('External network refused');const r=await original(u,init);if(r.headers.get('x-owned-lost-response')==='1'){void r.body?.cancel();throw Error('Owned response-loss fixture');}return r;};`);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function fixture(action: (f: { origin: string; calls: Array<{ method: string; path: string }>; puts: () => number; disabled: () => void; losePut: () => void }) => Promise<void>) {
  const calls: Array<{ method: string; path: string }> = [], intents = new Map<string, any>(), keys = new Map<string, string>();
  let puts = 0, enabled = true, lose = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const url = new URL(req.url), path = url.pathname; calls.push({ method: req.method, path });
    if (path.startsWith("/private-publication-staging/")) {
      expect(req.method).toBe("PUT"); expect(req.headers.has("authorization")).toBe(false);
      const id = path.split("/")[3]!, intent = intents.get(id); expect(intent).toBeDefined();
      const bytes = new Uint8Array(await req.arrayBuffer()), digest = createHash("sha256").update(bytes).digest("hex");
      expect(digest).toBe(intent.archiveSha256); expect(bytes.length).toBe(intent.archiveByteSize);
      expect(req.headers.get("content-length")).toBe(String(bytes.length)); expect(req.headers.get("content-type")).toBe("application/gzip");
      expect(req.headers.get("x-amz-checksum-sha256")).toBe(Buffer.from(digest, "hex").toString("base64"));
      intent.uploaded = true; puts++; const lost = lose; lose = false;
      return new Response(null, { status: 200, headers: lost ? { "x-owned-lost-response": "1" } : {} });
    }
    const body = req.method === "GET" ? null : await req.json() as any;
    if (path === "/api/auth/verify") { expect(body).toEqual({ email: "publisher@example.test", code }); return Response.json({ token, ...identity }); }
    expect(req.headers.get("authorization")).toBe(`Bearer ${token}`);
    if (path === "/api/auth/whoami") return Response.json({ authMethod: "jwt", ...identity });
    if (path === "/api/v1/account/workspaces/switch") { expect(body).toEqual({ membershipId }); return Response.json({ token, ...identity }); }
    if (path === "/api/v1/capabilities") return Response.json({ contractVersion: 1, apiVersion: 1,
      privatePublishing: { contractVersion: 1, enabled, authentication: "interactive-session", maxArchiveBytes: 16777216, uploadMaxTtlSeconds: 300, executionEnabled: false } });
    const base = `/api/v1/skills/${skillId}/publication-uploads`;
    if (path === base && req.method === "POST") {
      let id = keys.get(body.idempotencyKey); const existed = !!id;
      if (!id) { id = randomUUID(); keys.set(body.idempotencyKey, id); intents.set(id, { id, skillId, version: body.version, expectedCurrentVersionId: body.expectedCurrentVersionId,
        archiveSha256: body.archiveSha256, archiveByteSize: body.archiveByteSize, state: "awaiting_upload", expiresAt: new Date(Date.now() + 3600000).toISOString(), createdAt: new Date().toISOString(), versionId: null }); }
      return Response.json({ upload: intents.get(id), changed: !existed }, { status: existed ? 200 : 201 });
    }
    const id = path.slice(base.length + 1).split("/")[0]!, intent = intents.get(id);
    if (!intent || !path.startsWith(base + "/")) return Response.json({ code: "NOT_FOUND" }, { status: 404 });
    if (path.endsWith("/upload-url")) {
      const issued = Math.floor(Date.now() / 1000) * 1000, expiresAt = new Date(issued + 60000).toISOString();
      const date = new Date(issued).toISOString().replace(/[-:]/g, "").replace(".000", "");
      const query = new URLSearchParams({ "X-Amz-Algorithm": "AWS4-HMAC-SHA256", "X-Amz-Credential": `${"A".repeat(20)}/${date.slice(0, 8)}/us-east-1/s3/aws4_request`, "X-Amz-Date": date, "X-Amz-Expires": "60", "X-Amz-Security-Token": "owned-session-fixture",
        "X-Amz-SignedHeaders": "content-length;content-type;host;x-amz-checksum-sha256;x-amz-expected-bucket-owner", "X-Amz-Signature": "a".repeat(64) });
      return Response.json({ upload: { method: "PUT", uploadUrl: `https://owned-publications.s3.us-east-1.amazonaws.com/private-publication-staging/${organizationId}/${id}/bundle.tgz?${query}`, expiresAt,
        headers: { "content-type": "application/gzip", "content-length": String(intent.archiveByteSize), "x-amz-checksum-sha256": Buffer.from(intent.archiveSha256, "hex").toString("base64"), "x-amz-expected-bucket-owner": "1".repeat(12) } } });
    }
    if (path.endsWith("/finalize")) { intent.state = intent.uploaded ? "committed" : "needs_attention"; intent.versionId = intent.uploaded ? versionId : null; }
    if (req.method === "DELETE" && intent.state !== "committed") intent.state = "cancelled";
    const { uploaded, ...view } = intent; return Response.json({ upload: view });
  } });
  try { await action({ origin: server.url.origin, calls, puts: () => puts, disabled: () => { enabled = false; }, losePut: () => { lose = true; } }); }
  finally { await server.stop(true); }
}
function environment(origin: string, work: string) {
  return { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: work, HASNA_HOME: join(work, "hasna"), HASNA_CONFIG_HOME: join(work, "config"), HASNA_SKILLS_DIR: join(work, "data"),
    HASNA_STATION: "publication-owned-no-keychain", SKILLS_TEST_MODE: "1", HASNA_SKILLS_API_URL: origin, HASNA_SKILLS_API_KEY_OVERRIDE: key, QA_ORIGIN: origin,
    TMPDIR: root, NO_COLOR: "1", TERM: "dumb", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
}
const verification = ["--email", "publisher@example.test", "--user-id", userId!, "--membership-id", membershipId!, "--code-stdin", "--json"];
async function cli(origin: string, work: string, args: string[]) {
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, "publication", ...args, ...verification], {
    cwd: work, env: environment(origin, work), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(code + "\n"); child.stdin.end();
  const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stdout.length + stderr.length).toBeLessThan(5000); expect(stdout + stderr).not.toContain(token); expect(stdout + stderr).not.toContain(key); expect(stdout + stderr).not.toContain("X-Amz-"); expect(stderr).toBe("");
    return { exitCode, result: JSON.parse(stdout) };
  } finally { clearTimeout(timer); }
}
test("built terminal publish and lost-upload resume use exact bytes and fresh authority, then status works disabled", async () => fixture(async f => {
  const work = mkdtempSync(join(root, "cli-")), source = scaffoldPortableSkill("terminal-publication", { rootDir: work }).path, recovery = join(work, "receipt");
  f.losePut();
  const first = await cli(f.origin, work, ["publish", source, "--skill-id", skillId!, "--expect-empty", "--recovery-dir", recovery, "--confirm", "--wait-seconds", "0"]);
  expect(first.exitCode).toBe(1); expect(first.result, JSON.stringify({ requests: f.calls, puts: f.puts(), recoveryPhase: existsSync(join(recovery, "receipt.json")) ? JSON.parse(readFileSync(join(recovery, "receipt.json"), "utf8")).phase : "absent" })).toMatchObject({ uncertain: true, code: "PUBLICATION_UPLOAD_UNCONFIRMED" }); expect(f.puts()).toBe(1);
  const saved = JSON.parse(readFileSync(join(recovery, "receipt.json"), "utf8")); expect(saved.phase).toBe("upload_uncertain");
  const second = await cli(f.origin, work, ["resume", "--recovery-dir", recovery, "--confirm", "--wait-seconds", "0"]);
  expect(second.exitCode).toBe(0); expect(second.result).toMatchObject({ committed: true, executionEnabled: null, state: "committed" }); expect(f.puts()).toBe(1);
  f.disabled(); const status = await cli(f.origin, work, ["status", "--recovery-dir", recovery]); expect(status.exitCode).toBe(0); expect(status.result.intentId).toBe(saved.intent.id);
  expect(f.calls.filter(c => c.path === `/api/v1/skills/${skillId}/publication-uploads`)).toHaveLength(1);
  expect(f.calls.filter(c => c.path === "/api/auth/verify")).toHaveLength(3);
  expect(f.calls.some(c => c.path === "/api/v1/skills")).toBe(false);
}));

test("CLI refuses absent consent and missing explicit CAS before any network", async () => fixture(async f => {
  const work = mkdtempSync(join(root, "refusals-"));
  const first = await cli(f.origin, work, ["publish", work, "--skill-id", skillId!, "--expect-empty", "--recovery-dir", join(work, "recovery")]);
  expect(first.result.code).toBe("PUBLICATION_CONFIRM_REQUIRED");
  const second = await cli(f.origin, work, ["publish", work, "--skill-id", skillId!, "--recovery-dir", join(work, "recovery"), "--confirm"]);
  expect(second.result.code).toBe("INVALID_PUBLICATION_INPUT"); expect(f.calls).toHaveLength(0);
}));

test("real stdio MCP exposes the same publication, reconciliation and cancellation paths", async () => fixture(async f => {
  const work = mkdtempSync(join(root, "mcp-")), source = scaffoldPortableSkill("mcp-publication", { rootDir: work }).path, recovery = join(work, "receipt");
  const transport = new StdioClientTransport({ command: process.execPath, args: ["--no-env-file", "--preload", guard, mcp, "--stdio"], cwd: work, env: environment(f.origin, work), stderr: "pipe" });
  const client = new Client({ name: "owned-publication-test", version: "1.0.0" }); let stderr = "";
  transport.stderr?.on("data", data => { stderr += String(data); });
  try {
    await client.connect(transport);
    const listed = (await client.listTools()).tools, names = listed.map(t => t.name);
    const contracts = await client.readResource({ uri: "skills://mcp/contracts" });
    const manifest = JSON.parse((contracts.contents[0] as { text: string }).text);
    for (const tool of listed.filter(t => ["publish_private_skill", "get_private_publication", "resume_private_publication", "cancel_private_publication"].includes(t.name))) {
      const declared = manifest.tools.find((t: { name: string }) => t.name === tool.name);
      expect(declared).toBeDefined();
      expect(Object.keys(declared.inputSchema.properties).sort()).toEqual(Object.keys(tool.inputSchema.properties ?? {}).sort());
      expect(declared.inputSchema.required.sort()).toEqual([...(tool.inputSchema.required ?? [])].sort());
    }
    for (const name of ["publish_private_skill", "get_private_publication", "resume_private_publication", "cancel_private_publication"]) expect(names).toContain(name);
    const auth = { email: "publisher@example.test", code, userId, membershipId, recoveryDirectory: recovery };
    const published = await client.callTool({ name: "publish_private_skill", arguments: { ...auth, directory: source, skillId, expectedCurrentVersionId: null, confirm: true, waitMs: 0 } });
    expect(published.isError).not.toBe(true); expect(JSON.parse((published.content as Array<{ type: string; text: string }>)[0]!.text)).toMatchObject({ committed: true, executionEnabled: null });
    for (const [name, extras] of [["get_private_publication", {}], ["resume_private_publication", { confirm: true, waitMs: 0 }], ["cancel_private_publication", { confirm: true }]] as const) {
      const result = await client.callTool({ name, arguments: { ...auth, ...extras } }); expect(result.isError).not.toBe(true); expect(JSON.stringify(result)).not.toContain(token); expect(JSON.stringify(result)).not.toContain("X-Amz-");
    }
    expect(f.puts()).toBe(1); expect(f.calls.filter(c => c.path === "/api/auth/verify")).toHaveLength(4);
  } finally { await client.close(); }
  expect(stderr).not.toContain(token); expect(stderr).not.toContain(key);
}));
