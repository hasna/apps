import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findTrashBinary } from "./hook";
import { execFileSync } from "node:child_process";

test("native PreToolUse no-op emits no unsupported continue field", () => {
  const output = execFileSync(process.execPath, [join(import.meta.dir, "hook.ts")], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "pwd" } }), encoding: "utf8",
  });
  expect(output).toBe("");
});

let root: string;
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "trash-hook-identity-"))); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function fixture(name = "@hasna/trash", protocol = "hasna.trash.guard.v1") {
  const pkg = join(root, "node_modules/@hasna/trash");
  mkdirSync(join(pkg, "dist/cli"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name, version: "0.1.1", bin: { trash: "dist/cli/index.js" } }), { mode: 0o600 });
  const executable = join(pkg, "dist/cli/index.js");
  writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ name, version: "0.1.1", guardProtocol: protocol })}'\n`);
  chmodSync(executable, 0o755);
  symlinkSync(executable, join(root, "bin/trash"));
  return join(root, "bin");
}

test("unrelated executable named trash is neither selected nor executed", () => {
  const bin = join(root, "system");
  mkdirSync(bin);
  writeFileSync(join(bin, "trash"), `#!/bin/sh\ntouch '${join(root, "executed")}'\n`, { mode: 0o755 });
  expect(findTrashBinary({ PATH: bin })).toBeNull();
  expect(existsSync(join(root, "executed"))).toBe(false);
});

test("selects the registered Hasna executable only after its guard identity matches", () => {
  const bin = fixture();
  expect(findTrashBinary({ PATH: bin })).toBe(join(bin, "trash"));
});

test("wrong package identity and unsupported guard protocol fail closed", () => {
  const bin = fixture("@someone/trash");
  expect(findTrashBinary({ PATH: bin })).toBeNull();
});

test("a stale package that cannot expose the guard protocol is refused", () => {
  const bin = fixture("@hasna/trash", "unknown");
  expect(findTrashBinary({ PATH: bin })).toBeNull();
});
