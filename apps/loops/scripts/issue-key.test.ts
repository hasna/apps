import { readFileSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { afterEach, describe, expect, test } from "bun:test";
import { writeTokenFile } from "./issue-key.js";

const paths: string[] = [];

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
  test("creates a new no-follow token file with mode 0600", () => {
    const path = tokenPath("secure");
    writeTokenFile(path, "secret-token");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe("secret-token");
    expect(() => writeTokenFile(path, "replacement")).toThrow();
  });

  test("rejects paths outside /dev/shm and existing symlinks", () => {
    expect(() => writeTokenFile("/tmp/open-loops-key", "secret-token")).toThrow("direct child of /dev/shm");
    const target = tokenPath("target");
    const link = tokenPath("link");
    writeTokenFile(target, "target-token");
    symlinkSync(target, link);
    expect(() => writeTokenFile(link, "secret-token")).toThrow();
  });
});
