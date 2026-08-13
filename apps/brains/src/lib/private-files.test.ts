import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensurePrivateDirectory, writePrivateTextFile } from "./private-files.js";

function mode(path: string): number | undefined {
  if (process.platform === "win32") return undefined;
  return statSync(path).mode & 0o777;
}

describe("private file helpers", () => {
  test("creates new directories and files with owner-only modes", () => {
    const root = mkdtempSync(join(tmpdir(), "brains-private-files-"));
    const dir = join(root, "datasets");
    const file = join(dir, "sample.jsonl");

    try {
      writePrivateTextFile(file, "{}\n");

      expect(mode(dir)).toBe(process.platform === "win32" ? undefined : 0o700);
      expect(mode(file)).toBe(process.platform === "win32" ? undefined : 0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not chmod existing custom directories by default", () => {
    if (process.platform === "win32") return;

    const dir = mkdtempSync(join(tmpdir(), "brains-private-existing-"));
    chmodSync(dir, 0o777);

    try {
      ensurePrivateDirectory(dir);
      expect(mode(dir)).toBe(0o777);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
