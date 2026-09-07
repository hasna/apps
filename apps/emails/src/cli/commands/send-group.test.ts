// Group sends use the authenticated API and preserve recipient expansion,
// deduplication, dry-run, and refusal behavior without a local mail store.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { Command } from "commander";
import { addMember, createGroup } from "../../db/groups.js";
import { resetMailDataSource } from "../../lib/mail-data-source.js";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { registerSendCommands } from "./send.js";

let INHERITED_PROCESS_ENV: NodeJS.ProcessEnv;
function captureInheritedProcessEnv(): void {
  INHERITED_PROCESS_ENV = { ...process.env };
}
function restoreInheritedProcessEnv(): void {
  for (const key of Object.keys(process.env)) {
    if (!Object.prototype.hasOwnProperty.call(INHERITED_PROCESS_ENV, key)) delete process.env[key];
  }
  Object.assign(process.env, INHERITED_PROCESS_ENV);
}

interface RunResult {
  consoleOutput: string;
  errorOutput: string;
  exited: boolean;
}

/** Drive the real command in-process, capturing stdout, stderr and process.exit. */
async function runSend(args: string[]): Promise<RunResult> {
  const program = new Command();
  program.exitOverride();
  registerSendCommands(program, () => {});

  const consoleLines: string[] = [];
  const errorLines: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;
  console.log = (...values: unknown[]) => { consoleLines.push(values.map(String).join(" ")); };
  (console as unknown as { error: (...v: unknown[]) => void }).error = (...values: unknown[]) => {
    errorLines.push(values.map(String).join(" "));
  };
  (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as never;

  let exited = false;
  try {
    await program.parseAsync(["node", "emails", ...args]);
  } catch (error) {
    if (!(error instanceof Error) || !/process\.exit/.test(error.message)) throw error;
    exited = true;
  } finally {
    console.log = originalLog;
    (console as unknown as { error: typeof originalError }).error = originalError;
    (process as unknown as { exit: typeof originalExit }).exit = originalExit;
  }

  return { consoleOutput: consoleLines.join("\n"), errorOutput: errorLines.join("\n"), exited };
}

describe("emails send --to-group API behavior", () => {
  let stub: V1Stub;
  beforeAll(async () => { stub = await startV1Stub({ openapi: true }); });
  afterAll(() => stub.stop());
  beforeEach(async () => {
    captureInheritedProcessEnv();
    await stub.reset();
    stub.applyEnv();
    resetMailDataSource();
    const group = await createGroup("team");
    await addMember(group.id, "one@ext.com", "One");
    await addMember(group.id, "two@ext.com", "Two");
  });
  afterEach(() => {
    stub.clearEnv();
    resetMailDataSource();
    restoreInheritedProcessEnv();
  });

  it("sends to every member instead of refusing", async () => {
    const result = await runSend([
      "send", "--from", "agent@acme.com", "--to-group", "team", "--subject", "Hi", "--body", "x",
    ]);

    expect(result.exited).toBe(false);
    expect(result.consoleOutput).toContain("Email sent to one@ext.com, two@ext.com");
    // The historical refusal must not replace a real group send.
    expect(result.errorOutput).not.toContain("not available in the self-hosted client");
    const sent = await stub.list("messages");
    expect(sent).toHaveLength(1);
    // One message carrying BOTH members, which is what `--to a@x b@y` produces
    // — no invented per-recipient fan-out.
    expect((sent[0]?.to_addrs as string[]).join(", ")).toBe("one@ext.com, two@ext.com");
  });

  it("names the group and its size in a dry run, and sends nothing", async () => {
    const result = await runSend([
      "send", "--from", "agent@acme.com", "--to-group", "team", "--subject", "Hi", "--body", "x",
      "--dry-run",
    ]);

    expect(result.exited).toBe(false);
    expect(result.consoleOutput).toContain("Would send (self-hosted)");
    expect(result.consoleOutput).toContain("Group:   team — 2 member(s), all in one To: header");
    expect(await stub.list("messages")).toHaveLength(0);
  });

  it("collapses a member listed twice under different casing", async () => {
    const group = await createGroup("dupes");
    await addMember(group.id, "Same@ext.com");
    await addMember(group.id, "same@ext.com");

    const result = await runSend([
      "send", "--from", "agent@acme.com", "--to-group", "dupes", "--subject", "Hi", "--body", "x",
    ]);

    expect(result.exited).toBe(false);
    // One recipient, not two — otherwise the delivered To: header repeats it.
    expect(result.consoleOutput).toMatch(/Email sent to [Ss]ame@ext\.com$/m);
    const messages = await stub.list("messages");
    expect(messages).toHaveLength(1);
    expect((messages[0]!.to_addrs as string[]).map(value => value.toLowerCase())).toEqual(["same@ext.com"]);
  });

  it("refuses an unknown group by naming the group, never a mode", async () => {
    const result = await runSend([
      "send", "--from", "agent@acme.com", "--to-group", "nope", "--subject", "Hi", "--body", "x",
    ]);

    expect(result.exited).toBe(true);
    expect(result.errorOutput).toContain("Group not found: nope");
    expect(result.errorOutput).toContain("emails group list");
    expect(result.errorOutput).not.toContain("self-hosted");
    expect(await stub.list("messages")).toHaveLength(0);
  });

  it("refuses an empty group and names the command that fills it", async () => {
    await createGroup("empty");
    const result = await runSend([
      "send", "--from", "agent@acme.com", "--to-group", "empty", "--subject", "Hi", "--body", "x",
    ]);

    expect(result.exited).toBe(true);
    expect(result.errorOutput).toContain("Group 'empty' has no members");
    expect(result.errorOutput).toContain("emails group add empty");
    expect(await stub.list("messages")).toHaveLength(0);
  });

  it("refuses --to and --to-group together rather than dropping --to", async () => {
    const result = await runSend([
      "send", "--from", "agent@acme.com", "--to", "explicit@ext.com", "--to-group", "team",
      "--subject", "Hi", "--body", "x",
    ]);

    expect(result.exited).toBe(true);
    expect(result.errorOutput).toContain("Pass --to or --to-group, not both");
    expect(await stub.list("messages")).toHaveLength(0);
  });
});

// ---- self-hosted -------------------------------------------------------------

describe("emails send --to-group API round trip", () => {
  let stub: V1Stub;

  // `openapi: true` because the collapsed family pushes its membership filters down,
  // and the REAL HTTP store reads the service's published contract before accepting a
  // filter or a write — a missing document is deliberately a fault there.
  beforeAll(async () => { stub = await startV1Stub({ openapi: true }); });
  afterAll(() => stub.stop());

  beforeEach(async () => {
    captureInheritedProcessEnv();
    await stub.reset();
    stub.applyEnv();
    resetMailDataSource();
    // Written through the SAME collapsed family the command reads — over the real
    // HTTP store — so the test proves the /v1 round trip rather than a hand-shaped
    // stub payload.
    const group = await createGroup("team");
    await addMember(group.id, "one@ext.com", "One");
    await addMember(group.id, "two@ext.com", "Two");
  });

  afterEach(() => {
    stub.clearEnv();
    resetMailDataSource();
    restoreInheritedProcessEnv();
  });

  it("expands the group over /v1 — the API the refusal said did not exist", async () => {
    const result = await runSend([
      "send", "--from", "agent@acme.com", "--to-group", "team", "--subject", "Hi", "--body", "x",
    ]);

    expect(result.exited).toBe(false);
    expect(result.consoleOutput).toContain("Email sent to one@ext.com, two@ext.com");
    const messages = await stub.list("messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      direction: "outbound",
      from_addr: "agent@acme.com",
      to_addrs: ["one@ext.com", "two@ext.com"],
      status: "sent",
    });
  });

  it("still refuses an unknown group, without naming a mode", async () => {
    const result = await runSend([
      "send", "--from", "agent@acme.com", "--to-group", "nope", "--subject", "Hi", "--body", "x",
    ]);

    expect(result.exited).toBe(true);
    expect(result.errorOutput).toContain("Group not found: nope");
    expect(result.errorOutput).not.toContain("self-hosted");
    expect(await stub.list("messages")).toHaveLength(0);
  });
});
