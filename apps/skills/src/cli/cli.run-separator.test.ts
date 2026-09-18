/** Real compiled CLI and synthetic, selected Python bundle; no provider credentials. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCliFixture } from "./cli-build.fixture.js";
import { packSkillBundle } from "../lib/skill-bundle.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();
const scratch = mkdtempSync(join(tmpdir(), "skills-run-separator-"));
const binary = join(scratch, "skills.js");
beforeAll(() => buildCliFixture(resolve(import.meta.dir, "index.tsx"), binary));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

async function fixture(managed: boolean, action: (f: { run: (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>; reads: string[] }) => Promise<void>) {
  const root = mkdtempSync(join(scratch, "case-"));
  const home = join(root, "home"), source = join(root, "source"), project = join(root, "project"), temp = join(root, "tmp");
  for (const path of [source, project, temp, join(home, ".hasna/skills/config")]) mkdirSync(path, { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "---\nname: argv-fixture\ndescription: Synthetic argument boundary fixture\nkind: executable\n---\nTest arguments only.\n");
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "argv-fixture", version: "1.0.0", skills: { kind: "executable" } }));
  writeFileSync(join(source, "skill.json"), JSON.stringify({ kind: "executable", runtime: { runtime: "python3", entrypoint: "main.py", timeout: 5 } }));
  writeFileSync(join(source, "main.py"), 'import argparse, json, os, sys\np = argparse.ArgumentParser(add_help=False)\np.add_argument("--intent", required=True)\nparsed, unknown = p.parse_known_args()\nprint(json.dumps({"args": sys.argv[1:], "intent": parsed.intent, "input": json.loads(os.environ["SKILLS_INPUT_JSON"])}))\n');
  const bundle = packSkillBundle(source), reads: string[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request): Response {
    const path = new URL(request.url).pathname; reads.push(path);
    const selection = { authority: server.url.origin + "/api/v1", workspaceId: "fixture", profileRevision: "fixture-revision", slug: "argv-fixture", version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}` };
    if (path === "/api/v1/profiles/fixture/resolve") return Response.json({ ...selection, profileId: "fixture", selections: [selection] });
    if (path === "/api/v1/skills/argv-fixture/versions/1.0.0/bundle") return new Response(bundle.bytes, { headers: { "X-Skill-Bundle-Sha256": bundle.sha256, "X-Skill-Version": "1.0.0" } });
    return Response.json({ error: "Unexpected fixture request" }, { status: 503 });
  } });
  writeFileSync(join(home, ".hasna/skills/config/credentials"), `HASNA_SKILLS_API_URL=${server.url.origin}\nHASNA_SKILLS_API_KEY=synthetic-argv-fixture\n`, { mode: 0o600 });
  if (managed) writeFileSync(join(home, ".hasna/skills/agent-policy.json"), JSON.stringify({ loading: "cli", profileId: "fixture" }));
  const env = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, USERPROFILE: home, HASNA_HOME: join(home, ".hasna"), HASNA_STATION: "fixture", TMPDIR: temp, NO_COLOR: "1", TERM: "dumb" };
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, "--no-env-file", binary, ...args], { cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
    try { const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]); return { stdout, stderr, exitCode }; }
    finally { clearTimeout(timer); }
  }
  try { await action({ run, reads }); } finally { server.stop(true); rmSync(root, { recursive: true, force: true }); }
}

for (const managed of [false, true]) test(`selected Python receives child flags after exactly one delimiter (managed=${managed})`, async () => {
  await fixture(managed, async ({ run }) => {
    const args = ["prepare", "--intent", "/synthetic/with spaces/intent.json", "--input", "not wrapper JSON", "--json", "--target", "child-only", "--selection-profile", "child-profile", "--secret-bindings", "child-file", "--cached", "--remote", "--no-color", "--profile", "child-account", "--help", "--version", "", "--", "--json", "a b\n雪"];
    const result = await run(["run", "argv-fixture", "--target", "local", "--skill-version", "1.0.0", "--selection-profile", "fixture", "--input", '{"wrapper":true}', "--json", "--", ...args]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout);
    expect(JSON.parse(receipt.stdout)).toEqual({ args, intent: args[2], input: { wrapper: true } });
    expect(receipt.target).toBe("local"); expect(receipt.selection.slug).toBe("argv-fixture");
  });
});

test("managed default keeps wrapper flags before the delimiter and legacy calls without a delimiter", async () => {
  await fixture(true, async ({ run }) => {
    for (const separated of [false, true]) {
      const args = ["prepare", "--intent", "intent.json"];
      const result = await run(["run", "--json", "argv-fixture", ...(separated ? ["--"] : []), ...args]);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(JSON.parse(JSON.parse(result.stdout).stdout)).toEqual({ args, intent: "intent.json", input: {} });
    }
  });
});

test("a wrapper option missing its value cannot consume the child side", async () => {
  await fixture(false, async ({ run, reads }) => {
    const result = await run(["run", "argv-fixture", "--target", "--", "local", "--intent", "intent.json"]);
    expect(result.exitCode).toBe(1); expect(JSON.parse(result.stdout).error).toBe("--target requires a value"); expect(reads).toEqual([]);
  });
});

test("a separator before the skill also protects every child argument", async () => {
  await fixture(true, async ({ run }) => {
    const args = ["prepare", "--intent", "intent.json", "--input", "child data", "--json", "--no-color", "--", "--target", "child-only"];
    const result = await run(["--no-color", "run", "--json", "--target", "local", "--", "argv-fixture", ...args]);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(JSON.parse(result.stdout).stdout)).toEqual({ args, intent: "intent.json", input: {} });
  });
});

test("global color handling preserves required short-cluster values", async () => {
  await fixture(false, async ({ run }) => {
    for (const args of [["list", "-pc", "--"], ["ls", "-pc--"], ["list", "-pc", "--no-color"]]) {
      const plain = await run(args), color = await run([...args, "--no-color"]);
      expect(color).toEqual(plain);
      expect(color.stderr).not.toContain("unknown option '--no-color'");
    }
  });
});
