import { existsSync, readFileSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import { logIssueKeyFailure, writeTokenFile } from "./issue-key.js";

const paths: string[] = [];
const shmTest = existsSync("/dev/shm") ? test : test.skip;

afterEach(() => {
  for (const path of paths.splice(0)) {
    try { unlinkSync(path); } catch {}
  }
});

function tokenPath(label: string): string {
  const path = `/dev/shm/open-loops-key-${process.pid}-${Date.now()}-${label}`;
  paths.push(path);
  return path;
}

describe("issue-key token output", () => {
  shmTest("creates a new no-follow token file with mode 0600", () => {
    const path = tokenPath("secure");
    writeTokenFile(path, "secret-token");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe("secret-token");
    expect(() => writeTokenFile(path, "replacement")).toThrow();
  });

  shmTest("rejects paths outside /dev/shm and existing symlinks", () => {
    expect(() => writeTokenFile("/tmp/open-loops-key", "secret-token")).toThrow("direct child of /dev/shm");
    const target = tokenPath("target");
    const link = tokenPath("link");
    writeTokenFile(target, "target-token");
    symlinkSync(target, link);
    expect(() => writeTokenFile(link, "secret-token")).toThrow();
  });

  test("logs command failures without provider details", () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logIssueKeyFailure(Object.assign(new Error("postgres://user:secret@db.internal/loops"), {
        name: "postgres://name-secret@db.internal/loops",
        code: "postgres://code-secret@db.internal/loops",
      }));
      expect(logged).toEqual([JSON.stringify({ evt: "loops_issue_key_failed", errorType: "error" })]);
    } finally {
      console.error = originalError;
    }
  });
});
