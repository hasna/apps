# Open Announce

`@hasna/announce` composes release announcements from release records and changelog refs, renders them per channel (email, Telegram, conversations, SMS), wraps URLs in shortlinks, keeps a per-channel delivery-status ledger, supports scheduling and `--dry-run`, and aggregates engagement into a campaign report.

Part of the Hasna distribution apps plan. Announcement documents follow the `hasna.announcement.v1` contract from `@hasna/contracts`, and `announcement.sent` events use the `@hasna/events` distribution event catalog.

## Install

```bash
bun add @hasna/announce
# or globally
bun add -g @hasna/announce
```

## CLI

```bash
# Compose a campaign file from a release record + changelog ref
announce compose --release release.json --audience developers --channel email --channel telegram --out campaign.json

# Dry-run: renders every channel and writes the ledger as simulated, sends nothing
announce send campaign.json --dry-run

# Real send (requires configured delivery adapters)
announce send campaign.json

# Schedule for later; `send` before the scheduled time queues instead of sending
announce send campaign.json --at 2026-07-08T09:00:00Z

# Per-channel delivery-status ledger
announce status <campaignId>

# hasna.announcement.v1 contract document built from the ledger
announce doc <campaignId>

# Engagement report (mailery events / analytics / shortlink clicks adapters)
announce report <campaignId> --mock
```

## Delivery half

- `composeAnnouncementCampaign` — build a campaign from a `hasna.release.v1`-shaped release record plus an optional changelog ref.
- Renderers — `renderEmail` (mailery-compatible HTML + text), `renderTelegram` (open-bridge broadcast post), `renderConversations` (channel message), `renderSms` (short-form).
- `ShortlinkAdapter` — mock adapter included; `@hasna/shortlinks` is used automatically when installed (optional peer dependency).
- `DeliveryLedger` — JSONL ledger under `~/.hasna/announce` (override with `ANNOUNCE_DATA_DIR`), one entry per channel attempt, `simulated: true` for dry-runs.
- `deliverCampaign` — scheduling + dry-run aware pipeline; emits `announcement.sent` through `@hasna/events` after real deliveries.

## Engagement half

Clearly separated in `@hasna/announce/report`: `aggregateEngagement` consumes `MaileryEngagementAdapter`, `AnalyticsEngagementAdapter`, and `ShortlinkClicksAdapter` interfaces (mocks included; real adapters are follow-ups).

## Library

```ts
import { composeAnnouncementCampaign, deliverCampaign, DeliveryLedger, MockShortlinkAdapter } from "@hasna/announce";

const campaign = composeAnnouncementCampaign({
  release: { appId: "open-todos", package: "@hasna/todos", version: "1.2.3", gitSha: "a".repeat(7), publishedAt: new Date().toISOString(), publishPath: "ci" },
  changelogRef: { kind: "document", id: "open-todos@1.2.3", uri: "https://github.com/hasna/open-todos/releases/tag/v1.2.3" },
  audience: { audienceId: "developers", name: "Developers" },
  channels: ["email", "telegram"],
});

const result = await deliverCampaign(campaign, { dryRun: true, shortlinks: new MockShortlinkAdapter() });
```

## License

Apache-2.0
