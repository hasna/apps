import { expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hash, type Plan } from "../../affected-shards";

const repo = resolve(import.meta.dir, "../../../.."), cli = join(repo, "tooling/ci/run-affected-shards.ts"), turbo = join(repo, "node_modules/.bin/turbo");
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
function write(p: string, value: unknown) { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(value, null, 2) + "\n"); }
async function run(cwd: string, argv: string[], extra: Record<string, string> = {}) {
  const child = Bun.spawn(argv, { cwd, env: { PATH: process.env.PATH!, HOME: join(cwd, "home"), TMPDIR: join(cwd, "tmp"), LANG: "C", TURBO_TELEMETRY_DISABLED: "1", ...extra }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code };
}
async function good(cwd: string, argv: string[], extra: Record<string, string> = {}) {
  const out = await run(cwd, argv, extra); expect(out.code, out.stderr + out.stdout).toBe(0); return out.stdout.trim();
}
async function fixture(root: string) {
  mkdirSync(join(root, "home"), { recursive: true }); mkdirSync(join(root, "tmp"));
  write(join(root, "package.json"), { name: "affected-fixture", private: true, packageManager: "bun@1.3.14", workspaces: ["apps/*", "apps/notes/server"] });
  write(join(root, "turbo.json"), { tasks: { build: { dependsOn: ["^build"], outputs: ["dist/**"] }, test: { dependsOn: ["build"], outputs: [], env: ["OBSERVED_FILE", "INJECT_FAILURE"] } } });
  writeFileSync(join(root, ".gitignore"), "node_modules\n.turbo\ndist\nhome\ntmp\n");
  for (const [name, dir] of [["contracts", "contracts"], ["todos", "todos"], ["skills", "skills"], ["emails", "emails"], ["recordings", "recordings"], ["notes", "notes"], ["notes-server", "notes/server"]]) {
    const directory = join(root, "apps", dir!); mkdirSync(directory, { recursive: true });
    write(join(directory, "package.json"), { name: name === "notes-server" ? name : `@hasna/${name}`, version: "1.0.0", scripts: {
      ...(name!.startsWith("notes") ? {} : { build: 'bun -e \'require("node:fs").mkdirSync("dist",{recursive:true});require("node:fs").writeFileSync("dist/result","built")\'' }),
      test: "bun run test:serial", "test:serial": "bun check.ts",
    }, ...(name === "skills" || name === "todos" ? { dependencies: { "@hasna/contracts": "workspace:*" } } : {}) });
    writeFileSync(join(directory, "check.ts"), `import {appendFileSync} from "node:fs"; appendFileSync(process.env.OBSERVED_FILE!, ${JSON.stringify(name + "\n")}); if(process.env.INJECT_FAILURE===${JSON.stringify(name)}) process.exit(7);\n`);
  }
  write(join(root, "tooling/ci/affected-test-durations.json"), json(join(repo, "tooling/ci/affected-test-durations.json")));
  await good(root, [process.execPath, "install", "--ignore-scripts"]);
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true }); symlinkSync(turbo, join(root, "node_modules/.bin/turbo"));
  // Synthetic commits are fixture data only; never change the caller's Git identity or hooks.
  await good(root, ["git", "init", "-q", "-b", "fixture-head"]);
  await good(root, ["git", "config", "user.name", "affected-ci-fixture"]);
  await good(root, ["git", "config", "user.email", "fixture@example.test"]);
  await good(root, ["git", "config", "core.hooksPath", "/dev/null"]);
  await good(root, ["git", "config", "commit.gpgsign", "false"]);
  await good(root, ["git", "add", "."]);
  await good(root, ["git", "commit", "-qm", "Owned affected CI fixture\n\nAgent: codex-skills-launch-20260907"]);
  const pkg = json(join(root, "package.json")); pkg.description = "root change selects every member"; write(join(root, "package.json"), pkg);
  await good(root, ["git", "add", "package.json"]); await good(root, ["git", "commit", "-qm", "Owned root change fixture\n\nAgent: codex-skills-launch-20260907"]);
  const head = await good(root, ["git", "rev-parse", "HEAD"]);
  return { GITHUB_SHA: head, GITHUB_REPOSITORY: "hasna/apps", GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", GITHUB_EVENT_NAME: "push" };
}
test("pinned Turbo executes every assigned fixture task exactly once across isolated roots and refuses injected failure", async () => {
  const owned = mkdtempSync(join(tmpdir(), "affected-runtime-"));
  try {
    const source = join(owned, "source"), planDir = join(owned, "plan"), receiptRoot = join(owned, "receipts");
    const env = await fixture(source); await good(source, [process.execPath, cli, "plan", planDir], env);
    const planPath = join(planDir, "plan.json"), plan: Plan = json(planPath), sha = hash(readFileSync(planPath));
    expect(plan.testGraph.filter(t => t.task === "test")).toHaveLength(7);
    expect(plan.buildGraph.filter(t => t.command === null).map(t => t.taskId)).toEqual(["@hasna/notes#build", "notes-server#build"]);
    const observed: string[] = [];
    for (const shard of plan.shards) {
      const work = join(owned, `runner-${shard.id}`), out = join(receiptRoot, String(shard.id)), seen = join(owned, `observed-${shard.id}`);
      cpSync(source, work, { recursive: true });
      await good(work, [process.execPath, cli, "shard", planPath, sha, String(shard.id), out], { ...env, OBSERVED_FILE: seen });
      const receipt = json(join(out, "receipt.json")); expect(receipt.status).toBe("passed");
      observed.push(...readFileSync(seen, "utf8").trim().split("\n"));
    }
    expect(observed.sort()).toEqual(["contracts", "emails", "notes", "notes-server", "recordings", "skills", "todos"]);
    await good(source, [process.execPath, cli, "aggregate", planPath, sha, receiptRoot, "success", join(owned, "aggregate.json")], env);
    expect(json(join(owned, "aggregate.json")).tests).toEqual(plan.testGraph.filter(t => t.task === "test").map(t => t.taskId));

    const selected = plan.shards.find(s => s.tests.includes("@hasna/skills#test"))!, failedRoot = join(owned, "failed-runner"), failedOut = join(owned, "failed-receipt");
    cpSync(source, failedRoot, { recursive: true });
    const failed = await run(failedRoot, [process.execPath, cli, "shard", planPath, sha, String(selected.id), failedOut], { ...env, OBSERVED_FILE: join(owned, "failed-observed"), INJECT_FAILURE: "skills" });
    expect(failed.code).not.toBe(0); expect(json(join(failedOut, "receipt.json")).status).toBe("failed");
    rmSync(join(receiptRoot, String(selected.id)), { recursive: true }); cpSync(failedOut, join(receiptRoot, String(selected.id)), { recursive: true });
    const rejected = await run(source, [process.execPath, cli, "aggregate", planPath, sha, receiptRoot, "success", join(owned, "must-not-accept.json")], env);
    expect(rejected.code).not.toBe(0); expect(readdirSync(owned)).not.toContain("must-not-accept.json");
    // No other job can silently re-resolve a moved base/head or alter plan bytes.
    expect((await run(source, [process.execPath, cli, "aggregate", planPath, "f".repeat(64), receiptRoot, "success", join(owned, "wrong.json")], env)).code).not.toBe(0);
  } finally { rmSync(owned, { recursive: true, force: true }); }
}, 120_000);

