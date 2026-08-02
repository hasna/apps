import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { resolveServerDataBackend } from "../src/generated/storage-kit/backend.js";

const ROOT = new URL("../", import.meta.url).pathname;

function trackedFiles(): string[] {
  const result = Bun.spawnSync({
    cmd: ["git", "ls-files"],
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return result.stdout
    .toString()
    .split("\n")
    .filter(Boolean)
    .filter((path) => existsSync(new URL(`../${path}`, import.meta.url)))
    .filter(
      (path) =>
        path === "hasna.contract.json" ||
        path === "docker-compose.yml" ||
        path === "openapi.json" ||
        path === "README.md" ||
        (path.startsWith("src/") && !path.startsWith("src/generated/storage-kit/")),
    );
}

describe("deployment and data-backend terms", () => {
  it("validates the service manifest against the current contracts schema", () => {
    const result = Bun.spawnSync({
      cmd: ["contracts", "validate", "hasna.contract.json", "--json"],
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
  });

  it("does not ship the removed storage-mode contract", async () => {
    const forbidden = [
      /deploymentModes?/,
      /_STORAGE_MODE/,
      /\bStorageMode\b/,
      /\bresolveStorageMode\b/,
      /\b(?:local|cloud)\s+mode\b/i,
      /\bmode\s+(?:resolves?|resolved|selection|enum)\b/i,
      /\bself_hosted\b/,
      /\bhybrid\b/,
    ];
    const findings: string[] = [];

    for (const path of trackedFiles()) {
      const content = await Bun.file(new URL(`../${path}`, import.meta.url)).text();
      for (const pattern of forbidden) {
        if (pattern.test(content)) findings.push(`${path}: ${pattern.source}`);
      }
    }

    expect(findings).toEqual([]);
  });

  it("rejects a legacy variable instead of treating it as configuration", () => {
    expect(() =>
      resolveServerDataBackend("billing", { HASNA_BILLING_STORAGE_MODE: "cloud" }),
    ).toThrow(/removed/i);
  });
});
