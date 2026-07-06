import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseAnnouncement } from "../contracts.js";
import type {
  AnnouncementCampaign,
  AnnouncementChannelEntry,
  AnnouncementDeliveryStatus,
  AnnouncementDocument,
  DeliveryChannel,
  LedgerEntry,
} from "../types.js";
import { CHANNEL_KIND_MAP } from "../types.js";

export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", "announce");
export const DEFAULT_LEDGER_FILE = "ledger.jsonl";

export function resolveAnnounceDataDir(dataDir = process.env["ANNOUNCE_DATA_DIR"]): string {
  return dataDir && dataDir.trim() ? dataDir : DEFAULT_DATA_DIR;
}

export interface DeliveryLedgerOptions {
  dataDir?: string;
  filePath?: string;
}

export interface AppendEntryInput {
  campaignId: string;
  appId: string;
  channel: DeliveryChannel;
  status: AnnouncementDeliveryStatus;
  simulated?: boolean;
  at?: string;
  deliveredAt?: string;
  detail?: string;
  externalId?: string;
  renderedSubject?: string;
  renderedBytes?: number;
}

/**
 * Append-only per-channel delivery-status ledger (JSONL). The latest entry
 * per (campaignId, channel) is the current status.
 */
export class DeliveryLedger {
  readonly filePath: string;

  constructor(options: DeliveryLedgerOptions = {}) {
    this.filePath = options.filePath ?? join(resolveAnnounceDataDir(options.dataDir), DEFAULT_LEDGER_FILE);
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  async append(input: AppendEntryInput): Promise<LedgerEntry> {
    const entry: LedgerEntry = {
      id: randomUUID(),
      campaignId: input.campaignId,
      appId: input.appId,
      channel: input.channel,
      status: input.status,
      simulated: input.simulated ?? false,
      at: input.at ?? new Date().toISOString(),
      deliveredAt: input.deliveredAt,
      detail: input.detail,
      externalId: input.externalId,
      renderedSubject: input.renderedSubject,
      renderedBytes: input.renderedBytes,
    };
    if (entry.status === "sent" && !entry.deliveredAt) {
      throw new Error("ledger entries with status \"sent\" require deliveredAt");
    }
    if (entry.status === "failed" && !entry.detail) {
      throw new Error("ledger entries with status \"failed\" require detail");
    }
    await appendFile(this.filePath, `${JSON.stringify(entry)}\n`, "utf8");
    return entry;
  }

  async list(campaignId?: string): Promise<LedgerEntry[]> {
    if (!existsSync(this.filePath)) return [];
    const raw = await readFile(this.filePath, "utf8");
    const entries = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LedgerEntry);
    return campaignId ? entries.filter((entry) => entry.campaignId === campaignId) : entries;
  }

  /** Latest entry per channel for one campaign. */
  async channelStatus(campaignId: string): Promise<Map<DeliveryChannel, LedgerEntry>> {
    const latest = new Map<DeliveryChannel, LedgerEntry>();
    for (const entry of await this.list(campaignId)) {
      latest.set(entry.channel, entry);
    }
    return latest;
  }

  /**
   * Build a `hasna.announcement.v1` document from the ledger state for a
   * campaign. Validated against the vendored contract mirror before return.
   */
  async toAnnouncementDocument(
    campaign: AnnouncementCampaign,
    options: { now?: Date } = {},
  ): Promise<AnnouncementDocument> {
    const status = await this.channelStatus(campaign.campaignId);
    if (status.size === 0) {
      throw new Error(`No ledger entries for campaign: ${campaign.campaignId}`);
    }
    const channels: AnnouncementChannelEntry[] = [...status.values()].map((entry) => ({
      channel: CHANNEL_KIND_MAP[entry.channel],
      status: entry.status,
      ...(entry.deliveredAt ? { deliveredAt: entry.deliveredAt } : {}),
      ...(entry.detail ? { detail: entry.detail } : {}),
    }));
    const anySimulated = [...status.values()].some((entry) => entry.simulated);
    const sentAt =
      [...status.values()]
        .map((entry) => entry.deliveredAt ?? entry.at)
        .sort()
        .at(-1) ?? (options.now ?? new Date()).toISOString();
    const document: AnnouncementDocument = {
      schema: "hasna.announcement.v1",
      id: `ann-${campaign.campaignId}`,
      createdAt: campaign.createdAt,
      campaignId: campaign.campaignId,
      appId: campaign.appId,
      releaseRef: {
        kind: "release",
        id: `${campaign.release.package}@${campaign.release.version}`,
        sourcePackage: campaign.release.package,
      },
      channels,
      audienceRef: {
        kind: "audience",
        id: campaign.audience.audienceId,
        ...(campaign.audience.name ? { name: campaign.audience.name } : {}),
      },
      sentAt,
      metadata: {
        simulated: anySimulated,
        deliveryChannels: [...status.keys()],
      },
    };
    return parseAnnouncement(document);
  }
}
