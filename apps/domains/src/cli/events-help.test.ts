import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runDomains(args: string[], env: Record<string, string | undefined> = {}) {
  const eventsDir = mkdtempSync(join(tmpdir(), "domains-events-"));
  try {
    return Bun.spawnSync({
      cmd: ["bun", "run", "src/cli/index.ts", ...args],
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...env, HASNA_EVENTS_DIR: eventsDir, NO_COLOR: "1" },
    });
  } finally {
    rmSync(eventsDir, { recursive: true, force: true });
  }
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf-8");
}

describe("domains events CLI", () => {
  test("default help keeps optional events and webhooks commands hidden", () => {
    const result = runDomains(["--help"]);
    const stdout = text(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(stdout).not.toContain("events");
    expect(stdout).not.toContain("webhooks");
  });

  test("extras advertises events as an optional command group", () => {
    const result = runDomains(["extras", "--json"]);
    const body = JSON.parse(text(result.stdout)) as { available: string[] };

    expect(result.exitCode).toBe(0);
    expect(body.available).toContain("events");
    expect(body.available).toContain("marketplace");
  });
});
