#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { contractErrorMessage } from "../contracts.js";
import { CampaignStore } from "../lib/campaigns.js";
import { deliverCampaign } from "../lib/deliver.js";
import { DeliveryLedger } from "../lib/ledger.js";
import { aggregateEngagement } from "../lib/report.js";
import { MockShortlinkAdapter } from "../lib/shortlinks.js";
import { VERSION } from "../version.js";

function jsonContent(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorContent(error: unknown): CallToolResult {
  return { content: [{ type: "text", text: contractErrorMessage(error) }], isError: true };
}

export function createAnnounceMcpServer(): McpServer {
  const server = new McpServer({ name: "announce", version: VERSION });

  server.tool(
    "list_campaigns",
    "List stored announcement campaign ids.",
    {},
    async () => {
      try {
        return jsonContent(await new CampaignStore().list());
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "campaign_status",
    "Per-channel delivery-status ledger for a campaign.",
    { campaign_id: z.string().describe("Campaign id") },
    async (input) => {
      try {
        const status = await new DeliveryLedger().channelStatus(String(input.campaign_id));
        return jsonContent(Object.fromEntries(status));
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "send_campaign_dry_run",
    "Dry-run a stored campaign: render every channel and write the ledger as simulated without sending.",
    { campaign_id: z.string().describe("Campaign id") },
    async (input) => {
      try {
        const campaign = await new CampaignStore().load(String(input.campaign_id));
        if (!campaign) return errorContent(new Error(`Campaign not found: ${String(input.campaign_id)}`));
        const result = await deliverCampaign(campaign, { dryRun: true, shortlinks: new MockShortlinkAdapter() });
        return jsonContent({
          campaignId: result.campaignId,
          queued: result.queued,
          channels: result.entries.map((entry) => ({ channel: entry.channel, status: entry.status, simulated: entry.simulated })),
        });
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  server.tool(
    "campaign_report",
    "Aggregate engagement for a campaign from the delivery ledger (real adapters are follow-ups).",
    { campaign_id: z.string().describe("Campaign id") },
    async (input) => {
      try {
        return jsonContent(await aggregateEngagement(String(input.campaign_id)));
      } catch (error) {
        return errorContent(error);
      }
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createAnnounceMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/mcp/index.ts") ||
  process.argv[1]?.endsWith("/mcp/index.js");

if (isDirectRun) {
  startMcpServer().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
