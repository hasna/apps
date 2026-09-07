import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emailsSelfHostedOpenApi } from "../../server/self-hosted/openapi.js";
async function fixture(options: { partial?: boolean; old?: boolean; extra?: string[] } = {}) {
  const home = mkdtempSync(join(tmpdir(), "emails-realtime-cli-")), key = crypto.randomUUID();
  const posts: unknown[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    if (req.headers.get("authorization") !== `Bearer ${key}`) return new Response("unauthorized", { status: 401 });
    if (new URL(req.url).pathname === "/v1/openapi.json") return Response.json(options.old ? { paths: {} } : emailsSelfHostedOpenApi);
    if (req.method === "POST" && new URL(req.url).pathname === "/v1/inbox/setup-realtime") {
      posts.push(await req.json());
      return Response.json({ ok: !options.partial, verified: !options.partial, source_id: "source", changed: ["queue_policy"], worker_started: false, delivery_tested: false, ...(options.partial ? { stage: "readback" } : {}) }, { status: options.partial ? 502 : 200 });
    }
    return new Response("not found", { status: 404 });
  } });
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("EMAILS_") && !name.startsWith("HASNA_EMAILS_")));
  Object.assign(env, { HOME: home, HASNA_HOME: home, EMAILS_HOME: home, HASNA_EMAILS_HOME: home, HASNA_EMAILS_API_URL: server.url.origin, EMAILS_SESSION_TOKEN: key, HASNA_EMAILS_API_KEY: key, NO_COLOR: "1" });
  const child = Bun.spawn({ cmd: [process.execPath, "run", "src/cli/index.tsx", "inbox", "setup-realtime", "example.com", "--source", "source", "--rule-set", "bound-rules", "--rule", "bound-rule", "--region", "us-east-1", ...(options.extra ?? []), "--json"], env, stdout: "pipe", stderr: "pipe" });
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr, posts };
  } finally { child.kill(); server.stop(true); rmSync(home, { recursive: true, force: true }); }
}
test("setup-realtime forwards all selectors using saved API credentials and a verified receipt", async () => {
  const result = await fixture();
  expect(result.code).toBe(0);
  expect(result.posts).toEqual([{ domain: "example.com", source_id: "source", rule_set: "bound-rules", rule_name: "bound-rule", region: "us-east-1" }]);
  expect(JSON.parse(result.stdout)).toMatchObject({ verified: true, worker_started: false, delivery_tested: false });
});
test("partial setup returns observable applied steps and unsuccessful exit; old APIs receive no mutation", async () => {
  const partial = await fixture({ partial: true });
  expect(partial.code).toBe(1);
  expect(JSON.parse(partial.stdout)).toMatchObject({ verified: false, stage: "readback", changed: ["queue_policy"] });
  const old = await fixture({ old: true });
  expect(old.code).toBe(1); expect(old.posts).toEqual([]); expect(old.stderr).toContain("No setup request");
});

test("blank explicit legacy selectors fail before any setup POST", async () => {
  for (const option of ["--source", "--profile", "--rule", "--rule-set", "--region"]) {
    const result = await fixture({ extra: [option, ""] });
    expect(result.code).toBe(1);
    expect(result.posts).toEqual([]);
    expect(result.stderr).toContain("must not be blank");
  }
});
