import { z } from "zod";
import type { AnnouncementDocument, ReleaseRecord } from "./types.js";

// ---------------------------------------------------------------------------
// Vendored minimal mirror of the `@hasna/contracts` distribution schemas
// (branch feat/distribution-schemas — not published yet). Only the shapes
// this package validates locally are mirrored. Once `@hasna/contracts` ships,
// this module can delegate to `parseContract(SCHEMA_IDS.announcement, value)`.
// ---------------------------------------------------------------------------

export const SCHEMA_IDS = {
  announcement: "hasna.announcement.v1",
  release: "hasna.release.v1",
} as const;

export const AppIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "appId must be a lowercase slug like \"open-todos\"");

export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, "must be a semver version");

export const GitShaSchema = z.string().regex(/^[0-9a-f]{7,40}$/, "must be a git sha (7-40 hex chars)");

const isoDatetime = z.string().datetime({ offset: true });

export const ResourcePointerSchema = z
  .object({
    kind: z.string().min(1),
    id: z.string().min(1),
    name: z.string().optional(),
    uri: z.string().optional(),
    externalId: z.string().optional(),
    sourcePackage: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .strict();

export const EvidencePointerSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().optional(),
    uri: z.string().optional(),
    sha256: z.string().optional(),
    summary: z.string().optional(),
  })
  .strict();

export const PublishPathSchema = z.enum(["skill", "ci", "backfilled"]);

/** Mirror of the `hasna.release.v1` payload fields (used to validate compose input). */
export const ReleaseRecordSchema = z
  .object({
    appId: AppIdSchema,
    package: z.string().min(1),
    version: SemverSchema,
    gitSha: GitShaSchema,
    publishedAt: isoDatetime,
    publishPath: PublishPathSchema,
    changelogRef: ResourcePointerSchema.optional(),
    evidenceRefs: z.array(EvidencePointerSchema).default([]),
  })
  .superRefine((value, ctx) => {
    if (value.publishPath !== "backfilled" && value.evidenceRefs.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["evidenceRefs"],
        message: "evidenceRefs must be non-empty unless publishPath is \"backfilled\"",
      });
    }
  });

export const AnnouncementChannelKindSchema = z.enum([
  "email",
  "telegram",
  "slack",
  "discord",
  "x",
  "blog",
  "rss",
  "webhook",
  "github",
  "other",
]);

export const AnnouncementDeliveryStatusSchema = z.enum([
  "pending",
  "queued",
  "sent",
  "failed",
  "skipped",
  "suppressed",
]);

export const AnnouncementChannelSchema = z
  .object({
    channel: AnnouncementChannelKindSchema,
    status: AnnouncementDeliveryStatusSchema,
    deliveredAt: isoDatetime.optional(),
    detail: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "sent" && !value.deliveredAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deliveredAt"],
        message: "deliveredAt is required when status is \"sent\"",
      });
    }
    if (value.status === "failed" && !value.detail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["detail"],
        message: "detail is required when status is \"failed\"",
      });
    }
  });

/** Mirror of `hasna.announcement.v1` (contract base + announcement payload, strict). */
export const AnnouncementSchema = z
  .object({
    schema: z.literal(SCHEMA_IDS.announcement),
    id: z.string().min(1),
    createdAt: isoDatetime,
    updatedAt: z.string().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    campaignId: z.string().min(1),
    appId: AppIdSchema.optional(),
    releaseRef: ResourcePointerSchema.optional(),
    channels: z.array(AnnouncementChannelSchema).min(1),
    audienceRef: ResourcePointerSchema,
    sentAt: isoDatetime,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.releaseRef && value.releaseRef.kind !== "release") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["releaseRef", "kind"],
        message: "releaseRef.kind must be \"release\"",
      });
    }
    if (value.audienceRef.kind !== "audience") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["audienceRef", "kind"],
        message: "audienceRef.kind must be \"audience\"",
      });
    }
  });

export function parseAnnouncement(value: unknown): AnnouncementDocument {
  return AnnouncementSchema.parse(value) as AnnouncementDocument;
}

export function parseReleaseRecord(value: unknown): ReleaseRecord {
  return ReleaseRecordSchema.parse(value) as ReleaseRecord;
}

export function contractErrorMessage(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}
