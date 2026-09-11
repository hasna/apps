import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { Command } from "commander";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { registerEmailLogCommands } from "./email-log.remote.js";
import { registerMiscCommands } from "./misc.remote.js";
import {
  parseBatchCsv,
  sendApiBatch,
  sendApiTest,
} from "./api-send-composition.js";
let stub: V1Stub;
let dir: string;
beforeAll(async () => {
  stub = await startV1Stub();
  dir = mkdtempSync(join(tmpdir(), "emails-composition-"));
});
afterAll(() => {
  stub.stop();
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await stub.reset();
  stub.applyEnv();
  process.env.EMAILS_SESSION_TOKEN = stub.apiKey;
});
afterEach(() => {
  stub.clearEnv();
  process.exitCode = 0;
});
async function run(args: string[]) {
  const p = new Command();
  p.exitOverride();
  let data: any;
  registerEmailLogCommands(p, (x) => {
    data = x;
  });
  registerMiscCommands(p, (x) => {
    data = x;
  });
  await p.parseAsync(["bun", "emails", ...args]);
  return data;
}
test("test command sends through API and returns a receipt", async () => {
  const result = await run([
    "test",
    "--from",
    "sender@example.com",
    "--to",
    "recipient@example.com",
    "--idempotency-key",
    "test-fixture",
  ]);
  expect(result.id).toBeString();
  expect(await stub.list("messages")).toHaveLength(1);
});
test("batch renders quoted CSV via API and retry keys remain stable", async () => {
  await stub.seed({
    templates: [
      {
        id: "template-1",
        name: "welcome",
        subject_template: "Hello {{name}}",
        text_template: "Dear {{name}}",
        html_template: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
  });
  const csv = join(dir, "recipients.csv");
  writeFileSync(csv, 'email,name\nrecipient@example.com,"Doe, Jane"\n');
  const result = await run([
    "batch",
    "--csv",
    csv,
    "--template",
    "welcome",
    "--from",
    "sender@example.com",
    "--idempotency-key",
    "batch-fixture",
  ]);
  expect(result).toMatchObject({ sent: 1, failed: 0, total: 1 });
  expect((await stub.list("messages"))[0]).toMatchObject({
    subject: "Hello Doe, Jane",
    body_text: "Dear Doe, Jane",
  });
  const retry = await run([
    "batch",
    "--csv",
    csv,
    "--template",
    "welcome",
    "--from",
    "sender@example.com",
    "--idempotency-key",
    "batch-fixture",
  ]);
  expect(retry.receipts[0].idempotency_key).toBe(
    result.receipts[0].idempotency_key,
  );
  expect((await stub.sendStats()).providerCalls).toBe(1);
});
test("sent log supports sender and status before offset pagination", async () => {
  await stub.seed({
    messages: [0, 1, 2].map((i) => ({
      id: `sent-${i}`,
      direction: "outbound",
      from_addr: i === 0 ? "other@example.com" : "sender@example.com",
      to_addrs: ["recipient@example.com"],
      subject: String(i),
      status: "sent",
      received_at: `2026-09-0${3 - i}T00:00:00Z`,
    })),
  });
  const rows = await run([
    "log",
    "--from",
    "sender@example.com",
    "--status",
    "sent",
    "--offset",
    "1",
    "--limit",
    "1",
  ]);
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe("sent-2");
});

test("CSV validates the entire input including quoted newlines before any send", () => {
  expect(
    parseBatchCsv('email,name\r\na@example.com,"Jane\nDoe"\r\n')[0]!.name,
  ).toBe("Jane\nDoe");
  expect(() => parseBatchCsv("name\nJane")).toThrow("headers");
  expect(() =>
    parseBatchCsv("email,email\na@example.com,b@example.com"),
  ).toThrow("headers");
  expect(() => parseBatchCsv('email,name\na@example.com,"unfinished')).toThrow(
    "unterminated",
  );
  expect(() =>
    parseBatchCsv("email,name\na@example.com,ok\ninvalid,bad"),
  ).toThrow("row 3");
});
test("batch preserves provider/force and reports partial failure, pending, warnings and retry identities", async () => {
  await stub.seed({
    providers: [
      {
        id: "provider-fixture",
        name: "fixture",
        type: "sandbox",
        active: true,
      },
    ],
    templates: [
      {
        id: "template-1",
        name: "welcome",
        subject_template: "Hello",
        text_template: "Body",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
  });
  const csv = join(dir, "partial.csv");
  writeFileSync(csv, "email\na@example.com\nb@example.com\nc@example.com\n");
  const requests: any[] = [];
  const result = await sendApiBatch(
    {
      csv,
      template: "welcome",
      from: "sender@example.com",
      provider: "provider-fixture",
      force: true,
    },
    {
      send: async (input) => {
        requests.push(input);
        if (requests.length === 2) throw new Error("fixture rejection");
        return {
          id: "receipt",
          messageId: "message",
          ...(requests.length === 3
            ? { inProgress: true as const }
            : { warning: "fixture finalization warning" }),
        };
      },
    },
  );
  expect(result).toMatchObject({ sent: 1, pending: 1, failed: 1, total: 3 });
  expect(result.receipts[0]!.warning).toBe("fixture finalization warning");
  expect(result.errors[0]!.idempotency_key).toBe(requests[1].idempotencyKey);
  expect(
    requests.every(
      (r) => r.providerId === "provider-fixture" && r.allowSuppressedRecipients,
    ),
  ).toBe(true);
  expect(new Set(requests.map((r) => r.idempotencyKey)).size).toBe(3);
});
test("test command retains explicit provider selection and does not report pending as sent", async () => {
  await stub.seed({
    providers: [
      {
        id: "provider-fixture",
        name: "fixture",
        type: "sandbox",
        active: true,
      },
    ],
  });
  let request: any;
  const result = await sendApiTest(
    {
      from: "sender@example.com",
      to: "recipient@example.com",
      provider: "provider-fixture",
      idempotencyKey: "retry-fixture",
    },
    {
      send: async (input) => {
        request = input;
        return { id: "pending", messageId: "", inProgress: true };
      },
    },
  );
  expect(request).toMatchObject({
    providerId: "provider-fixture",
    idempotencyKey: "retry-fixture",
  });
  expect(result.inProgress).toBe(true);
});
test("batch reports server suppression as a partial failure and preserves nonzero CLI status", async () => {
  await stub.seed({
    templates: [
      {
        id: "template-1",
        name: "welcome",
        subject_template: "Hello",
        text_template: "Body",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    contacts: [
      { id: "blocked-contact", email: "blocked@example.com", suppressed: true },
    ],
  });
  const csv = join(dir, "suppression.csv");
  writeFileSync(csv, "email\nallowed@example.com\nblocked@example.com\n");
  const result = await run([
    "batch",
    "--csv",
    csv,
    "--template",
    "welcome",
    "--from",
    "sender@example.com",
  ]);
  expect(result).toMatchObject({ sent: 1, failed: 1, pending: 0, total: 2 });
  expect(process.exitCode).toBe(1);
  expect((await stub.sendStats()).providerCalls).toBe(1);
});
test("invalid trailing CSV recipient aborts before calling send", async () => {
  const csv = join(dir, "invalid.csv");
  writeFileSync(csv, "email\nallowed@example.com\ninvalid\n");
  let calls = 0;
  await expect(
    sendApiBatch(
      { csv, template: "welcome", from: "sender@example.com" },
      {
        send: async () => {
          calls++;
          return { id: "unexpected", messageId: "unexpected" };
        },
      },
    ),
  ).rejects.toThrow("row 3");
  expect(calls).toBe(0);
});
