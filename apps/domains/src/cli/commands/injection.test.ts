import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];

function useTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "domains-cli-injection-"));
  tempDirs.push(dir);
  return dir;
}

function runDomains(args: string[], dir: string) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.ts", ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      DOMAINS_DIR: dir,
      NO_COLOR: "1",
    },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("CLI command injection regression", () => {
  test("dns check-propagation rejects injected domains without running shell payloads", () => {
    const dir = useTempDir();
    const marker = join(dir, "dns-domain-injected");
    const result = runDomains(["dns", "check-propagation", `example.com; touch ${marker} #`], dir);

    expect(result.exitCode).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  test("dns check-propagation rejects injected record types without running shell payloads", () => {
    const dir = useTempDir();
    const marker = join(dir, "dns-record-injected");
    const result = runDomains(["dns", "check-propagation", "example.com", "--record", `A; touch ${marker} #`], dir);

    expect(result.exitCode).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  test("domain whois rejects injected domains without running shell payloads", () => {
    const dir = useTempDir();
    const marker = join(dir, "whois-injected");
    const result = runDomains(["domain", "whois", `example.com; touch ${marker} #`], dir);

    expect(result.exitCode).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  test("ssl check rejects injected domains without running shell payloads", () => {
    const dir = useTempDir();
    const marker = join(dir, "ssl-injected");
    const result = runDomains(["ssl", "check", `example.com; touch ${marker} #`], dir);

    expect(result.exitCode).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  });
});
