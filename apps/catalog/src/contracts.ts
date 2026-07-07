// ---------------------------------------------------------------------------
// Vendored minimal mirror of the Hasna distribution contracts.
//
// Source of truth: @hasna/contracts, branch `feat/distribution-schemas`
// (src/schemas.ts) and @hasna/events, branch `feat/distribution-event-catalog`
// (src/catalog.ts). Neither branch is published to npm yet, so this package
// vendors a structural mirror of exactly the pieces it needs:
//
//   - hasna.app.v1 (AppSchema) — the catalog's canonical app identity record
//   - hasna.rollout_record.v1 (RolloutRecordSchema) — validated by the
//     read-only rollout ingestion hook (no persistence)
//   - the distribution event type names emitted through @hasna/events
//
// Once @hasna/contracts ships these schemas, replace this file with
// `import { ... } from "@hasna/contracts/schemas"`.
// ---------------------------------------------------------------------------

import { z } from "zod";

export const SCHEMA_IDS = {
  app: "hasna.app.v1",
  release: "hasna.release.v1",
  rolloutRecord: "hasna.rollout_record.v1",
  announcement: "hasna.announcement.v1",
  audience: "hasna.audience.v1",
} as const;

export const TimestampSchema = z.string().datetime();
export const NonEmptyStringSchema = z.string().trim().min(1);
export const MetadataSchema = z.record(z.unknown());
export const TagsSchema = z.array(z.string().min(1)).default([]);
export const OptionalTimestampSchema = TimestampSchema.nullable().optional();
export const Sha256DigestSchema = z.string().regex(/^[a-fA-F0-9]{64}$/);

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
  "URI must use a recognized scheme"
);

export const ContractStatusSchema = z.enum([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "blocked",
  "skipped",
  "unknown",
]);
export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export function contractBaseSchema<TSchema extends string>(schema: TSchema) {
  return z
    .object({
      schema: z.literal(schema),
      id: z.string().min(1),
      createdAt: TimestampSchema,
      updatedAt: OptionalTimestampSchema,
      metadata: MetadataSchema.optional(),
    })
    .strict();
}

// --- shared distribution primitives ---------------------------------------

/** Stable lowercase dashed app identity slug, e.g. `open-todos`. */
export const AppIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "App ids must be lowercase dashed identifiers");
export type AppId = z.infer<typeof AppIdSchema>;

/** npm package name, scoped or unscoped, e.g. `@hasna/todos`. */
export const NpmPackageNameSchema = z
  .string()
  .regex(/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/, "Must be a valid npm package name");
export type NpmPackageName = z.infer<typeof NpmPackageNameSchema>;

/** Semver version string, e.g. `1.2.3`, `1.2.3-beta.1`. */
export const SemverSchema = z
  .string()
  .regex(
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
    "Must be a semver version"
  );
export type Semver = z.infer<typeof SemverSchema>;

/** Lowercase git commit sha, abbreviated (>=7) or full (40). */
export const GitShaSchema = z.string().regex(/^[0-9a-f]{7,40}$/, "Must be a lowercase git sha (7-40 hex chars)");
export type GitSha = z.infer<typeof GitShaSchema>;

export const GithubUrlSchema = NonEmptyStringSchema.refine(
  (value) => value.startsWith("https://github.com/") || value.startsWith("git+https://github.com/"),
  "GitHub URLs must start with https://github.com/ or git+https://github.com/"
);

export const ProjectSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Project slugs must be lowercase dashed identifiers");
export type ProjectSlug = z.infer<typeof ProjectSlugSchema>;

export const EvidencePointerSchema = z
  .object({
    id: z.string().min(1),
    kind: z.string().min(1).optional(),
    uri: UriSchema.optional(),
    sha256: Sha256DigestSchema.optional(),
    summary: z.string().min(1).optional(),
  })
  .strict();
export type EvidencePointer = z.infer<typeof EvidencePointerSchema>;

// --- hasna.app.v1 ----------------------------------------------------------

export const AppLifecycleSchema = z.enum(["active", "stub", "deprecated", "archived"]);
export type AppLifecycle = z.infer<typeof AppLifecycleSchema>;

export const ReleaseChannelSchema = z.enum(["stable", "beta", "canary", "internal"]);
export type ReleaseChannel = z.infer<typeof ReleaseChannelSchema>;

export const AppMcpSurfaceSchema = z
  .object({
    transport: z.enum(["http", "stdio"]).default("http"),
    bin: z.string().min(1).optional(),
    url: UriSchema.optional(),
  })
  .strict();
export type AppMcpSurface = z.infer<typeof AppMcpSurfaceSchema>;

