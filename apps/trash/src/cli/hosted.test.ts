import { afterEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createSandbox, spawnEnv, type Sandbox } from "../testing/sandbox.js";
const CLI = new URL("./index.ts", import.meta.url).pathname;
const sandboxes: Sandbox[] = [];
afterEach(() => { for (const sandbox of sandboxes.splice(0)) sandbox.cleanup(); });
async function run(args: string[]) {
  const sandbox = createSandbox(); sandboxes.push(sandbox); const source = sandbox.file("work/source", "must survive");
  const env = spawnEnv(sandbox, { HASNA_TRASH_LOCAL: undefined, HASNA_HOME: sandbox.path("isolated-hasna") });
  const child = Bun.spawn({ cmd: [process.execPath, CLI, "--spool", sandbox.path("spool"), ...args.map((value) => value === "SOURCE" ? source : value)], cwd: sandbox.root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  return { code, stdout, stderr, source, sandbox };
}
test("default CLI metadata reads fail closed without hosted configuration and create no local index", async () => {
  const result = await run(["--json", "list"]);
  expect(result.code).toBe(1); expect(existsSync(result.sandbox.path("spool"))).toBe(false);
});
test("default guard refuses deletion without hosted credentials even when spool and force are supplied", async () => {
  const result = await run(["guard", "-rf", "SOURCE"]);
  expect(result.code).toBe(2); expect(readFileSync(result.source, "utf8")).toBe("must survive");
  expect(existsSync(result.sandbox.path("spool"))).toBe(false);
});
test("hosted guard no-op and planning remain credential-free", async () => {
  expect((await run(["guard", "-f"])).code).toBe(0);
  const result = await run(["guard", "--plan", "rm -rf ./build"]);
  expect(result.code).toBe(0); expect(JSON.parse(result.stdout).command).toContain("trash guard");
  expect(existsSync(result.sandbox.path("spool"))).toBe(false);
});

test("Backup capsule recovery works without credentials and never overwrites an occupied target", async () => {
  const { createCapsule } = await import("../capsule.js");
  const { runHostedCli } = await import("./hosted.js");
  const sandbox = createSandbox(); sandboxes.push(sandbox);
  const source = sandbox.file("work/backup-source", "backup original"); const capsule = sandbox.path("backup.capsule"); createCapsule(source, capsule);
  const target = sandbox.path("work/restored"); let output = "";
  const runtime = { env: { HOME: sandbox.path("home") }, stdout: (text: string) => { output += text; }, stderr: (_text: string) => {} };
  const request = { verb: "restore-capsule", rest: [capsule, "--to", target], flags: { json: true }, guard: null };
  expect(await runHostedCli(request, runtime)).toBe(0); expect(readFileSync(target, "utf8")).toBe("backup original");
  expect(JSON.parse(output).restoredTo).toBe(target);
  expect(await runHostedCli(request, runtime)).toBe(1); expect(readFileSync(target, "utf8")).toBe("backup original");
  expect(await runHostedCli({ ...request, rest: [capsule, "--to", "/"] }, runtime)).toBe(1);
});
