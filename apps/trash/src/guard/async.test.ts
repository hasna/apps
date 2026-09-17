import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runGuardAsync } from "./run.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const root = realpathSync(mkdtempSync(join(tmpdir(), "trash-async-guard-"))); roots.push(root); writeFileSync(join(root, "file"), "fixture"); return root; }

test("the asynchronous guard waits for verified capture before reporting removal", async () => {
  const root = fixture(); const output: string[] = []; let captured = false;
  const result = await runGuardAsync({ argv: ["-fv", "file"], cwd: root, io: { stdout: (text) => { expect(captured).toBe(true); output.push(text); }, stderr: (text) => output.push(text) },
    capture: async (path) => { expect(path).toBe(join(root, "file")); await Bun.sleep(1); captured = true; return "captured"; } });
  expect(result.code).toBe(0); expect(result.removed).toBe(1); expect(output.join("")).toContain("removed");
});

test("force never turns a failed hosted capture into success", async () => {
  const root = fixture(); const output: string[] = [];
  const result = await runGuardAsync({ argv: ["-rf", "file"], cwd: root, io: { stdout: (text) => output.push(text), stderr: (text) => output.push(text) }, capture: async () => "refused" });
  expect(result.code).toBe(2); expect(result.removed).toBe(0); expect(result.refused).toBe(1);
});

test("the async executor retains rm missing-operand, directory and interactive semantics", async () => {
  const root = fixture(); let calls = 0; const io = { stdout() {}, stderr() {} };
  const capture = async () => { calls++; return "captured" as const; };
  expect((await runGuardAsync({ argv: ["-f"], cwd: root, io, capture })).code).toBe(0);
  expect((await runGuardAsync({ argv: [], cwd: root, io, capture })).code).toBe(1);
  expect((await runGuardAsync({ argv: [root], cwd: root, io, capture })).code).toBe(1);
  expect((await runGuardAsync({ argv: ["-i", "file"], cwd: root, io, capture, ask: () => false })).code).toBe(0);
  expect(calls).toBe(0);
});