export const AppHttpSurfaceSchema = z
  .object({
    healthPath: z.string().min(1).default("/health"),
    port: z.number().int().positive().optional(),
    baseUrl: UriSchema.optional(),
  })
  .strict();
export type AppHttpSurface = z.infer<typeof AppHttpSurfaceSchema>;

export const AppSurfacesSchema = z
  .object({
    bins: z.array(z.string().min(1)).default([]),
    mcp: AppMcpSurfaceSchema.optional(),
    http: AppHttpSurfaceSchema.optional(),
  })
  .strict();
export type AppSurfaces = z.infer<typeof AppSurfacesSchema>;

export const AppSchema = contractBaseSchema(SCHEMA_IDS.app)
  .extend({
    appId: AppIdSchema,
    npmName: NpmPackageNameSchema,
    repoFolder: AppIdSchema,
    githubUrl: GithubUrlSchema,
    projectSlug: ProjectSlugSchema,
    surfaces: AppSurfacesSchema.default({}),
    lifecycle: AppLifecycleSchema,
    releaseChannel: ReleaseChannelSchema.default("stable"),
    summary: z.string().min(1).optional(),
    tags: TagsSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const seenBins = new Set<string>();
    for (const [index, bin] of value.surfaces.bins.entries()) {
      if (seenBins.has(bin)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "App surface bins must be unique",
          path: ["surfaces", "bins", index],
        });
      }
      seenBins.add(bin);
    }
  });
export type App = z.infer<typeof AppSchema>;
export type AppInput = z.input<typeof AppSchema>;

// --- hasna.rollout_record.v1 ------------------------------------------------

export const RolloutActionSchema = z.enum(["install", "update", "rollback", "freeze-blocked"]);
export type RolloutAction = z.infer<typeof RolloutActionSchema>;

export const RolloutVerificationSchema = z
  .object({
    cliVersion: z.string().min(1).optional(),
    mcpHealth: z.enum(["ok", "degraded", "unavailable", "not_checked"]).optional(),
  })
  .strict();
export type RolloutVerification = z.infer<typeof RolloutVerificationSchema>;

export const RolloutRecordSchema = contractBaseSchema(SCHEMA_IDS.rolloutRecord)
  .extend({
    appId: AppIdSchema,
    package: NpmPackageNameSchema,
    version: SemverSchema,
    machine: NonEmptyStringSchema,
    action: RolloutActionSchema,
    result: ContractStatusSchema,
    verifiedBy: RolloutVerificationSchema.optional(),
    at: TimestampSchema,
    evidenceRefs: z.array(EvidencePointerSchema).default([]),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === "freeze-blocked" && value.result !== "blocked" && value.result !== "skipped") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "freeze-blocked rollout records must report result blocked or skipped",
        path: ["result"],
      });
    }
    if ((value.action === "install" || value.action === "update") && value.result === "succeeded" && !value.verifiedBy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Succeeded install/update rollout records require verifiedBy",
        path: ["verifiedBy"],
      });
    }
  });
export type RolloutRecord = z.infer<typeof RolloutRecordSchema>;
export type RolloutRecordInput = z.input<typeof RolloutRecordSchema>;

// --- @hasna/events distribution event types (mirror) ------------------------

export const DISTRIBUTION_EVENT_TYPES = {
  releasePublished: "release.published",
  rolloutStarted: "release.rollout.started",
  rolloutCompleted: "release.rollout.completed",
  rolloutFailed: "release.rollout.failed",
  appInstalled: "app.installed",
  announcementSent: "announcement.sent",
  feedbackCreated: "feedback.created",
  feedbackTriaged: "feedback.triaged",
} as const;
export type DistributionEventType = (typeof DISTRIBUTION_EVENT_TYPES)[keyof typeof DISTRIBUTION_EVENT_TYPES];

/** Event types whose payloads mirror hasna.rollout_record.v1. */
export const ROLLOUT_EVENT_TYPES: readonly DistributionEventType[] = [
  DISTRIBUTION_EVENT_TYPES.rolloutStarted,
  DISTRIBUTION_EVENT_TYPES.rolloutCompleted,
  DISTRIBUTION_EVENT_TYPES.rolloutFailed,
  DISTRIBUTION_EVENT_TYPES.appInstalled,
];

/** Structural mirror of the @hasna/events RolloutData payload (open keys allowed). */
export interface RolloutEventData {
  appId: string;
  package: string;
  version: string;
  machine: string;
  action?: "install" | "update" | "rollback" | "freeze-blocked";
  result?: string;
  error?: string;
  [key: string]: unknown;
}

/** Structural mirror of the @hasna/events envelope (open extra keys allowed). */
export interface DistributionEventEnvelope {
  id?: string;
  source?: string;
  type: string;
  time?: string;
  subject?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}
