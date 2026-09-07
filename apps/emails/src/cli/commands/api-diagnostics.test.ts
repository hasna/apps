import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from "bun:test";
import { Command } from "commander";
import { startV1Stub, type V1Stub } from "../../test-support/v1-stub.js";
import { registerMiscCommands } from "./misc.remote.js";
import { registerInboxCommands } from "./inbox.remote.js";
let stub: V1Stub;
beforeAll(async () => {
  stub = await startV1Stub({ openapi: true });
});
afterAll(() => stub.stop());
beforeEach(async () => {
  await stub.reset();
  stub.applyEnv();
  process.env.EMAILS_SESSION_TOKEN = stub.apiKey;
});
afterEach(() => stub.clearEnv());
async function run(args: string[]) {
  const p = new Command();
  p.exitOverride();
  let data: any;
  registerMiscCommands(p, (x) => {
    data = x;
  });
  registerInboxCommands(p, (x) => {
    data = x;
  });
  await p.parseAsync(["bun", "emails", ...args]);
  return data;
}
test("delivery diagnosis uses server registry, not missing client S3 config", async () => {
  await stub.seed({
    sources: [
      {
        id: "source-1",
        name: "Mailbox",
        type: "gmail",
        status: "active",
        last_synced_at: "2026-09-07T00:00:00Z",
        settings_json: { password: "fixture-secret-not-for-output" },
      },
    ],
  });
  const report = await run(["doctor", "delivery", "person@example.com"]);
  expect(report.address).toBe("person@example.com");
  expect(
    report.checks.some(
      (x: any) =>
        x.name === "Inbound sources" && x.message.includes("1 registered"),
    ),
  ).toBe(true);
  expect(JSON.stringify(report)).not.toContain("fixture-secret-not-for-output");
  expect(JSON.stringify(report)).not.toContain("No S3 inbound bucket");
});
test("explain resolves the message and diagnoses its actual recipients", async () => {
  await stub.seed({
    messages: [
      {
        id: "mail-fixture",
        direction: "inbound",
        from_addr: "sender@example.com",
        to_addrs: ["one@example.com", "two@example.com"],
        subject: "private subject",
        body_text: "private body",
        received_at: "2026-09-07T00:00:00Z",
      },
    ],
  });
  const report = await run(["inbox", "explain", "mail-fixture"]);
  expect(report.email_id).toBe("mail-fixture");
  expect(report.recipients.map((x: any) => x.address)).toEqual([
    "one@example.com",
    "two@example.com",
  ]);
  expect(JSON.stringify(report)).not.toContain("private body");
});
test("realtime status reports registry evidence without inventing worker health", async () => {
  await stub.seed({
    sources: [
      {
        id: "source-1",
        name: "Mailbox",
        type: "gmail",
        status: "active",
        last_synced_at: "2026-09-07T00:00:00Z",
      },
    ],
  });
  const report = await run(["inbox", "realtime-status"]);
  expect(report.sources).toHaveLength(1);
  expect(report.complete).toBe(true);
  expect(report.worker_health.status).toBe("unknown");
});

test("source diagnostics enumerate beyond the server page limit", async () => {
  await stub.seed({
    sources: Array.from({ length: 501 }, (_, i) => ({
      id: `source-${String(i).padStart(4, "0")}`,
      name: `Mailbox ${i}`,
      type: "gmail",
      status: "active",
      created_at: "2026-09-07T00:00:00Z",
    })),
  });
  const report = await run(["inbox", "realtime-status"]);
  expect(report.complete).toBe(true);
  expect(report.sources).toHaveLength(501);
});
