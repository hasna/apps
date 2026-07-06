export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ---------------------------------------------------------------------------
// Vendored structural mirrors of the `@hasna/contracts` distribution shapes
// (branch feat/distribution-schemas, not published yet). Keep in sync with
// `hasna.announcement.v1` / `hasna.release.v1` and the shared primitives.
// ---------------------------------------------------------------------------

/** Mirror of `@hasna/contracts` ResourcePointer. */
export interface ResourcePointer {
  kind: string;
  id: string;
  name?: string;
  uri?: string;
  externalId?: string;
  sourcePackage?: string;
  tags?: string[];
}

/** Mirror of `@hasna/contracts` EvidencePointer. */
export interface EvidencePointer {
  id: string;
  kind?: string;
  uri?: string;
  sha256?: string;
  summary?: string;
}

export type PublishPath = "skill" | "ci" | "backfilled";

/** Structural mirror of the `hasna.release.v1` payload fields used to compose campaigns. */
export interface ReleaseRecord {
  appId: string;
  package: string;
  version: string;
  gitSha: string;
  publishedAt: string;
  publishPath: PublishPath;
  changelogRef?: ResourcePointer;
  evidenceRefs?: EvidencePointer[];
}

/** Channel kinds accepted by the `hasna.announcement.v1` contract. */
export type AnnouncementChannelKind =
  | "email"
  | "telegram"
  | "slack"
  | "discord"
  | "x"
  | "blog"
  | "rss"
  | "webhook"
  | "github"
  | "other";

export type AnnouncementDeliveryStatus = "pending" | "queued" | "sent" | "failed" | "skipped" | "suppressed";

export interface AnnouncementChannelEntry {
  channel: AnnouncementChannelKind;
  status: AnnouncementDeliveryStatus;
  /** REQUIRED when status is "sent". */
  deliveredAt?: string;
  /** REQUIRED when status is "failed". */
  detail?: string;
}

/** Structural mirror of the `hasna.announcement.v1` document. */
export interface AnnouncementDocument {
  schema: "hasna.announcement.v1";
  id: string;
  createdAt: string;
  updatedAt?: string | null;
  metadata?: Record<string, unknown>;
  campaignId: string;
  appId?: string;
  releaseRef?: ResourcePointer;
  channels: AnnouncementChannelEntry[];
  audienceRef: ResourcePointer;
  sentAt: string;
}

// ---------------------------------------------------------------------------
// Campaign model (delivery half)
// ---------------------------------------------------------------------------

/** Delivery channels this package can render and deliver. */
export const DELIVERY_CHANNELS = ["email", "telegram", "conversations", "sms"] as const;
export type DeliveryChannel = (typeof DELIVERY_CHANNELS)[number];

/**
 * Contract channel kind each delivery channel maps to in
 * `hasna.announcement.v1` documents. `conversations` and `sms` are not part
 * of the contract channel enum yet, so they map to "other" and keep their
 * real channel name in the document metadata.
 */
export const CHANNEL_KIND_MAP: Record<DeliveryChannel, AnnouncementChannelKind> = {
  email: "email",
  telegram: "telegram",
  conversations: "other",
  sms: "other",
};

export interface CampaignAudience {
  audienceId: string;
  name?: string;
}

export interface ChangelogSummary {
  ref: ResourcePointer;
  highlights?: string[];
}

export interface AnnouncementCampaign {
  campaignId: string;
  appId: string;
  release: ReleaseRecord;
  changelog?: ChangelogSummary;
  audience: CampaignAudience;
  channels: DeliveryChannel[];
  /** Human headline; defaults to "<appId> <version> released". */
  title: string;
  /** Optional longer summary paragraph. */
  summary?: string;
  /** Links to include (release page, changelog, docs). Shortlink-wrapped at render time. */
  links: CampaignLink[];
  /** ISO datetime; when in the future, `deliverCampaign` queues instead of sending. */
  scheduledAt?: string;
  createdAt: string;
  metadata?: JsonObject;
}

export interface CampaignLink {
  label: string;
  url: string;
}

export interface ShortenedLink {
  label: string;
  originalUrl: string;
  shortUrl: string;
  slug: string;
}

export interface RenderedMessage {
  channel: DeliveryChannel;
  format: "html" | "markdown" | "text";
  subject?: string;
  body: string;
  /** Plain-text alternative for html messages. */
  textBody?: string;
  links: ShortenedLink[];
}

// ---------------------------------------------------------------------------
// Delivery ledger
// ---------------------------------------------------------------------------

export interface LedgerEntry {
  id: string;
  campaignId: string;
  appId: string;
  channel: DeliveryChannel;
  status: AnnouncementDeliveryStatus;
  /** True when the entry was written by a --dry-run (nothing was sent). */
  simulated: boolean;
  at: string;
  deliveredAt?: string;
  detail?: string;
  /** Adapter-provided external id (message id, post id, ...). */
  externalId?: string;
  renderedSubject?: string;
  renderedBytes?: number;
}

// ---------------------------------------------------------------------------
// Adapters (delivery)
// ---------------------------------------------------------------------------

export interface DeliveryResultInfo {
  ok: boolean;
  detail?: string;
  externalId?: string;
}

/**
 * One adapter per delivery channel. Real transports (mailery email,
 * open-bridge Telegram broadcast, conversations channel message, SMS) plug in
 * here; tests and --dry-run never call adapters.
 */
export interface DeliveryAdapter {
  channel: DeliveryChannel;
  deliver(message: RenderedMessage, campaign: AnnouncementCampaign): Promise<DeliveryResultInfo>;
}

export type DeliveryAdapters = Partial<Record<DeliveryChannel, DeliveryAdapter>>;

// ---------------------------------------------------------------------------
// Engagement half (kept separate from delivery — see lib/report.ts)
// ---------------------------------------------------------------------------

export interface MaileryEngagementEvent {
  campaignId: string;
  kind: "delivered" | "open" | "click" | "bounce" | "unsubscribe" | "complaint";
  recipient?: string;
  at: string;
  url?: string;
}

export interface MaileryEngagementAdapter {
  listEvents(campaignId: string): Promise<MaileryEngagementEvent[]>;
}

export interface AnalyticsEngagementAdapter {
  /** Page views / sessions attributed to the campaign (utm or referrer based). */
  campaignVisits(campaignId: string): Promise<{ visits: number; uniqueVisitors: number }>;
}

export interface ShortlinkClicksAdapter {
  clicks(slug: string): Promise<number>;
}

export interface ChannelEngagement {
  channel: DeliveryChannel;
  sent: number;
  delivered?: number;
  opens?: number;
  clicks?: number;
  bounces?: number;
  unsubscribes?: number;
}

export interface EngagementReport {
  campaignId: string;
  generatedAt: string;
  channels: ChannelEngagement[];
  shortlinks: Array<{ slug: string; clicks: number }>;
  visits?: { visits: number; uniqueVisitors: number };
  totals: { sent: number; opens: number; clicks: number };
}
