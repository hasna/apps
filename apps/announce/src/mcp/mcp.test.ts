// Agent-authored (TEST-GAP protocol): the gpt-5.6-sol consult terminated
// twice without delivering a spec (session died mid-audit; resume timed out),
// so this file carries no SOL attribution.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAnnounceMcpServer } from "./index.js";

const dataDir = mkdtempSync(join(tmpdir(), "announce-mcp-"));
let originalDataDir: string | undefined;
let client: Client;

beforeAll(async () => {
  originalDataDir = process.env["ANNOUNCE_DATA_DIR"];
  process.env["ANNOUNCE_DATA_DIR"] = dataDir;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "announce-mcp-test", version: "1.0.0" });
  const server = createAnnounceMcpServer();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(async () => {
  await client.close();
  if (originalDataDir === undefined) delete process.env["ANNOUNCE_DATA_DIR"];
  else process.env["ANNOUNCE_DATA_DIR"] = originalDataDir;
});

describe("announce MCP server", () => {
  it("registers the four campaign tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "campaign_report",
      "campaign_status",
      "list_campaigns",
      "send_campaign_dry_run",
    ]);
  });

  it("list_campaigns returns the stored campaigns and campaign_status returns {} for unknown ids", async () => {
    const listed = await client.callTool({ name: "list_campaigns", arguments: {} });
    const parsed = JSON.parse((listed.content as Array<{ type: string; text: string }>)[0]!.text) as string[];
    expect(parsed).toEqual([]);

    const status = await client.callTool({
      name: "campaign_status",
      arguments: { campaign_id: "does-not-exist" },
    });
    const statusParsed = JSON.parse((status.content as Array<{ type: string; text: string }>)[0]!.text) as object;
    // channelStatus of an unknown campaign is an empty map, reported as {} —
    // the MCP surface must not invent a fake "no status" sentinel.
    expect(statusParsed).toEqual({});
  });

  it("send_campaign_dry_run rejects unknown campaigns with isError", async () => {
    const result = await client.callTool({
      name: "send_campaign_dry_run",
      arguments: { campaign_id: "does-not-exist" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Campaign not found");
  });

  it("send_campaign_dry_run renders a stored campaign as simulated and campaign_report aggregates it", async () => {
    // Seed a campaign through the same store the server tools use.
    const release = {
      appId: "open-todos",
      package: "@hasna/todos",
      version: "1.2.3",
      gitSha: "abc1234",
      publishedAt: "2026-07-06T09:00:00.000Z",
      publishPath: "ci",
      changelogRef: { kind: "document", id: "open-todos@1.2.3", uri: "https://example.com/changelog" },
      evidenceRefs: [{ id: "ev-1" }],
    };
    const campaign = {
      campaignId: "camp-mcp-1",
      appId: "open-todos",
      release,
      audience: { audienceId: "developers" },
      channels: ["email", "telegram"],
      title: "open-todos 1.2.3 released",
      links: [{ label: "Package", url: "https://www.npmjs.com/package/@hasna/todos/v/1.2.3" }],
      createdAt: "2026-07-06T09:00:00.000Z",
    };
    await writeFile(
      join(dataDir, "campaigns", "camp-mcp-1.json"),
      `${JSON.stringify(campaign, null, 2)}\n`,
      "utf8",
    );

    const dryRun = await client.callTool({
      name: "send_campaign_dry_run",
      arguments: { campaign_id: "camp-mcp-1" },
    });
    expect(dryRun.isError).toBeUndefined();
    const dryRunParsed = JSON.parse((dryRun.content as Array<{ type: string; text: string }>)[0]!.text) as {
      campaignId: string;
      channels: Array<{ channel: string; status: string; simulated: boolean }>;
    };
    expect(dryRunParsed.campaignId).toBe("camp-mcp-1");
    expect(dryRunParsed.channels).toHaveLength(2);
    expect(dryRunParsed.channels.every((channel) => channel.status === "sent" && channel.simulated)).toBe(true);

    const report = await client.callTool({
      name: "campaign_report",
      arguments: { campaign_id: "camp-mcp-1" },
    });
    const reportParsed = JSON.parse((report.content as Array<{ type: string; text: string }>)[0]!.text) as {
      totals: { sent: number };
    };
    expect(reportParsed.totals.sent).toBe(2);
  });
});
