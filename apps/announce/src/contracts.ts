import { z } from "zod";
import type { AnnouncementDocument, ReleaseRecord } from "./types.js";
import { EVIDENCE_KINDS, RESOURCE_KINDS } from "./types.js";

// ---------------------------------------------------------------------------
// Vendored minimal mirror of the `@hasna/contracts` distribution schemas.
// Copied field-for-field from open-contracts branch feat/distribution-schemas
// at commit 2dc7de12cbc014f382a43db4a6407ad3c9f0b36e (src/schemas.ts).
// Only the shapes this package validates locally are mirrored, but every
// mirrored field keeps canonical strictness (UTC-only timestamps, kind enums,
// URI scheme allowlist, sha256 digests, resource-pointer locator coupling) so
// documents accepted here stay valid once `@hasna/contracts` ships and this
// module can delegate to `parseContract(SCHEMA_IDS.announcement, value)`.
// ---------------------------------------------------------------------------

export const SCHEMA_IDS = {
  announcement: "hasna.announcement.v1",
  release: "hasna.release.v1",
} as const;

export const AppIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "appId must be a lowercase slug like \"open-todos\"");

/** Canonical NpmPackageNameSchema mirror. */
export const NpmPackageNameSchema = z
  .string()
  .regex(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/, "must be a valid npm package name");

export const SemverSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    "must be a semver version",
  );

export const GitShaSchema = z.string().regex(/^[0-9a-f]{7,40}$/, "must be a git sha (7-40 hex chars)");

/** Canonical TimestampSchema mirror: UTC-only ISO datetimes (no offsets). */
export const TimestampSchema = z.string().datetime();

const NonEmptyStringSchema = z.string().trim().min(1);

/** Canonical UriSchema mirror: allowlisted URI schemes only. */
export const UriSchema = NonEmptyStringSchema.refine(
  (value) =>
    value.startsWith("artifact://") ||
    value.startsWith("repo://") ||
    value.startsWith("project://") ||
    value.startsWith("dashboard://") ||
    value.startsWith("render://") ||
    value.startsWith("integration://") ||
    value.startsWith("task://") ||
    value.startsWith("todo://") ||
    value.startsWith("file://") ||
    value.startsWith("files://") ||
    value.startsWith("mailery://") ||
    value.startsWith("conversation://") ||
    value.startsWith("knowledge://") ||
    value.startsWith("memento://") ||
    value.startsWith("https://") ||
    value.startsWith("http://") ||
    value.startsWith("git+https://"),
  "URI must use artifact://, repo://, project://, dashboard://, render://, integration://, task://, todo://, file://, files://, mailery://, conversation://, knowledge://, memento://, http(s)://, or git+https://",
);

export const Sha256DigestSchema = z.string().regex(/^[a-fA-F0-9]{64}$/, "must be a sha256 hex digest");

const TagsSchema = z.array(z.string().min(1)).default([]);

/** Canonical ResourceKindSchema mirror. */
export const ResourceKindSchema = z.enum(RESOURCE_KINDS);

/** Canonical EvidenceKindSchema mirror. */
export const EvidenceKindSchema = z.enum(EVIDENCE_KINDS);

export const ResourcePointerSchema = z
  .object({
    kind: ResourceKindSchema,
    id: z.string().min(1),
    name: z.string().min(1).optional(),
    uri: UriSchema.optional(),
    externalId: NonEmptyStringSchema.optional(),
    sourcePackage: NonEmptyStringSchema.optional(),
    tags: TagsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.uri && Boolean(value.externalId) !== Boolean(value.sourcePackage)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Resource pointers with external package locators require both sourcePackage and externalId",
        path: value.externalId ? ["sourcePackage"] : ["externalId"],
      });
    }
  });

export const EvidencePointerSchema = z
  .object({
    id: z.string().min(1),
    kind: EvidenceKindSchema.optional(),
    uri: UriSchema.optional(),
    sha256: Sha256DigestSchema.optional(),
    summary: z.string().min(1).optional(),
  })
  .strict();

export const PublishPathSchema = z.enum(["skill", "ci", "backfilled"]);

/** Mirror of the `hasna.release.v1` payload fields (used to validate compose input). */
export const ReleaseRecordSchema = z
  .object({
    appId: AppIdSchema,
    package: NpmPackageNameSchema,
    version: SemverSchema,
    gitSha: GitShaSchema,
    publishedAt: TimestampSchema,
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
    deliveredAt: TimestampSchema.optional(),
    detail: z.string().min(1).optional(),
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
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema.nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    campaignId: NonEmptyStringSchema,
    appId: AppIdSchema.optional(),
    releaseRef: ResourcePointerSchema.optional(),
    channels: z.array(AnnouncementChannelSchema).min(1),
    audienceRef: ResourcePointerSchema,
    sentAt: TimestampSchema,
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
