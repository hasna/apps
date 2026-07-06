import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./index.js";

const dataDir = mkdtempSync(join(tmpdir(), "announce-cli-"));
const releaseFile = join(dataDir, "release.json");
let originalDataDir: string | undefined;
let logs: string[] = [];
const originalLog = console.log;

async function run(args: string[]): Promise<string> {
  logs = [];
  await main(["bun", "announce", ...args]);
  return logs.join("\n");
}

beforeAll(async () => {
  originalDataDir = process.env["ANNOUNCE_DATA_DIR"];
  process.env["ANNOUNCE_DATA_DIR"] = dataDir;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  await writeFile(
    releaseFile,
    JSON.stringify({
      appId: "open-todos",
      package: "@hasna/todos",
      version: "1.2.3",
      gitSha: "abc1234",
      publishedAt: "2026-07-06T09:00:00.000Z",
      publishPath: "ci",
      changelogRef: { kind: "changelog", id: "open-todos@1.2.3", uri: "https://example.com/changelog" },
      evidenceRefs: [{ id: "ev-1" }],
    }),
    "utf8",
  );
});

afterAll(() => {
  console.log = originalLog;
  if (originalDataDir === undefined) delete process.env["ANNOUNCE_DATA_DIR"];
  else process.env["ANNOUNCE_DATA_DIR"] = originalDataDir;
});

describe("announce CLI", () => {
  it("compose → send --dry-run → status → doc → report", async () => {
    const composeOut = await run([
      "compose",
      "--release",
      releaseFile,
      "--audience",
      "developers",
      "--channel",
      "email",
      "telegram",
      "--highlight",
      "Faster sync",
      "--campaign-id",
      "camp-cli-1",
    ]);
    expect(composeOut).toContain("camp-cli-1");

    const sendOut = await run(["send", "camp-cli-1", "--dry-run"]);
    const sendResult = JSON.parse(sendOut) as {
      dryRun: boolean;
      queued: boolean;
      channels: Array<{ channel: string; status: string; simulated: boolean }>;
      eventEmitted: boolean;
    };
    expect(sendResult.dryRun).toBe(true);
    expect(sendResult.queued).toBe(false);
    expect(sendResult.channels).toHaveLength(2);
    expect(sendResult.channels.every((channel) => channel.simulated)).toBe(true);
    expect(sendResult.eventEmitted).toBe(false);

    const statusOut = await run(["status", "camp-cli-1"]);
    const status = JSON.parse(statusOut) as Record<string, { status: string; simulated: boolean }>;
    expect(status.email!.status).toBe("sent");
    expect(status.email!.simulated).toBe(true);

    const docOut = await run(["doc", "camp-cli-1"]);
    const doc = JSON.parse(docOut) as { schema: string; metadata?: { simulated?: boolean } };
    expect(doc.schema).toBe("hasna.announcement.v1");
    expect(doc.metadata?.simulated).toBe(true);

    const reportOut = await run(["report", "camp-cli-1", "--mock"]);
    const report = JSON.parse(reportOut) as { totals: { sent: number; opens: number } };
    expect(report.totals.sent).toBe(2);
    expect(report.totals.opens).toBeGreaterThan(0);

    const listOut = await run(["list"]);
    expect(JSON.parse(listOut)).toContain("camp-cli-1");
  });

  it("queues a scheduled campaign", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await run([
      "compose",
      "--release",
      releaseFile,
      "--audience",
      "developers",
      "--campaign-id",
      "camp-cli-2",
      "--at",
      future,
    ]);
    const sendOut = await run(["send", "camp-cli-2", "--dry-run"]);
    const sendResult = JSON.parse(sendOut) as { queued: boolean };
    expect(sendResult.queued).toBe(true);
  });
});
