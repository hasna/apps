import { expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emailsSelfHostedOpenApi } from "../../server/self-hosted/openapi.js";

async function fixture(args: string[], options: { old?: boolean; watch?: boolean; partial?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "emails-sync-cli-"));
  const key = crypto.randomUUID();
  const posts: unknown[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    if (req.headers.get("authorization") !== `Bearer ${key}`) return new Response("auth", { status: 401 });
    const url = new URL(req.url);
    if (url.pathname === "/v1/openapi.json") return Response.json(options.old ? { ...emailsSelfHostedOpenApi, paths: {} } : emailsSelfHostedOpenApi);
    if (url.pathname === "/v1/providers") return Response.json({ items: Number(url.searchParams.get("offset") ?? 0) > 0 ? [] : [{ id: "p-one", name: "first", type: "resend", active: true }] });
    if (req.method === "POST" && url.pathname === "/v1/providers/p-one/sync") {
      posts.push(await req.json());
      return Response.json({ provider_id: "p-one", status: options.partial ? "partial" : "synced", checked: 1, synced: 1, contacts_updated: 0, unattributed_contact_events: 0, complete: !options.partial, next_cursor: null, failures: options.partial ? [{ message_id: "missing", error: "provider unavailable" }] : [], historical_events_complete: false, scope: "known_provider_messages", note: "Current provider observations." });
    }
    return new Response("not found", { status: 404 });
  } });
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("EMAILS_") && !name.startsWith("HASNA_EMAILS_")));
  Object.assign(env, { HOME: home, HASNA_HOME: home, EMAILS_HOME: home, HASNA_EMAILS_HOME: home, HASNA_EMAILS_API_URL: server.url.origin, EMAILS_SESSION_TOKEN: key, HASNA_EMAILS_API_KEY: key, NO_COLOR: "1" });
  const child = Bun.spawn({ cmd: [process.execPath, "run", "src/cli/index.tsx", ...args, "--json"], env, stdout: "pipe", stderr: "pipe" });
  let timer: ReturnType<typeof setInterval> | undefined;
  if (options.watch) timer = setInterval(() => { if (posts.length) child.kill("SIGINT"); }, 30);
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { code, stdout, stderr, posts };
  } finally { if (timer) clearInterval(timer); child.kill(); server.stop(true); rmSync(home, { recursive: true, force: true }); }
}
it("provider sync and pull call the API with automatic credentials", async () => {
  for (const args of [["provider", "sync", "--provider", "p-one"], ["pull"]]) {
    const result = await fixture(args);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, providers: [{ provider_id: "p-one", checked: 1, synced: 1 }] });
    expect(result.posts).toEqual([{ limit: 10 }]);
  }
});
it("old APIs receive no sync POST and partial results fail honestly", async () => {
  const old = await fixture(["pull"], { old: true });
  expect(old.code).toBe(1);
  expect(old.posts).toEqual([]);
  expect(old.stderr).toContain("API needs an update");
  const partial = await fixture(["pull"], { partial: true });
  expect(partial.code).toBe(1);
  expect(JSON.parse(partial.stdout).ok).toBe(false);
});
it("pull watch exits promptly on SIGINT during a long interval", async () => {
  const result = await fixture(["pull", "--watch", "--interval", "1h"], { watch: true });
  expect(result.code).toBe(0);
  expect(result.posts).toHaveLength(1);
}, 15000);
