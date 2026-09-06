import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createSkillRun, listSkillRuns } from "../lib/run-state.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

async function fixture(action: (run: (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>, requests: string[], root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "skills-cli-cursor-"));
  const requests: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url); requests.push(`${url.pathname}${url.search}`);
    return Response.json([{ id: "first-remote-run", status: "completed" }]);
  } });
  const guard = join(root, "network-guard.ts");
  await writeFile(guard, `const request=globalThis.fetch; globalThis.fetch=((input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));
    if(url.protocol!=="data:" && url.origin!==process.env.CURSOR_TEST_ORIGIN) throw new Error("Non-fixture network request blocked");
    return request(input,init);
  });`);
  const run = async (args: string[]) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, join(import.meta.dir, "index.tsx"), ...args], {
      cwd: root, stdout: "pipe", stderr: "pipe",
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HASNA_HOME: join(root, "home"),
        HASNA_SKILLS_DIR: join(root, "data"), HASNA_PROFILE: "cursor-test", HASNA_STATION: "cursor-test-no-keychain",
        HASNA_SKILLS_API_URL: server.url.origin, HASNA_SKILLS_API_KEY_OVERRIDE: "cursor-local-fixture",
        CURSOR_TEST_ORIGIN: server.url.origin, SKILLS_TEST_MODE: "1", NO_COLOR: "1" },
    });
    const timer = setTimeout(() => child.kill(), 15_000);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { stdout, stderr, exitCode };
    } finally { clearTimeout(timer); }
  };
  try { await action(run, requests, root); }
  finally { server.stop(true); await rm(root, { recursive: true, force: true }); }
}

test("remote runs reject nonzero and malformed cursors before requesting the first page", async () => {
  await fixture(async (run, requests) => {
    for (const json of [false, true]) for (const cursor of ["1", "-1", "1.5", "0.5", "garbage", "0oops", "Infinity", ""]) {
      const result = await run(["runs", "list", "--remote", "--limit", "1", "--cursor", cursor, ...(json ? ["--json"] : [])]);
      expect(result.exitCode).toBe(1);
      const error = json ? JSON.parse(result.stdout).error : result.stderr;
      expect(error).toContain("Remote runs do not support cursor pagination");
      expect(error).toContain("--cursor 0");
      expect(error).toContain("--limit");
      expect(result.stdout).not.toContain("first-remote-run");
      expect(requests).toEqual([]);
    }
  });
});

test("remote runs preserve the default and explicit zero cursor in human and JSON output", async () => {
  await fixture(async (run, requests) => {
    for (const json of [false, true]) for (const cursor of [[], ["--cursor", "0"]]) {
      const result = await run(["runs", "list", "--remote", "--limit", "1", ...cursor, ...(json ? ["--json"] : [])]);
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual([{ id: "first-remote-run", status: "completed" }]);
    }
    expect(requests).toEqual(Array(4).fill("/api/v1/runs?limit=1"));
  });
});

test("local human run pagination still advances through project run records", async () => {
  await fixture(async (run, requests, root) => {
    for (const skill of ["first-local", "second-local", "third-local"]) createSkillRun({ skill, status: "completed" }, root);
    const records = listSkillRuns(root, 3);
    expect(records).toHaveLength(3);
    for (const cursor of [0, 1]) {
      const result = await run(["runs", "list", "--limit", "1", "--cursor", String(cursor)]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(records[cursor]!.id);
      expect(result.stdout).not.toContain(records[1 - cursor]!.id);
      expect(result.stdout).toContain(`Next: skills runs list --cursor ${cursor + 1} --limit 1`);
    }
    expect(requests).toEqual([]);
  });
});
