// `emails email send` — the subcommand whose help line calls it an alias of the
// top-level `emails send`.
//
// WHY THIS FILE EXISTS. Before the fix it pins, the alias declared a plausible
// option surface (--from/--to/--subject/--body/--provider), accepted a fully
// specified send, printed a dim one-line usage hint, and exited 0. An operator —
// or an agent scripting the CLI — who ran `emails email send --from a --to b
// --subject s --body t` got a SUCCESS exit code and NO email: the worst shape of
// lie the CLI can tell (task 95f66fd3). The alias now forwards its argv verbatim
// to the real `send` command, so it sends, refuses, and drifts exactly as
// `emails send` does — including options added to the real command later.
//
// The real CLI runs against an authenticated, out-of-process API fixture.
// No provider adapters or local mail database participate in these tests.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPrepublishTestEnv } from "../../../scripts/prepublish-local-test.mjs";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";

let stub: V1Stub;
const tempDirs: string[] = [];
beforeAll(async () => { stub = await startV1Stub({ apiKey: crypto.randomUUID() }); });
beforeEach(async () => { await stub.reset(); });

function apiEnv(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "emails-send-alias-"));
  tempDirs.push(dir);
  mkdirSync(join(dir, "tmp"), { mode: 0o700 });
  return {
    ...buildPrepublishTestEnv(process.env, dir),
    HASNA_STATION: `emails-send-alias-${crypto.randomUUID()}`,
    HASNA_EMAILS_API_URL: stub.baseUrl,
    HASNA_EMAILS_API_KEY: stub.apiKey,
    EMAILS_CLIENT_ENV_LOADED: "1",
    NO_COLOR: "1",
  };
}

function expectNoLocalMailStore(): void {
  for (const dir of tempDirs) {
    expect(readdirSync(dir, { recursive: true }).filter(name => /\.(?:db|sqlite)(?:-|$)/.test(String(name)))).toEqual([]);
  }
}

interface CliRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], env: NodeJS.ProcessEnv): CliRun {
  const result = Bun.spawnSync({
    cmd: [process.execPath, "src/cli/index.tsx", ...args],
    cwd: process.cwd(),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    stdout: decoder.decode(result.stdout),
    stderr: decoder.decode(result.stderr),
  };
}

/** Subjects the ledger currently holds, read back through the CLI itself. */
function ledgerSubjects(env: NodeJS.ProcessEnv): string[] {
  const logged = runCli(["--json", "email", "list"], env);
  expect(logged.exitCode, `email list failed: ${logged.stderr}`).toBe(0);
  const rows = JSON.parse(logged.stdout) as Array<{ subject?: string }>;
  return rows.map((row) => row.subject ?? "");
}

afterAll(() => {
  stub?.stop();
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("`emails email send` forwards to the real send command", () => {
  // STRONG: the alias must actually SEND. The email lands in the sent ledger,
  // observable through the CLI's own `email list --json`.
  it("delivers a fully-specified send to the sent ledger", async () => {
    const env = apiEnv();

    const sent = runCli([
      "email", "send",
      "--from", "agent@alias.example",
      "--to", "person@alias.example",
      "--subject", "alias must really send",
      "--body", "delivered through the alias",
    ], env);

    expect(sent.exitCode, `alias send failed: ${sent.stderr}\n${sent.stdout}`).toBe(0);
    expect(ledgerSubjects(env)).toContain("alias must really send");
    const messages = await stub.list("messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ direction: "outbound", from_addr: "agent@alias.example", to_addrs: ["person@alias.example"], subject: "alias must really send", body_text: "delivered through the alias", send_state: "sent" });
    expect(sent.stdout).toContain("Email sent to person@alias.example");
    expectNoLocalMailStore();
  }, 120_000);

  // STRONG: an incomplete send must REFUSE, not exit 0. Before the fix, every
  // invocation — complete or not — exited 0 having done nothing.
  it("refuses a send with no recipients instead of exiting 0", async () => {
    const env = apiEnv();

    const run = runCli([
      "email", "send",
      "--from", "agent@alias.example",
      "--subject", "no recipient",
      "--body", "should refuse",
    ], env);

    expect(run.exitCode, `expected a refusal, got exit 0: ${run.stdout}`).not.toBe(0);
    expect(`${run.stderr}${run.stdout}`.toLowerCase()).toContain("recipient");
    expect(ledgerSubjects(env)).not.toContain("no recipient");
    expect(await stub.list("messages")).toEqual([]);
    expectNoLocalMailStore();
  }, 120_000);

  // STRONG: the forwarded surface is the REAL one, not the five options the stub
  // used to declare. --dry-run only exists on the real command; it must preview
  // and write nothing.
  it("honours the real command's --dry-run: previews, records nothing", async () => {
    const env = apiEnv();

    const run = runCli([
      "email", "send",
      "--from", "agent@alias.example",
      "--to", "person@alias.example",
      "--subject", "alias dry run",
      "--body", "must not be recorded",
      "--dry-run",
    ], env);

    expect(run.exitCode, `dry-run failed: ${run.stderr}\n${run.stdout}`).toBe(0);
    expect(run.stdout.toLowerCase()).toContain("dry run");
    expect(ledgerSubjects(env)).not.toContain("alias dry run");
    expect(await stub.list("messages")).toEqual([]);
    expect(run.stdout).toContain("[NOT SENT]");
    expectNoLocalMailStore();
  }, 120_000);
});

describe("API and explicit compatibility registration preserve the forwarding alias", () => {
  // Actual API-backed CLI behavior is exercised above; both registrations must
  // preserve the variadic passthrough rather than duplicate send options.
  const armModules = [
    { arm: "local", path: "./email-log.local.test-support.js" },
    { arm: "api-backed", path: "./email-log.remote.js" },
  ] as const;

  for (const { arm, path } of armModules) {
    it(`the ${arm} arm's \`email send\` is a verbatim passthrough`, async () => {
      const { Command } = await import("commander");
      const module = await import(path) as {
        registerEmailLogCommands: (program: unknown, output: (data: unknown, formatted: string) => void) => void;
      };
      const program = new Command();
      module.registerEmailLogCommands(program, () => {});
      const emailCmd = program.commands.find((c) => c.name() === "email");
      expect(emailCmd, "no `email` command registered").toBeDefined();
      const sendCmd = emailCmd?.commands.find((c) => c.name() === "send");
      expect(sendCmd, "no `email send` subcommand registered").toBeDefined();

      // The stub declared five options and no argument; the passthrough
      // declares no options and one variadic argument.
      const declared = sendCmd as unknown as {
        options: unknown[];
        registeredArguments: Array<{ variadic: boolean }>;
      };
      expect(declared.options.length,
        "`email send` re-declares options — a partial copy of the real surface is the bug this suite pins").toBe(0);
      expect(declared.registeredArguments.length).toBe(1);
      expect(declared.registeredArguments[0]?.variadic).toBe(true);
    });
  }
});
