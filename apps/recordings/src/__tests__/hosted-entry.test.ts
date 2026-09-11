import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runStartupFixture, startupFixtureEnv } from "./helpers/startup-fixture.js";

async function entry(surface: "cli" | "mcp" | "server", args: string[], token = false) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "recordings-hosted-entry-")));
  chmodSync(home, 0o700);
  try {
    const result = await runStartupFixture(home, [process.execPath, "--preload",
      join(import.meta.dir, "helpers/hosted-entry-preload.ts"), join(import.meta.dir, "../" + surface + "/index.ts"), ...args],
      startupFixtureEnv(home, token ? { SELECTED_SESSION: "fictional-entry-session" } : {}));
    const counts = JSON.parse(readFileSync(join(home, "boundary.json"), "utf8"));
    expect(counts.denied).toBe(0);
    return { ...result, requests: counts.requests };
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test("all real hosted entry help paths avoid providers, credentials, native controls and listeners", async () => {
  for (const surface of ["cli", "mcp", "server"] as const) {
    const result = await entry(surface, surface === "cli" ? ["hosted", "--help"] : ["--hosted", "--help"]);
    expect(result.exitCode).toBe(0); expect(result.requests).toBe(0);
    expect(result.stdout).toContain("--api-base");
    expect(result.stderr).toBe("");
  }
});

test("real CLI hosted list emits metadata through one hosted request", async () => {
  const result = await entry("cli", ["--json", "hosted", "--api-base", "https://fictional.example.test/api/v1/",
    "--credential-env", "SELECTED_SESSION", "list", "--limit", "1"], true);
  expect(result.exitCode).toBe(0); expect(result.requests).toBe(1);
  const output = JSON.parse(result.stdout);
  expect(output.recordings).toHaveLength(1); expect(output.recordings[0].title).toBe("Fictional");
  expect(result.stdout).not.toContain("Hidden fictional transcript");
  expect(result.stderr).toBe("");
});

test("hosted process entry refusals stay fixed and cannot route to legacy modes", async () => {
  for (const [surface, args] of [
    ["mcp", ["--hosted", "--http", "--api-base", "https://fictional.example.test/api/v1/"]],
    ["server", ["--hosted", "migrate", "--api-base", "https://fictional.example.test/api/v1/"]],
    ["cli", ["--json", "hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "MISSING_SESSION", "list"]],
    ["cli", ["--json", "hosted", "--api-base", "https://fictional.example.test/api/v1/", "--credential-env", "SELECTED_SESSION", "list", "--token", "fictional-do-not-echo"]],
  ] as const) {
    const result = await entry(surface, [...args]);
    expect(result.exitCode).toBe(1); expect(result.requests).toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).not.toContain("fictional.example.test");
    expect(output).not.toContain("MISSING_SESSION");
    expect(output).not.toContain("fictional-do-not-echo");
  }
});