test("pinned Turbo empty affected graph still produces and verifies four real no-op receipts", async () => {
  const owned = mkdtempSync(join(tmpdir(), "affected-empty-"));
  try {
    const source = join(owned, "source"), env = await fixture(source);
    await good(source, ["git", "update-ref", "refs/remotes/origin/owned-empty", env.GITHUB_SHA]);
    const emptyEnv = { ...env, GITHUB_EVENT_NAME: "pull_request", GITHUB_BASE_REF: "owned-empty" }, planDir = join(owned, "plan");
    await good(source, [process.execPath, cli, "plan", planDir], emptyEnv);
    const path = join(planDir, "plan.json"), plan: Plan = json(path), sha = hash(readFileSync(path)); expect(plan.buildGraph).toEqual([]); expect(plan.testGraph).toEqual([]);
    const receipts = join(owned, "receipts");
    for (const shard of plan.shards) { const copy = join(owned, `runner-${shard.id}`); cpSync(source, copy, { recursive: true }); await good(copy, [process.execPath, cli, "shard", path, sha, String(shard.id), join(receipts, String(shard.id))], emptyEnv); }
    await good(source, [process.execPath, cli, "aggregate", path, sha, receipts, "success", join(owned, "accepted.json")], emptyEnv);
    expect(json(join(owned, "accepted.json")).tests).toEqual([]);
    rmSync(join(receipts, "3"), { recursive: true }); expect((await run(source, [process.execPath, cli, "aggregate", path, sha, receipts, "success", join(owned, "missing.json")], emptyEnv)).code).not.toBe(0);
  } finally { rmSync(owned, { recursive: true, force: true }); }
}, 120_000);
