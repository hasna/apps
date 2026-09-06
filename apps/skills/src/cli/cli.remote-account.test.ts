import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { useDefaultTestTimeout } from "../test-preload.js";
import { RemoteSkillsClient } from "../lib/remote-client.js";
import { buildCliFixture } from "./cli-build.fixture.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-public-account-"));
const binary = join(scratch, "skills.js");
const guard = join(scratch, "network-guard.js");
const runId = "00000000-0000-4000-8000-000000000001";
beforeAll(async () => {
  await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary);
  writeFileSync(guard, `const original=globalThis.fetch;globalThis.fetch=(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.protocol!=='data:'&&u.origin!==process.env.QA_ALLOWED_ORIGIN)throw Error('network denied');return original(input,init)};`);
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Seen = { path: string; method: string; body: any; authorization: string | null };
async function fixture<T>(action: (origin: string, calls: Seen[]) => Promise<T>, opts: { costs?: number[]; quoteStatus?: number; malformed?: boolean } = {}) {
  const calls: Seen[] = [];
  let quoteCount = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const path = new URL(req.url).pathname;
    const body = req.method === "POST" ? await req.json() : null;
    calls.push({ path, method: req.method, body, authorization: req.headers.get("authorization") });
    if (path.endsWith("/capabilities")) return Response.json({ contractVersion: 1, apiVersion: 1, capabilities: ["runs.submit"], billing: { unit: "credits", boundedRunApproval: true } });
    if (path.endsWith("/quote")) {
      const cost = opts.costs?.[quoteCount++] ?? opts.costs?.at(-1) ?? 25;
      return Response.json(opts.malformed ? { skill: "blog-article", pricing: { costCents: -1 } } : {
        skill: "blog-article", pricing: { costCents: cost, costCredits: cost, formattedCost: "$misleading" },
      }, { status: opts.quoteStatus ?? 200 });
    }
    if (path.endsWith("/billing/status")) return Response.json({ plan: "credits", balanceCents: 500, creditBalance: 500, balance: "$5.00", hasPaymentMethod: true });
    if (path.endsWith("/billing/credits")) return Response.json(req.method === "POST" ? { url: "https://checkout.example.test/session" } : [{ id: "credits_500", credits: 500, amountCents: 500, amount: "$5", expiresInDays: 90 }]);
    if (path.endsWith("/logs") || path.endsWith("/artifacts") || path.endsWith("/billing/usage") || path.endsWith("/billing/invoices")) return Response.json([]);
    if (path.includes("/runs/")) return Response.json({ id: runId, skill: "blog-article", status: "completed", exitCode: 0 });
    return Response.json({ code: "NOT_FOUND" }, { status: 404 });
  } });
  try { return await action(`http://127.0.0.1:${server.port}`, calls); } finally { await server.stop(true); }
}

async function cli(args: string[], origin: string, options: { key?: boolean; data?: string; profile?: string } = {}) {
  const cwd = options.data ?? mkdtempSync(join(scratch, "consumer-"));
  mkdirSync(cwd, { recursive: true });
  const env = {
    PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: scratch, TERM: "dumb", NO_COLOR: "1",
    HASNA_HOME: join(cwd, "hasna"), HASNA_CONFIG_HOME: join(cwd, "config"), HASNA_SKILLS_DIR: join(cwd, "data"),
    HASNA_STATION: "skills-public-account-no-keychain-entry", SKILLS_TEST_MODE: "1",
    ...(options.profile ? { HASNA_PROFILE: options.profile } : {}),
    HASNA_SKILLS_API_URL: origin, QA_ALLOWED_ORIGIN: new URL(origin).origin,
    ...(options.key === false ? {} : { HASNA_SKILLS_API_KEY_OVERRIDE: "fixture-key-not-a-secret" }),
  };
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, binary, ...args], { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stdout.length + stderr.length).toBeLessThan(128_000);
    expect(stdout + stderr).not.toContain("fixture-key-not-a-secret");
    if (!stdout) throw new Error(`CLI produced no JSON: ${stderr.slice(0, 1800)}`);
    return { stdout, stderr, exitCode, cwd };
  } finally { clearTimeout(timer); }
}

