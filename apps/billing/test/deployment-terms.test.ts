import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { resolveServerDataBackend } from "../src/generated/storage-kit/backend.js";

const ROOT = new URL("../", import.meta.url).pathname;

/**
 * Deterministic PATH for spawned binaries, independent of the invocation
 * context. `Bun.spawnSync` resolves bare command names against PATH, and
 * `bun test` does not put `node_modules/.bin` there: direct `bun test`
 * (and CI contexts where PATH is not augmented) fail with
 * "Executable not found in $PATH: contracts" even though the pinned
 * @hasna/contracts devDependency is installed. Prepend the package's own
 * .bin so the test resolves the exact pinned version under every runner.
 */
function binPath(): string {
  const bins = join(ROOT, "node_modules", ".bin");
  const rest = process.env.PATH ?? "";
  return rest ? `${bins}:${rest}` : bins;
}

function trackedFiles(): string[] {
  const result = Bun.spawnSync({
    cmd: ["git", "ls-files"],
    cwd: ROOT,
    env: { ...process.env, PATH: binPath() },
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
      env: { ...process.env, PATH: binPath() },
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
