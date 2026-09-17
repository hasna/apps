import { afterAll, beforeAll, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { MAX_PROFILE_SELECTIONS, MAX_PROFILE_DOCUMENT_BYTES, MAX_RESOLVED_PROFILE_BYTES } from "../lib/profile-limits.js";

useDefaultTestTimeout();
const root = mkdtempSync(join(tmpdir(), "skills-capacity-cli-")), binary = join(root, "skills.js");
beforeAll(async () => { await buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary); });
afterAll(() => rmSync(root, { recursive: true, force: true }));

test.skipIf(process.platform === "win32")("compiled profiles set refuses a FIFO without waiting for a writer or accessing the network", async () => {
  const home = join(root, "fifo-home"), fifo = join(root, "profile.fifo"); mkdirSync(home);
  const made = Bun.spawnSync(["mkfifo", fifo], { env: { PATH: "/usr/bin:/bin" }, stdout: "pipe", stderr: "pipe" });
  expect(made.exitCode).toBe(0);
  let reads = 0, timedOut = false;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() { reads++; return Response.json({}); } });
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: join(home, ".hasna/skills"), HASNA_SKILLS_API_KEY: "fixture-capacity", HASNA_SKILLS_API_URL: server.url.origin, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  const child = Bun.spawn([process.execPath, "--no-env-file", binary, "profiles", "set", "fleet", "--file", fifo, "--json"], { cwd: home, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 2_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect(timedOut).toBe(false);
    expect(exitCode).toBe(1); expect(stdout).toBe(""); expect(stderr).toContain("not a regular file"); expect(reads).toBe(0);
  } finally { clearTimeout(timeout); server.stop(true); }
});

test("compiled profiles commands roundtrip large snapshots and refuse oversized UTF8 before network access", async () => {
  const home = join(root, "home"); mkdirSync(home);
  const selections = Array.from({ length: MAX_PROFILE_SELECTIONS }, (_, i) => ({ slug: `guide-${i}`, version: "1.0.0", bundleDigest: `sha256:${"a".repeat(64)}`, triggers: { keywords: ["x".repeat(256)] } }));
  const snapshot = { id: "fleet", workspaceId: "workspace", revision: "one", updatedAt: "2026-09-13T00:00:00.000Z", selections };
  let writes = 0, reads = 0;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, maxRequestBodySize: MAX_PROFILE_DOCUMENT_BYTES, async fetch(request) {
    reads++;
    if (new URL(request.url).pathname.endsWith("/capabilities")) return Response.json({ profileLimits: { maxSelections: MAX_PROFILE_SELECTIONS, maxDocumentBytes: MAX_PROFILE_DOCUMENT_BYTES, maxResolvedProfileBytes: MAX_RESOLVED_PROFILE_BYTES, requestBodyLimitBytes: MAX_PROFILE_DOCUMENT_BYTES } });
    if (request.method === "PUT") { writes++; expect((await request.json() as any).selections).toEqual(selections); if (writes === 2) expect(request.headers.get("if-match")).toBe('"one"'); }
    return Response.json(snapshot);
  } });
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_SKILLS_DIR: join(home, ".hasna/skills"), HASNA_SKILLS_API_KEY: "fixture-capacity", HASNA_SKILLS_API_URL: server.url.origin, NO_COLOR: "1", BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" };
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: home, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    const timeout = setTimeout(() => child.kill("SIGKILL"), 12_000);
    try { const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { stdout, stderr, exitCode }; }
    finally { clearTimeout(timeout); }
  }
  try {
    const file = join(root, "profile.json"), saved = join(root, "saved.json"); writeFileSync(file, JSON.stringify({ selections }));
    expect(statSync(file).size).toBeGreaterThan(1_000_000);
    let result = await run(["profiles", "set", "fleet", "--file", file, "--json"]);
    expect(result.exitCode).toBe(0); expect(result.stderr).toBe(""); expect(JSON.parse(result.stdout)).toEqual(snapshot);
    result = await run(["profiles", "show", "fleet", "--save", saved, "--json"]);
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout)).toEqual(snapshot);
    expect(JSON.parse(readFileSync(saved, "utf8"))).toEqual(snapshot); expect(statSync(saved).mode & 0o777).toBe(0o600);
    result = await run(["profiles", "set", "fleet", "--file", saved, "--if-match", "one", "--json"]);
    expect(result.exitCode).toBe(0); expect(writes).toBe(2);
    const priorReads = reads;
    writeFileSync(file, JSON.stringify({ selections: [], padding: "界".repeat(3_000_000) }));
    expect(readFileSync(file, "utf8").length).toBeLessThan(MAX_PROFILE_DOCUMENT_BYTES);
    result = await run(["profiles", "set", "fleet", "--file", file, "--json"]);
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain("size limit"); expect(reads).toBe(priorReads);
    writeFileSync(file, JSON.stringify({ selections: [...selections, { ...selections[0], slug: "extra" }] }));
    result = await run(["profiles", "set", "fleet", "--file", file, "--json"]);
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain("4096"); expect(reads).toBe(priorReads);
  } finally { server.stop(true); }
});
