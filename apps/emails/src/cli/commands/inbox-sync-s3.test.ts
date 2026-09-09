import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emailsSelfHostedOpenApi } from "../../server/self-hosted/openapi.js";

async function fixture(args: string[], options: { old?: boolean; interrupt?: boolean; partial?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "emails-ingest-cli-"));
  const key = crypto.randomUUID(); const posts: any[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    if (req.headers.get("authorization") !== `Bearer ${key}`) return new Response("auth", { status: 401 });
    const path = new URL(req.url).pathname;
    if (path === "/v1/openapi.json") return Response.json(options.old ? { ...emailsSelfHostedOpenApi, paths: {} } : emailsSelfHostedOpenApi);
    if (req.method === "POST" && ["/v1/inbox/sync-s3", "/v1/inbox/watch"].includes(path)) {
      posts.push(await req.json());
      const next = path.endsWith("sync-s3") && posts.length === 1 ? "page-two" : null;
      return Response.json({ ok: !options.partial, sources: [{ source_id: "source", scanned: 1, ingested: 1, duplicate: 0, error: options.partial ? 1 : 0, notifications: 1, acknowledged: 1, next_cursor: next, complete: !next && !options.partial, queue: null }] });
    }
    return new Response("not found", { status: 404 });
  } });
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("EMAILS_") && !name.startsWith("HASNA_EMAILS_")));
  Object.assign(env, { HOME: home, HASNA_HOME: home, EMAILS_HOME: home, HASNA_EMAILS_HOME: home, HASNA_EMAILS_API_URL: server.url.origin, EMAILS_SESSION_TOKEN: key, HASNA_EMAILS_API_KEY: key, NO_COLOR: "1" });
  const child = Bun.spawn({ cmd: [process.execPath, "run", "src/cli/index.tsx", "inbox", ...args, "--json"], env, stdout: "pipe", stderr: "pipe" });
  const timer = options.interrupt ? setInterval(() => { if (posts.length) child.kill("SIGINT"); }, 30) : undefined;
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr, posts };
  } finally { if (timer) clearInterval(timer); child.kill(); server.stop(true); rmSync(home, { recursive: true, force: true }); }
}
it("sync-s3 uses saved API credentials and aggregates pages into one JSON result", async () => {
  const result = await fixture(["sync-s3", "--source", "source", "--limit", "2"]);
  expect(result.code).toBe(0); expect(result.stderr).toBe("");
  expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, sources: [{ scanned: 2, ingested: 2, next_cursor: null }] });
  expect(result.posts).toEqual([{ source_id: "source", limit: 2 }, { source_id: "source", cursor: "page-two", limit: 1 }]);
});
it("watch once performs actual queue API polling and continuous watch can be interrupted", async () => {
  const once = await fixture(["watch", "--once"]); expect(once.code).toBe(0); expect(once.posts).toHaveLength(1);
  expect(JSON.parse(once.stdout).sources[0].acknowledged).toBe(1);
  const loop = await fixture(["watch"], { interrupt: true }); expect(loop.code).toBe(0); expect(loop.posts.length).toBeGreaterThan(0);
}, 15000);
it("old APIs receive no ingest POST and partial ingestion exits unsuccessfully", async () => {
  const old = await fixture(["sync-s3"], { old: true }); expect(old.code).toBe(1); expect(old.posts).toEqual([]); expect(old.stderr).toContain("API needs an update");
  const partial = await fixture(["sync-s3"], { partial: true }); expect(partial.code).toBe(1); expect(JSON.parse(partial.stdout).ok).toBe(false); expect(partial.posts).toHaveLength(1);
});
