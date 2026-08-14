export * from "./types.js";
export * from "./contracts.js";
export * from "./events.js";
export { composeAnnouncementCampaign, assertDeliveryChannels } from "./lib/compose.js";
export type { ComposeCampaignInput } from "./lib/compose.js";
export {
  DeliveryLedger,
  resolveAnnounceDataDir,
  DEFAULT_DATA_DIR,
  DEFAULT_LEDGER_FILE,
} from "./lib/ledger.js";
export type { DeliveryLedgerOptions, AppendEntryInput } from "./lib/ledger.js";
export { CampaignStore, parseCampaign, CampaignSchema } from "./lib/campaigns.js";
export type { CampaignStoreOptions } from "./lib/campaigns.js";
export { deliverCampaign } from "./lib/deliver.js";
export type { DeliverCampaignOptions, DeliveryRunResult } from "./lib/deliver.js";
export {
  MockShortlinkAdapter,
  NoopShortlinkAdapter,
  ShortlinksPackageAdapter,
  resolveShortlinkAdapter,
  shortenLinks,
} from "./lib/shortlinks.js";
export type { ShortlinkAdapter, ShortenOptions } from "./lib/shortlinks.js";
export {
  CHANNEL_RENDERERS,
  renderChannel,
  renderConversations,
  renderEmail,
  renderSms,
  renderTelegram,
} from "./lib/render/index.js";
export type { ChannelRenderer } from "./lib/render/index.js";
export {
  aggregateEngagement,
  MockAnalyticsEngagementAdapter,
  MockMaileryEngagementAdapter,
  MockShortlinkClicksAdapter,
} from "./lib/report.js";
export type { AggregateEngagementOptions, EngagementSources } from "./lib/report.js";
export { VERSION } from "./version.js";
