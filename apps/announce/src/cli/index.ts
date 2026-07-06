#!/usr/bin/env bun
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { contractErrorMessage } from "../contracts.js";
import { composeAnnouncementCampaign, assertDeliveryChannels } from "../lib/compose.js";
import { CampaignStore, parseCampaign } from "../lib/campaigns.js";
import { deliverCampaign } from "../lib/deliver.js";
import { DeliveryLedger, resolveAnnounceDataDir } from "../lib/ledger.js";
import {
  aggregateEngagement,
  MockAnalyticsEngagementAdapter,
  MockMaileryEngagementAdapter,
  MockShortlinkClicksAdapter,
} from "../lib/report.js";
import { MockShortlinkAdapter, resolveShortlinkAdapter } from "../lib/shortlinks.js";
import type { MaileryEngagementEvent, ResourcePointer } from "../types.js";
import { VERSION } from "../version.js";

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("announce")
    .description("Compose, deliver, and report on release announcements")
    .version(VERSION);

  program
    .command("init")
    .description("Create the local Open Announce data directory")
    .action(() => {
      const dataDir = resolveAnnounceDataDir();
      new DeliveryLedger({ dataDir });
      printJson({ dataDir });
    });

  program
    .command("compose")
    .description("Compose an announcement campaign from a release record + changelog ref")
    .requiredOption("--release <file>", "hasna.release.v1-shaped release record JSON file")
    .requiredOption("--audience <audienceId>", "Audience id (hasna.audience.v1 audienceId)")
    .option("--audience-name <name>", "Human audience name")
    .option("--channel <channel...>", "Delivery channel (email, telegram, conversations, sms)", ["email"])
    .option("--title <title>", "Announcement headline")
    .option("--summary <text>", "Longer summary paragraph")
    .option("--highlight <text...>", "Changelog highlight bullet; repeatable")
    .option("--changelog-id <id>", "Changelog entry id for the changelogRef pointer")
    .option("--changelog-uri <uri>", "Changelog entry URI for the changelogRef pointer")
    .option("--campaign-id <id>", "Explicit campaign id")
    .option("--at <iso>", "Schedule delivery for this ISO datetime")
    .option("--out <file>", "Also write the campaign JSON to this file")
    .action(async (options: Record<string, string | string[] | undefined>) => {
      try {
        const channels = options.channel as string[];
        assertDeliveryChannels(channels);
        const changelogRef: ResourcePointer | undefined =
          options.changelogId || options.changelogUri
            ? {
                kind: "changelog",
                id: (options.changelogId as string | undefined) ?? (options.changelogUri as string),
                uri: options.changelogUri as string | undefined,
              }
            : undefined;
        const campaign = composeAnnouncementCampaign({
          release: (await readJsonFile(options.release as string)) as never,
          changelogRef,
          highlights: options.highlight as string[] | undefined,
          audience: {
            audienceId: options.audience as string,
            name: options.audienceName as string | undefined,
          },
          channels,
          campaignId: options.campaignId as string | undefined,
          title: options.title as string | undefined,
          summary: options.summary as string | undefined,
          scheduledAt: options.at as string | undefined,
        });
        const store = new CampaignStore();
        const savedTo = await store.save(campaign);
        if (options.out) await writeFile(options.out as string, `${JSON.stringify(campaign, null, 2)}\n`, "utf8");
        printJson({ savedTo, campaign });
      } catch (error) {
        fail(contractErrorMessage(error));
      }
    });

  program
    .command("send")
    .description("Deliver a campaign (by id or campaign JSON file)")
    .argument("<campaign>", "Campaign id or path to a campaign JSON file")
    .option("--dry-run", "Render everything and write the ledger as simulated without sending", false)
    .option("--force", "Send even when scheduledAt is still in the future", false)
    .option("--mock-shortlinks", "Use the deterministic mock shortlink adapter", false)
    .action(async (campaignRef: string, options: { dryRun: boolean; force: boolean; mockShortlinks: boolean }) => {
      try {
        const store = new CampaignStore();
        const campaign = campaignRef.endsWith(".json")
          ? parseCampaign(await readJsonFile(campaignRef))
          : await store.load(campaignRef);
        if (!campaign) fail(`Campaign not found: ${campaignRef}`);
        await store.save(campaign);
        const shortlinks = options.mockShortlinks || options.dryRun
          ? new MockShortlinkAdapter()
          : await resolveShortlinkAdapter();
        const result = await deliverCampaign(campaign, {
          dryRun: options.dryRun,
          force: options.force,
          shortlinks,
        });
        printJson({
          campaignId: result.campaignId,
          dryRun: result.dryRun,
          queued: result.queued,
          channels: result.entries.map((entry) => ({
            channel: entry.channel,
            status: entry.status,
            simulated: entry.simulated,
            detail: entry.detail,
          })),
          eventEmitted: Boolean(result.event),
        });
        if (result.entries.some((entry) => entry.status === "failed")) process.exitCode = 1;
      } catch (error) {
        fail(contractErrorMessage(error));
      }
    });

  program
    .command("status")
    .description("Per-channel delivery-status ledger for a campaign")
    .argument("<campaignId>", "Campaign id")
    .option("--all", "Show every ledger entry, not just the latest per channel", false)
    .action(async (campaignId: string, options: { all: boolean }) => {
      const ledger = new DeliveryLedger();
      if (options.all) {
        printJson(await ledger.list(campaignId));
        return;
      }
      const status = await ledger.channelStatus(campaignId);
      if (status.size === 0) fail(`No ledger entries for campaign: ${campaignId}`);
      printJson(Object.fromEntries(status));
    });

  program
    .command("doc")
    .description("Build the hasna.announcement.v1 document for a campaign from the ledger")
    .argument("<campaignId>", "Campaign id")
    .action(async (campaignId: string) => {
      try {
        const campaign = await new CampaignStore().load(campaignId);
        if (!campaign) fail(`Campaign not found: ${campaignId}`);
        printJson(await new DeliveryLedger().toAnnouncementDocument(campaign));
      } catch (error) {
        fail(contractErrorMessage(error));
      }
    });

  program
    .command("list")
    .description("List stored campaigns")
    .action(async () => {
      printJson(await new CampaignStore().list());
    });

  program
    .command("report")
    .description("Aggregate engagement for a campaign (mailery events, analytics, shortlink clicks)")
    .argument("<campaignId>", "Campaign id")
    .option("--mock", "Use mock engagement adapters with sample data", false)
    .action(async (campaignId: string, options: { mock: boolean }) => {
      try {
        const ledger = new DeliveryLedger();
        if (!options.mock) {
          // Real engagement adapters are follow-ups; without --mock only
          // ledger-derived counts are reported.
          printJson(await aggregateEngagement(campaignId, { ledger }));
          return;
        }
        const entries = await ledger.list(campaignId);
        const sampleEvents: MaileryEngagementEvent[] = entries
          .filter((entry) => entry.channel === "email" && entry.status === "sent")
          .flatMap((entry) => [
            { campaignId, kind: "delivered" as const, at: entry.at },
            { campaignId, kind: "open" as const, at: entry.at },
          ]);
        const clickMap = Object.fromEntries(
          [...new Set(entries.map((entry) => `${entry.campaignId}:${entry.channel}`))].map((slug) => [slug, 1]),
        );
        printJson(
          await aggregateEngagement(campaignId, {
            ledger,
            mailery: new MockMaileryEngagementAdapter(sampleEvents),
            analytics: new MockAnalyticsEngagementAdapter({ visits: 10, uniqueVisitors: 7 }),
            shortlinkClicks: new MockShortlinkClicksAdapter(clickMap),
          }),
        );
      } catch (error) {
        fail(contractErrorMessage(error));
      }
    });

  await program.parseAsync(argv);
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/cli/index.ts") ||
  process.argv[1]?.endsWith("/cli/index.js");

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
