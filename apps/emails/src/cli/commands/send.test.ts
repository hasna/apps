// Self-hosted-ONLY: `emails send` routes through the mail-data-source seam to the
// server send API (POST /v1/messages/send). There is no local provider path or
// local sent ledger anymore. These tests drive the REAL command in-process
// against an out-of-process /v1 stub (see src/test-support/v1-stub.ts): a real
// send records an outbound message, a dry-run records nothing, and the
// self-hosted-unsupported path (scheduling) fails loud. `--to-group` is NOT in
// that category and has its own two-mode suite (send-group.test.ts).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { registerSendCommands } from "./send.js";

let stub: V1Stub;

async function runSendCommand(args: string[], consoleLines: string[] = []) {
  const program = new Command();
  program.exitOverride();
  const originalLog = console.log;
  registerSendCommands(program, () => {});
  console.log = (...values: unknown[]) => {
    consoleLines.push(values.map(String).join(" "));
  };
  try {
    await program.parseAsync(["node", "emails", ...args]);
  } finally {
    console.log = originalLog;
  }
  return { consoleOutput: consoleLines.join("\n") };
}

async function runSendCommandExpectingExit(args: string[]): Promise<string> {
  const errors: string[] = [];
  const logs: string[] = [];
  const originalError = console.error;
  const originalExit = process.exit;
  (console as unknown as { error: (...v: unknown[]) => void }).error = (...values: unknown[]) => {
    errors.push(values.map(String).join(" "));
  };
  (process as unknown as { exit: (code?: number) => never }).exit = ((code?: number) => {
    throw new Error(`process.exit:${code ?? 0}`);
  }) as never;
  try {
    await expect(runSendCommand(args, logs)).rejects.toThrow(/process\.exit/);
  } finally {
    (console as unknown as { error: typeof originalError }).error = originalError;
    (process as unknown as { exit: typeof originalExit }).exit = originalExit;
  }
  return [...errors, ...logs].join("\n");
}

beforeAll(async () => {
  stub = await startV1Stub();
});
afterAll(() => stub.stop());
beforeEach(async () => {
  await stub.reset();
  stub.applyEnv();
});
afterEach(() => stub.clearEnv());

describe("emails send — routes through the server send API", () => {
  it("records an outbound message and reports success", async () => {
    const result = await runSendCommand([
      "send", "--from", "agent@acme.com", "--to", "dest@ext.com", "--subject", "Hi", "--body", "Body text",
    ]);

    expect(result.consoleOutput).toContain("Email sent to dest@ext.com");

    const messages = await stub.list("messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      direction: "outbound",
      from_addr: "agent@acme.com",
      to_addrs: ["dest@ext.com"],
      subject: "Hi",
      body_text: "Body text",
      status: "sent",
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

  it("sends to multiple recipients", async () => {
    const result = await runSendCommand([
      "send", "--from", "agent@acme.com", "--to", "a@ext.com", "b@ext.com", "--subject", "Hi", "--body", "x",
    ]);

    expect(result.consoleOutput).toContain("Email sent to a@ext.com, b@ext.com");
    const messages = await stub.list("messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      direction: "outbound",
      from_addr: "agent@acme.com",
      to_addrs: ["a@ext.com", "b@ext.com"],
      subject: "Hi",
      body_text: "x",
      status: "sent",
      created_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });
});

describe("emails send — dry-run previews without sending", () => {
  it("prints the preview and [NOT SENT] without recording a message", async () => {
    const result = await runSendCommand([
      "send", "--from", "agent@acme.com", "--to", "dest@ext.com", "--subject", "Hi", "--body", "Body text", "--dry-run",
    ]);

    expect(result.consoleOutput).toContain("[DRY RUN]");
    expect(result.consoleOutput).toContain("[NOT SENT]");
    expect(await stub.list("messages")).toHaveLength(0);
  });

  it("previews API scheduling during a dry-run", async () => {
    const result = await runSendCommand([
      "send", "--from", "agent@acme.com", "--to", "dest@ext.com", "--subject", "Hi", "--body", "x",
      "--schedule", "2030-01-01T00:00:00Z", "--dry-run",
    ]);

    expect(result.consoleOutput).toContain("queues on the API");
    expect(await stub.list("messages")).toHaveLength(0);
  });

  // --dry-run exists to PREDICT the send. It had no mode branch, so in LOCAL
  // mode it announced "(self-hosted)", quoted the server's attachment caps and
  // predicted a scheduling failure that does not happen locally.
  it("labels the preview without a storage mode", async () => {
    const result = await runSendCommand([
      "send", "--from", "agent@acme.com", "--to", "dest@ext.com", "--subject", "Hi", "--body", "x", "--dry-run",
    ]);

    expect(result.consoleOutput).toContain("[DRY RUN] Would send:");
    expect(result.consoleOutput).not.toContain("Would send (local)");
    expect(result.consoleOutput).not.toContain("self-hosted");
  });
});

describe("emails send — invalid send requests fail clearly", () => {
  // `--to-group` used to live here as an unconditional refusal. It is a real
  // command now — group expansion is a client-side lookup over the routed
  // groups repo, needing no server route — and is covered in both modes by
  // src/cli/commands/send-group.test.ts.

  it("requires explicit recipients", async () => {
    const errors = await runSendCommandExpectingExit([
      "send", "--from", "agent@acme.com", "--subject", "Hi", "--body", "x",
    ]);

    expect(errors).toContain("No recipients specified");
  });

  it("rejects an invalid scheduled timestamp before enqueue", async () => {
    const errors = await runSendCommandExpectingExit([
      "send", "--from", "agent@acme.com", "--to", "dest@ext.com", "--subject", "Hi", "--body", "x",
      "--schedule", "invalid-time",
    ]);

    expect(errors).toContain("ISO-8601");
    expect(await stub.list("messages")).toHaveLength(0);
  });
});


describe("emails send — literal URL boundary escapes", () => {
  for (const flags of [[], ["--dry-run"], ["--schedule", "2030-01-01T00:00:00Z"], ["--html"]]) {
    it(`refuses before outbound effects or a body preview: ${flags.join(" ") || "send"}`, async () => {
      const body = String.raw`PRIVATE_BODY https://example.test/private-link\n\nRegards`;
      const errors = await runSendCommandExpectingExit([
        "send", "--from", "agent@acme.com", "--to", "dest@ext.com", "--subject", "Hi", "--body", body, ...flags,
      ]);
      expect(errors).toContain("invalid_body_url_boundary");
      expect(errors).toContain("--body-file");
      expect(errors).not.toContain("PRIVATE_BODY");
      expect(errors).not.toContain("private-link");
      expect(await stub.list("messages")).toHaveLength(0);
      expect(await stub.sendStats()).toEqual({ providerCalls: 0 });
    });
  }

  it("preserves actual newlines and unrelated backslashes from a body file exactly", async () => {
    const dir = mkdtempSync(join(tmpdir(), "emails-body-boundary-"));
    const body = "Hello\nhttps://example.test/a/%5Cn\n\n" + String.raw`C:\notes\new.txt and prose \n`;
    try {
      const path = join(dir, "body.txt");
      writeFileSync(path, body, { mode: 0o600 });
      await runSendCommand([
        "send", "--from", "agent@acme.com", "--to", "dest@ext.com", "--subject", "Hi", "--body-file", path,
      ]);
      const messages = await stub.list("messages");
      expect(messages).toHaveLength(1);
      expect(messages[0]!.body_text).toBe(body);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
