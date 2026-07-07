import { existsSync, mkdirSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ReleaseRecordSchema, ResourcePointerSchema } from "../contracts.js";
import type { AnnouncementCampaign } from "../types.js";
import { DELIVERY_CHANNELS } from "../types.js";
import { resolveAnnounceDataDir } from "./ledger.js";

const isoDatetime = z.string().datetime({ offset: true });

export const CampaignSchema = z.object({
  campaignId: z.string().min(1),
  appId: z.string().min(1),
  release: ReleaseRecordSchema,
  changelog: z
    .object({
      ref: ResourcePointerSchema,
      highlights: z.array(z.string()).optional(),
    })
    .optional(),
  audience: z.object({ audienceId: z.string().min(1), name: z.string().optional() }),
  channels: z.array(z.enum(DELIVERY_CHANNELS)).min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  links: z.array(z.object({ label: z.string().min(1), url: z.string().url() })),
  scheduledAt: isoDatetime.optional(),
  createdAt: isoDatetime,
  metadata: z.record(z.unknown()).optional(),
});

export function parseCampaign(value: unknown): AnnouncementCampaign {
  return CampaignSchema.parse(value) as AnnouncementCampaign;
}

export interface CampaignStoreOptions {
  dataDir?: string;
}

/** Saves composed campaigns under `<dataDir>/campaigns/<campaignId>.json`. */
export class CampaignStore {
  readonly dir: string;

  constructor(options: CampaignStoreOptions = {}) {
    this.dir = join(resolveAnnounceDataDir(options.dataDir), "campaigns");
    mkdirSync(this.dir, { recursive: true });
  }

  private pathFor(campaignId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@-]*$/.test(campaignId)) {
      throw new Error(`Invalid campaign id: ${campaignId}`);
    }
    return join(this.dir, `${campaignId}.json`);
  }

  async save(campaign: AnnouncementCampaign): Promise<string> {
    const filePath = this.pathFor(campaign.campaignId);
    await writeFile(filePath, `${JSON.stringify(campaign, null, 2)}\n`, "utf8");
    return filePath;
  }

  async load(campaignId: string): Promise<AnnouncementCampaign | null> {
    const filePath = this.pathFor(campaignId);
    if (!existsSync(filePath)) return null;
    return parseCampaign(JSON.parse(await readFile(filePath, "utf8")));
  }

  async list(): Promise<string[]> {
    const names = await readdir(this.dir);
    return names
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length))
      .sort();
  }
}
