import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Stage-A storage documentation", () => {
  test("marks hosted adapters and future-positive OpenAPI schemas as deferred, not executable", () => {
    const documentation = readFileSync(new URL("../../docs/native-storage.md", import.meta.url), "utf8");

    expect(documentation).toContain("Runtime status: disabled in Stage A");
    expect(documentation).toContain("Future-positive contract (not live)");
    expect(documentation).toMatch(/public names remain link-compatible Stage-A stubs/i);
    expect(documentation).toMatch(/live.*OpenAPI.*400.*503/is);
    expect(documentation).toMatch(/trusted authority.*future stage/i);

    for (const activeClaim of [
      "can now build a local-plus-remote adapter",
      "can now build a pure Postgres adapter",
      "The public `@hasna/todos/storage` export now includes",
      "Add `--apply` to perform the S3 operation",
    ]) {
      expect(documentation).not.toContain(activeClaim);
    }
  });

  test("cutover, operator help, and package scripts expose only Stage B-deferred intent", () => {
    const cutover = readFileSync(new URL("../../docs/CUTOVER-RUNBOOK.md", import.meta.url), "utf8");
    const serverEntrypoint = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
    const storageCommands = readFileSync(new URL("../cli/commands/storage-commands.ts", import.meta.url), "utf8");
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { scripts: Record<string, string> };

    expect(cutover).toContain("STAGE A STOP");
    expect(cutover).toContain("remote_enabled=false");
    expect(cutover).toContain("runtime_enabled=false");
    expect(cutover).toMatch(/Deferred Stage B Phase 1/);
    expect(cutover).toMatch(/Deferred Stage B Phase 2/);
    expect(cutover).not.toContain("already implemented");
    expect(cutover).not.toContain("Remote: enabled");
    expect(serverEntrypoint).toMatch(/migrate\s+Stage B deferred/);
    expect(serverEntrypoint).toMatch(/redact-comments\s+Stage B deferred/);
    expect(storageCommands).toMatch(/shadow-status[\s\S]*Stage B deferred/);
    expect(storageCommands).toMatch(/shadow-drain[\s\S]*Stage B deferred/);
    expect(manifest.scripts.migrate).toBe("bun run scripts/stage-a-deferred.ts migrate");
    expect(manifest.scripts["backfill:comment-redaction"])
      .toContain("scripts/stage-a-deferred.ts");
  });

  test.each([
    "migrate.ts",
    "union-backfill.ts",
    "v1-smoke.ts",
    "container-http-smoke.ts",
  ])("remote script %s stops at the shared Stage A guard", (name) => {
    const source = readFileSync(new URL(`../../scripts/${name}`, import.meta.url), "utf8");
    expect(source).toContain("stopDeferredStageBOperation");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/from ["']\.\.\/src\/server\/cloud/);
    expect(source).not.toMatch(/from ["']bun:sqlite/);
  });
});