describe("built public CLI server account and spending", () => {
  test("CLI creation shares the portable scaffold, validates metadata and contains invalid names", async () => fixture(async (origin, calls) => {
    const description = 'Example: "quoted" text\nkind: instruction';
    const created = await cli(["create", "Public QA CLI", "--description", description, "--category", "Development Tools", "--tags", "qa,testing", "--json"], origin);
    expect(created.exitCode).toBe(0);
    const payload = JSON.parse(created.stdout);
    expect(payload).toMatchObject({ created: true, name: "public-qa-cli", category: "Development Tools", tags: ["qa", "testing"] });
    expect(JSON.parse(readFileSync(join(payload.path, "skill.json"), "utf8"))).toMatchObject({ description, tags: ["qa", "testing"] });
    const validation = await cli(["validate", "public-qa-cli", "--json"], origin, { data: created.cwd });
    expect(validation.exitCode).toBe(0);
    expect(JSON.parse(validation.stdout)).toMatchObject({ valid: true, issues: [] });
    const duplicate = await cli(["create", "public-qa-cli", "--json"], origin, { data: created.cwd });
    expect(duplicate.exitCode).toBe(1);
    const invalid = await cli(["create", "../escape", "--json"], origin, { data: created.cwd });
    expect(invalid.exitCode).toBe(1);
    expect(existsSync(join(created.cwd, "escape"))).toBe(false);
    expect(calls).toEqual([]);
  }));
  test("a new unauthenticated profile can finish setup without making a request", async () => fixture(async (origin, calls) => {
    const result = await cli(["setup", "--api-url", `${origin}/prefix/api/v1`, "--json"], `${origin}/prefix`, { key: false, profile: "new-customer" });
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload).toMatchObject({ saved: `${origin}/prefix`, apiUrl: `${origin}/prefix`, authenticated: false });
    expect(payload.error).toBeUndefined();
    expect(calls).toEqual([]);
    const status = await cli(["billing", "status", "--json"], `${origin}/prefix`, { key: false, profile: "new-customer", data: result.cwd });
    expect(status.exitCode).toBe(1);
    expect(calls).toEqual([]);
  }));
  test("fresh-profile interactive signup cancels before a request or credential write", async () => fixture(async (origin, calls) => {
    const cwd = mkdtempSync(join(scratch, "cancel-signup-"));
    const script = `import os,pty,select,time,signal,json,sys
pid,fd=pty.fork()
if pid==0:
 os.execv(sys.argv[1],sys.argv[1:])
seen=False; transcript=b""; status=None; deadline=time.monotonic()+8
try:
 while time.monotonic()<deadline:
  done,result=os.waitpid(pid,os.WNOHANG)
  if done: status=result; break
  if select.select([fd],[],[],0.05)[0]:
   try: chunk=os.read(fd,4096)
   except OSError: chunk=b""
   transcript+=chunk
   if len(transcript)>32768: raise RuntimeError("PTY output limit")
   if not seen and b"Email:" in transcript:
    seen=True; os.write(fd,b"\\x03")
 if status is None: os.killpg(pid,signal.SIGKILL); _,status=os.waitpid(pid,0)
 print(json.dumps({"code":os.waitstatus_to_exitcode(status),"prompt":seen,"bytes":len(transcript)}))
finally:
 try: os.killpg(pid,signal.SIGTERM)
 except ProcessLookupError: pass
 os.close(fd)
`;
    const child = Bun.spawn(["python3", "-c", script, process.execPath, "--no-env-file", "--preload", guard, binary, "auth", "signup"], {
      cwd, env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, TERM: "xterm-256color", NO_COLOR: "1", TMPDIR: scratch,
        HASNA_PROFILE: "cancel", HASNA_HOME: join(cwd,"hasna"), HASNA_CONFIG_HOME: join(cwd,"config"), HASNA_SKILLS_DIR: join(cwd,"data"),
        HASNA_SKILLS_API_URL: origin, HASNA_STATION: "skills-pty-no-keychain", QA_ALLOWED_ORIGIN: origin, SKILLS_TEST_MODE: "1" },
      stdin: "ignore", stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(stderr).toBe(""); expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ code: 130, prompt: true });
    expect(calls).toEqual([]);
    expect(existsSync(join(cwd, "config", "skills", "credentials-cancel"))).toBe(false);
  }));
  test("noninteractive auth validation never prompts or starts an unbounded device poll", async () => fixture(async (origin, calls) => {
    const signup = await cli(["auth", "signup", "--json"], origin, { key: false, profile: "fresh" });
    expect(signup.exitCode).toBe(1); expect(JSON.parse(signup.stdout).error).toContain("Email required");
    const device = await cli(["auth", "login", "--device", "--poll", "--poll-timeout-ms", "Infinity", "--json"], origin, { key: false });
    expect(device.exitCode).toBe(1); expect(JSON.parse(device.stdout).error).toContain("polling timeout");
    expect(calls).toEqual([]);
  }));
  test("quotes server-only skills without submission, preserving full API base prefixes", async () => fixture(async (origin, calls) => {
    const result = await cli(["quote", "--json", "blog-article", "--topic", "fixture"], `${origin}/instance/api/v1/`);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).pricing).toMatchObject({ costCredits: 25, formattedCost: "25 credits" });
    expect(calls.map(call => call.path)).toEqual(["/instance/api/v1/skills/blog-article/quote"]);
    expect(calls[0]?.body.args).toEqual(["--topic", "fixture"]);
  }));
  test("paid noninteractive execution requires approval before run metadata or submission", async () => fixture(async (origin, calls) => {
    const result = await cli(["run", "--remote", "--json", "blog-article", "--topic", "fixture"], origin);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain("CREDIT_APPROVAL_REQUIRED");
    expect(calls.every(call => call.path.endsWith("/quote"))).toBe(true);
    expect(existsSync(join(result.cwd, ".skills", "runs"))).toBe(false);
  }));
  test("approved server-only run sends its bounded credit ceiling and stable retry key", async () => fixture(async (origin, calls) => {
    const result = await cli(["run", "--remote", "--yes", "--json", "--idempotency-key", "approved-fixture", "blog-article", "--topic", "fixture"], origin);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).remoteRun.id).toBe(runId);
    const submissions = calls.filter(call => call.method === "POST" && call.path.includes("/runs/"));
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.body).toMatchObject({ maxCredits: 25, maxCostCents: 25, idempotencyKey: "approved-fixture", args: ["--topic", "fixture"] });
  }));
  test("a changed quote above the approved ceiling never submits", async () => fixture(async (origin, calls) => {
    const result = await cli(["run", "--remote", "--yes", "--json", "blog-article"], origin);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout).error).toContain("approved maximum");
    expect(calls.filter(call => call.path.includes("/runs/"))).toHaveLength(0);
  }, { costs: [25, 30] }));
  test("free remote execution does not require yes and declares a zero ceiling", async () => fixture(async (origin, calls) => {
    const result = await cli(["run", "--remote", "--json", "blog-article"], origin);
    expect(result.exitCode).toBe(0);
    expect(calls.find(call => call.path.includes("/runs/") && call.method === "POST")?.body.maxCredits).toBe(0);
  }, { costs: [0] }));
  test("missing or malformed quote fails closed without submission", async () => {
    for (const opts of [{ quoteStatus: 404 }, { malformed: true }]) await fixture(async (origin, calls) => {
      const result = await cli(["run", "--remote", "--yes", "--json", "blog-article"], origin);
      expect(result.exitCode).toBe(1);
      expect(calls.every(call => call.path.endsWith("/quote"))).toBe(true);
    }, opts);
  });
  test("billing and packs show credits while checkout only returns the selected external link", async () => fixture(async (origin, calls) => {
    const status = await cli(["billing", "status", "--json"], origin);
    expect(status.exitCode).toBe(0);
    expect(JSON.parse(status.stdout).formattedCreditBalance).toBe("500 credits");
    expect(status.stdout).not.toContain("$");
    const packs = await cli(["credits", "packs", "--json"], origin);
    expect(JSON.parse(packs.stdout)).toEqual([{ id: "credits_500", credits: 500, expiresInDays: 90 }]);
    const bought = await cli(["credits", "buy", "credits_500", "--json"], origin);
    expect(JSON.parse(bought.stdout).url).toBe("https://checkout.example.test/session");
    expect(calls.filter(call => call.method === "POST")).toEqual([expect.objectContaining({ body: { packId: "credits_500" } })]);
    const invalid = await cli(["credits", "buy", "credits_999", "--json"], origin);
    expect(invalid.exitCode).toBe(1);
    expect(calls.filter(call => call.method === "POST")).toHaveLength(1);
  }));
  test("direct SDK construction normalizes the same complete base and rejects unsafe URLs", async () => fixture(async (origin, calls) => {
    const client = new RemoteSkillsClient("sdk-fixture", `${origin}/prefix/api/v1/`);
    const quote = await client.quoteRun("blog-article");
    expect(quote.pricing.costCents).toBe(25);
    expect(calls[0]?.path).toBe("/prefix/api/v1/skills/blog-article/quote");
    for (const target of ["https://user:pass@example.test", "https://example.test?key=unsafe", "https://example.test/#fragment", "http://example.test"]) expect(() => new RemoteSkillsClient("unused", target)).toThrow();
  }));
});
