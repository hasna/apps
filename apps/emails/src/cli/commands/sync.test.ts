// Statistics use the configured API store; remaining ingestion handlers are
// exercised separately until their API replacements land.
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { Command } from "commander";
import { startV1Stub } from "../../test-support/v1-stub.js";
import { registerSyncCommands } from "./sync.js";
import { registerSyncCommands as registerLocalSyncCommands } from "./sync.local.test-support.js";
import { registerSyncCommands as registerRemoteSyncCommands } from "./sync.remote.js";

const MODE_ENV_KEYS = [
  "EMAILS_MODE",
  "HASNA_EMAILS_MODE",
  "HASNA_EMAILS_API_URL",
  "HASNA_EMAILS_API_KEY",
] as const;

let originalModeEnv: Partial<Record<typeof MODE_ENV_KEYS[number], string>> = {};

function enableSelfHostedMode() {
  // The API arm is selected by configuration alone (hasna/apps#1566): an origin
  // plus a credential. The retired deployment-mode variable is scrubbed — never
  // set — because a set word trips the retired-variable guard.
  delete process.env["EMAILS_MODE"];
  delete process.env["HASNA_EMAILS_MODE"];
  process.env["HASNA_EMAILS_API_URL"] = "https://emails.example.test";
  process.env["HASNA_EMAILS_API_KEY"] = "test-api-key";
}

async function runSyncCommandExpectingExit(args: string[]): Promise<string> {
  const program = new Command();
  program.exitOverride();
  program.command("provider").description("provider namespace");
  const errors: string[] = [];
  const originalError = console.error;
  const originalExit = process.exit;
  const errorSpy = mock((msg: unknown) => {
    errors.push(String(msg));
  });
  const exitSpy = mock((code?: number) => {
    throw new Error(`exit:${code ?? 0}`);
  });
  registerSyncCommands(program, () => {});
  (console as unknown as { error: typeof errorSpy }).error = errorSpy;
  (process as unknown as { exit: typeof exitSpy }).exit = exitSpy;
  try {
    await expect(program.parseAsync(["node", "emails", ...args])).rejects.toThrow("exit:1");
  } finally {
    (console as unknown as { error: typeof originalError }).error = originalError;
    (process as unknown as { exit: typeof originalExit }).exit = originalExit;
  }
  return errors.join("\n");
}

function allRegisteredCommands(program: Command): Command[] {
  return program.commands.flatMap((command) => [command, ...allRegisteredCommands(command)]);
}

beforeEach(() => {
  originalModeEnv = {};
  for (const key of MODE_ENV_KEYS) {
    originalModeEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of MODE_ENV_KEYS) {
    const value = originalModeEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("sync CLI provider selection", () => {
  for (const args of [["provider", "sync", "--provider", " "], ["pull", "--provider", " "]]) {
    it(`rejects a blank selector for ${args[0]} before contacting a provider`, async () => {
      enableSelfHostedMode();
      expect(await runSyncCommandExpectingExit(args)).toContain("--provider must name a provider identifier");
    });
  }
});

describe("sync JSON output", () => {
  it("prints one parseable stats document when -j follows the command", async () => {
    const api = await startV1Stub({ openapi: true });
    api.applyEnv();
    try {
    const env = { ...process.env, NO_COLOR: "1" };
    const child = Bun.spawn({
      cmd: [process.execPath, "run", "src/cli/index.tsx", "stats", "-j"],
      cwd: process.cwd(),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toMatchObject({ provider_id: "all", period: "30d", sent: 0 });
    } finally { api.clearEnv(); api.stop(); }
  });

  it("prints parseable JSON errors with a non-zero exit", async () => {
    enableSelfHostedMode();
    const child = Bun.spawn({
      cmd: [process.execPath, "run", "src/cli/index.tsx", "pull", "--provider", " ", "--json"],
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(JSON.parse(stderr)).toMatchObject({
      error: { message: expect.stringContaining("--provider must name a provider identifier") },
    });
  });
});

describe("sync JSON option registration", () => {
  for (const [mode, register] of [
    ["local", registerLocalSyncCommands],
    ["self_hosted", registerRemoteSyncCommands],
  ] as const) {
    it(`registers the exact JSON option on every ${mode} command`, () => {
      const program = new Command();
      program.command("provider");
      register(program, () => {});

      const commands = allRegisteredCommands(program).filter((command) => command.name() !== "provider");
      for (const command of commands) {
        const option = command.options.find((candidate) => candidate.long === "--json");
        expect(option?.flags, command.name()).toBe("-j, --json");
        expect(option?.description, command.name()).toBe("Print JSON output");
        expect(option?.defaultValue, command.name()).toBe(false);
      }
    });
  }
});
