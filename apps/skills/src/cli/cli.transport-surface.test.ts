/**
 * Transport parity for the command surface (campaign: every command must work
 * in any transport — the storage-mode axis is retired).
 *
 * 1. The registered command tree is IDENTICAL when the CLI runs opted-in local
 *    or pointed at a hosted API: no command is registered conditionally on a
 *    transport, and no wording in the tree names a transport as a requirement.
 * 2. The `runs logs/artifacts` subcommands read LOCAL run records without
 *    needing a server, and `runs cancel/resume` answer local records
 *    truthfully instead of dialling a server that has nothing to do with them.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, runCliInCwd, stderrWithoutLocalNotice } from "./cli.test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

const LOCAL_HOME = mkdtempSync(join(tmpdir(), "skills-parity-local-"));
const HOSTED_HOME = mkdtempSync(join(tmpdir(), "skills-parity-hosted-"));
const PROJECT = mkdtempSync(join(tmpdir(), "skills-parity-proj-"));

afterAll(() => {
  rmSync(LOCAL_HOME, { recursive: true, force: true });
  rmSync(HOSTED_HOME, { recursive: true, force: true });
  rmSync(PROJECT, { recursive: true, force: true });
});

/** Parse `skills --help` into the ordered list of top-level command names. */
function commandsFromHelp(help: string): string[] {
  const lines = help.split("\n");
  const start = lines.findIndex((line) => line.startsWith("Commands:"));
  if (start < 0) return [];
  return lines
    .slice(start + 1)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((token) => /^[a-z]/.test(token));
}

describe("the command surface is identical in every transport", () => {
  test("the top-level command tree matches between local opt-in and hosted runs", async () => {
    const local = await runCli(["--help"], { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
    expect(local.exitCode).toBe(0);
    const hosted = await runCli(["--help"], {
      HOME: HOSTED_HOME,
      HASNA_SKILLS_LOCAL: "0",
      HASNA_SKILLS_API_URL: "https://skills.example.test",
      HASNA_SKILLS_API_KEY: "sk_parity_test_key",
    });
    expect(hosted.exitCode).toBe(0);
    const localCommands = commandsFromHelp(local.stdout);
    const hostedCommands = commandsFromHelp(hosted.stdout);
    expect(hostedCommands.length).toBeGreaterThan(20);
    expect(localCommands).toEqual(hostedCommands);
    // The tree names no transport as a requirement and carries no legacy mode
    // vocabulary.
    for (const forbidden of ["local only", "cloud only", "hosted only", "not available in", "self-hosted", "requires hosted", "requires local"]) {
      expect((local.stdout + hosted.stdout).toLowerCase()).not.toContain(forbidden);
    }
  });

  test("every top-level command answers --help in the local opt-in transport", async () => {
    const help = await runCli(["--help"], { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
    expect(help.exitCode).toBe(0);
    for (const command of commandsFromHelp(help.stdout)) {
      const probe = await runCli([command, "--help"], { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
      if (command === "help") continue;
      expect(probe.exitCode, `${command} --help must succeed in local transport`).toBe(0);
    }
  });
});

describe("runs subcommands read local records without a server", () => {
  test("a local run's logs are served from the local record", async () => {
    const run = await runCliInCwd(["run", "--json", "codefix", "help"], PROJECT, { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
    expect(run.exitCode).toBe(0);
    const record = JSON.parse(run.stdout) as { run: { id: string; skill: string } };
    const logs = await runCliInCwd(["runs", "logs", record.run.id, "--json"], PROJECT, { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
    expect(logs.exitCode, stderrWithoutLocalNotice(logs.stderr)).toBe(0);
    const payload = JSON.parse(logs.stdout) as { local: boolean; stdout: string | null };
    expect(payload.local).toBe(true);
    expect(payload.stdout).toBeTypeOf("string");
  });

  test("a local run's artifacts list the local export directory without a server", async () => {
    const run = await runCliInCwd(["run", "--json", "codefix", "help"], PROJECT, { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
    expect(run.exitCode).toBe(0);
    const record = JSON.parse(run.stdout) as { run: { id: string } };
    const artifacts = await runCliInCwd(["runs", "artifacts", record.run.id, "--json"], PROJECT, { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
    expect(artifacts.exitCode, stderrWithoutLocalNotice(artifacts.stderr)).toBe(0);
    const payload = JSON.parse(artifacts.stdout) as { local: boolean; exportDir: string };
    expect(payload.local).toBe(true);
    expect(payload.exportDir).toContain(".skills/exports");
  });

  test("cancel and resume answer a finished local record truthfully without a server", async () => {
    const run = await runCliInCwd(["run", "--json", "codefix", "help"], PROJECT, { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
    const record = JSON.parse(run.stdout) as { run: { id: string; status: string } };
    expect(record.run.status).toBe("completed");
    for (const verb of ["cancel", "resume"]) {
      const result = await runCliInCwd(["runs", verb, record.run.id, "--json"], PROJECT, { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
      expect(result.exitCode).toBe(1);
      const payload = JSON.parse(result.stdout) as { error: string; status: string };
      expect(payload.error).toContain(record.run.id);
      expect(payload.status).toBe("completed");
    }
  });

  test("runs logs on an unknown id still surfaces the remote requirement cleanly", async () => {
    const result = await runCliInCwd(["runs", "logs", "run_does_not_exist", "--json"], PROJECT, { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as { error?: string };
    expect(payload.error).toBeTypeOf("string");
  });
});

describe("local run records keep working from the packaged corpus", () => {
  test("run + runs list + runs show round trip without any API", async () => {
    const list = await runCliInCwd(["runs", "list", "--json"], PROJECT, { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
    expect(list.exitCode).toBe(0);
    const runs = JSON.parse(list.stdout) as Array<{ id: string }>;
    expect(runs.length).toBeGreaterThanOrEqual(2);
    const shown = await runCliInCwd(["runs", "show", runs[0]!.id, "--json"], PROJECT, { HOME: LOCAL_HOME, HASNA_SKILLS_LOCAL: "1" });
    expect(shown.exitCode).toBe(0);
    expect((JSON.parse(shown.stdout) as { id: string }).id).toBe(runs[0]!.id);
  });
});