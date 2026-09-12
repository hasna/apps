import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packSkillBundle } from "./skill-bundle.js";
import { resolveSelectedRun, executeSelectedLocal } from "./selected-run.js";
import type { ProfileClient } from "./profile-client.js";
import type { ResolvedSkillSelection } from "../types/skill-selection.js";
import { useDefaultTestTimeout } from "../test-preload.js";
useDefaultTestTimeout();
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function directory() { const root = mkdtempSync(join(tmpdir(), "selected-run-test-")); roots.push(root); return root; }
async function fixture(code = 'console.log("exact-v1")', runtime: Record<string, unknown> = {}, pkg: Record<string, unknown> = {}, kind = "executable") {
  const source = directory(), cacheDir = directory();
  mkdirSync(join(source, "src")); mkdirSync(join(source, "assets"));
  writeFileSync(join(source, "SKILL.md"), `---\nname: selected-run\ndescription: selected runner\nkind: ${kind}\n---\nExact published body.`);
  writeFileSync(join(source, "skill.json"), JSON.stringify({ kind, runtime: { runtime: "bun", entrypoint: "src/main.ts", ...runtime } }));
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "selected-run", version: "1.0.0", ...pkg }));
  writeFileSync(join(source, "src/main.ts"), code); writeFileSync(join(source, "assets/value.txt"), "exact-asset-v1");
  const bundle = packSkillBundle(source);
  const selection: ResolvedSkillSelection = { authority: "https://skills.example.com/api/v1", workspaceId: "workspace", profileRevision: "revision", slug: "selected-run", version: "1.0.0", bundleDigest: `sha256:${bundle.sha256}` };
  const client: ProfileClient = { authority: selection.authority, resolveProfile: async () => ({ authority: selection.authority, workspaceId: selection.workspaceId, profileId: "engineering", profileRevision: selection.profileRevision, selections: [selection] }), getBundle: async () => new Response(bundle.bytes), recordStation: async () => { throw new Error("unused"); } };
  return { resolved: await resolveSelectedRun("selected-run@1.0.0", "engineering", { cacheDir, client }), source, cacheDir };
}
test("local execution uses exact verified source and assets, declared JSON input, and no ambient credential", async () => {
  const previous = process.env.SELECTED_TEST_AMBIENT; process.env.SELECTED_TEST_AMBIENT = "fixture-private-value";
  try {
    const f = await fixture('console.log(JSON.stringify({asset: await Bun.file("assets/value.txt").text(), input: JSON.parse(process.env.SKILLS_INPUT_JSON!), ambient: process.env.SELECTED_TEST_AMBIENT ?? null, arg: process.argv[2]}))');
    writeFileSync(join(f.source, "src/main.ts"), 'throw new Error("mutable draft must not execute")');
    f.resolved.entries.find(entry => entry.path === "src/main.ts")!.bytes.fill(0);
    const result = await executeSelectedLocal(f.resolved, { input: { requested: 1 }, args: ["expected-argument"] }); roots.push(result.runDirectory);
    expect(result.exitCode).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ asset: "exact-asset-v1", input: { requested: 1 }, ambient: null, arg: "expected-argument" });
    expect(readFileSync(join(result.runDirectory, "assets/value.txt"), "utf8")).toBe("exact-asset-v1");
    expect(readFileSync(join(result.runDirectory, ".execution-receipt.json"), "utf8")).not.toContain("fixture-private-value");
    expect(result.selection.version).toBe("1.0.0"); expect(result.inputDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
  } finally { if (previous === undefined) delete process.env.SELECTED_TEST_AMBIENT; else process.env.SELECTED_TEST_AMBIENT = previous; }
});
test("local execution fails closed for instruction skills, unenforced isolation, and dependency installation", async () => {
  await expect(executeSelectedLocal((await fixture("", {}, {}, "instruction")).resolved)).rejects.toMatchObject({ code: "INSTRUCTION_SKILL" });
  await expect(executeSelectedLocal((await fixture("", { sandbox: "read-only" })).resolved)).rejects.toMatchObject({ code: "LOCAL_SANDBOX_REQUIRED" });
  await expect(executeSelectedLocal((await fixture("", { needs_network: false })).resolved)).rejects.toMatchObject({ code: "LOCAL_SANDBOX_REQUIRED" });
  await expect(executeSelectedLocal((await fixture("", {}, { dependencies: { example: "1.0.0" }, scripts: { postinstall: "never-run" } })).resolved)).rejects.toMatchObject({ code: "LOCAL_DEPENDENCY_BUILD_REQUIRED" });
  await expect(executeSelectedLocal((await fixture("", { env: ["DECLARED_FIXTURE"] })).resolved)).rejects.toMatchObject({ code: "LOCAL_ENV_REQUIRED" });
});
test("local execution enforces its deadline and bounded output", async () => {
  const timeout = await executeSelectedLocal((await fixture("setInterval(() => {}, 1000)")).resolved, { timeoutMs: 100 }); roots.push(timeout.runDirectory);
  expect(timeout.exitCode).toBe(124); expect(timeout.error).toBe("LOCAL_RUN_TIMEOUT");
  const overflow = await executeSelectedLocal((await fixture('process.stdout.write("x".repeat(2 * 1024 * 1024))')).resolved); roots.push(overflow.runDirectory);
  expect(overflow.exitCode).toBe(1); expect(overflow.error).toBe("LOCAL_RUN_OUTPUT_LIMIT"); expect(Buffer.byteLength(overflow.stdout)).toBeLessThanOrEqual(1024 * 1024);
});
