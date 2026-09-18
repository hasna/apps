import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempRoot } from "../lib/test-temp-root.js";

const packageRoot = join(import.meta.dir, "../..");
const stamp = "2026-01-01T00:00:00.000Z";

async function exercise(args: string[], nativeSkill: boolean) {
  const home = makeTempRoot("instructions-skills-retirement-");
  const calls: string[] = [];
  const journal = join(home, "runtime-calls.jsonl");
  const marker = join(home, ".claude", "skills", "inbox", "SKILL.md");
  const target = join(home, "ordinary-config.txt");
  const profile = { id: "test-profile", slug: "test-profile", name: "Test profile", description: null,
    selectors: {}, variables: {}, created_at: stamp, updated_at: stamp };
  const config = { id: "test-config", slug: "test-config", name: "Test config", kind: "file", category: "other",
    agent: "global", target_path: target, outputs: [], format: "text", content: "synthetic configuration\n",
    description: null, tags: [], is_template: false, version: 1, created_at: stamp, updated_at: stamp, synced_at: null };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const path = new URL(request.url).pathname.replace(/^\/instructions\/v1/, "");
    calls.push(`${request.method} ${path}`);
    if (request.method === "GET" && path === "/profiles/resolve") return Response.json({ profile, scanned: 1, total: 1,
      batch_limit: 20, complete: true, truncated: false });
    if (request.method === "GET" && path === "/profiles") return Response.json({ profiles: [profile], count: 1 });
    if (request.method === "GET" && path === "/configs") return Response.json({ configs: [config], count: 1 });
    if (request.method === "PATCH" && path === "/configs/test-config") return Response.json({ config });
    if (request.method === "GET" && path === "/profiles/test-profile") return Response.json({ profile: { ...profile, configs: [config] } });
    return Response.json({ error: "unexpected synthetic request" }, { status: 400 });
  } });
  if (nativeSkill) {
    mkdirSync(join(home, ".claude", "skills", "inbox"), { recursive: true });
    writeFileSync(marker, "synthetic legacy payload\n");
  }
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "conversations"), `#!${process.execPath}
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(journal)}, JSON.stringify(args) + "\\n");
if (args[0] === "--version") console.log("0.5.28");
else if (args[0] === "watch") console.log("--from <agent> --all --full-content");
else if (args[0] === "agents" && args[1] === "heartbeat") console.log('{"ok":true}');
else process.exit(2);
`, { mode: 0o755 });
  const child = Bun.spawn([process.execPath, "src/cli/index.tsx", ...args], {
    cwd: packageRoot,
    env: { HOME: home, USER: "synthetic-test", PATH: `${bin}:${process.env.PATH}`, TMPDIR: process.env.TMPDIR,
      HASNA_STATE_HOME: join(home, "state"), HASNA_CONFIGS_HOME: join(home, "instructions"),
      HASNA_INSTRUCTIONS_API_URL: `http://127.0.0.1:${server.port}/instructions`,
      HASNA_INSTRUCTIONS_API_KEY: "synthetic-instructions-retirement-test", NO_COLOR: "1", FORCE_COLOR: "0",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" },
    stdout: "pipe", stderr: "pipe",
  });
  const timer = setTimeout(() => child.kill(), 20_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    return { exitCode, stdout, stderr, calls, runtimeCalls: existsSync(journal) ? readFileSync(journal, "utf8") : "",
      marker: existsSync(marker) ? readFileSync(marker, "utf8") : null,
      config: existsSync(target) ? readFileSync(target, "utf8") : null };
  } finally {
    clearTimeout(timer);
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
  }
}

describe("Instructions no longer owns native skill runtimes", () => {
  test("profile apply dry-run with --from neither invokes Conversations nor writes a config", async () => {
    const result = await exercise(["profile", "apply", "test-profile", "--dry-run", "--from", "synthetic-agent"], true);
    expect(result.runtimeCalls).toBe("");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.config).toBeNull();
    expect(result.marker).toBe("synthetic legacy payload\n");
    expect(result.calls.length).toBeGreaterThan(0);
    expect(result.calls.every((call) => call.startsWith("GET /profiles") || call === "GET /configs")).toBe(true);
  });

  test.each([true, false])("normal profile apply preserves native ownership (legacy marker: %s)", async (nativeSkill) => {
    const result = await exercise(["profile", "apply", "test-profile", "--from", "synthetic-agent"], nativeSkill);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.config).toBe("synthetic configuration\n");
    expect(result.marker).toBe(nativeSkill ? "synthetic legacy payload\n" : null);
    expect(result.runtimeCalls).toBe("");
    expect(result.calls.filter((call) => !call.startsWith("GET "))).toEqual(["PATCH /configs/test-config"]);
  });

  test("bootstrap preview has no implicit native skill repair or runtime invocation", async () => {
    const result = await exercise(["bootstrap", "--dry-run", "--from", "synthetic-agent"], true);
    expect(result.runtimeCalls).toBe("");
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.calls).toEqual([]);
    expect(result.config).toBeNull();
    expect(result.marker).toBe("synthetic legacy payload\n");
  });

  test.each(["status", "apply"])("deprecated managed-skills %s reports migration without runtime writes", async (command) => {
    const result = await exercise(["managed-skills", command, "--from", "synthetic-agent", "--delivery-verified", "--json"], true);
    expect(result.runtimeCalls).toBe("");
    expect(result.exitCode).toBe(1);
    expect(result.calls).toEqual([]);
    expect(result.marker).toBe("synthetic legacy payload\n");
    expect(JSON.parse(result.stdout).runtimes[0]).toMatchObject({ hosted_heartbeat: "unverified", healthy: false });
    expect(JSON.parse(result.stdout).runtimes[0].reason).toContain("Skills CLI");
  });
});
