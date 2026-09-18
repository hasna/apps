/**
 * Documented bucket configuration for the attachments object store.
 *
 * S3 buckets cannot be reconfigured from this OSS package (no account, no
 * IAM), so the desired end state is carried here as declarative constants and
 * applied by the operator/coordinator as infrastructure change (recorded in
 * the alignment PR for hasna/apps#1650). Nothing in this module is executed
 * against AWS; it exists so the intended configuration is testable, greppable
 * and reviewable in-repo.
 *
 * End state per bucket:
 * - versioning ENABLED (protects the content-addressed blobs against
 *   accidental overwrite; also what makes "duplicate upload = idempotent
 *   overwrite, never a second object" observable).
 * - lifecycle:
 *   - expire noncurrent versions after 90 days (transient overwrites are
 *     garbage, not history),
 *   - abort incomplete multipart uploads after 7 days (staging paths and
 *     abandoned uploads must not accrue).
 * - tags: Class/Project/Component on every object (billing + inventory).
 * - task-role grants: ONE inline policy per task role granting exactly one
 *   bucket ARN (least privilege; never a wildcard across buckets).
 */

/** Bucket versioning status the store must run with (S3 `VersioningConfiguration`). */
export const BUCKET_VERSIONING = "Enabled" as const;

export interface BucketLifecycleRule {
  id: string;
  /** Expire noncurrent versions after N days. */
  noncurrentVersionExpirationDays: number;
  /** Abort incomplete multipart uploads after N days from initiation. */
  abortIncompleteMultipartDays: number;
}

/** Lifecycle rules every store bucket must carry (S3 `LifecycleConfiguration`). */
export const BUCKET_LIFECYCLE_RULES: BucketLifecycleRule[] = [
  {
    id: "noncurrent-90d",
    noncurrentVersionExpirationDays: 90,
    abortIncompleteMultipartDays: 7,
  },
];

export interface BucketTagSpec {
  key: string;
  description: string;
}

/** Tag keys applied to every object for billing/inventory grouping. */
export const BUCKET_TAGS: BucketTagSpec[] = [
  { key: "Class", description: "Storage class of the object (e.g. attachments/files)" },
  { key: "Project", description: "Project grouping the object belongs to" },
  { key: "Component", description: "Component or app that produced the object" },
];

/**
 * Grant model for the task role that reads/writes the store: a single inline
 * policy scoped to exactly one bucket ARN, never a shared/attached policy and
 * never a multi-bucket wildcard. The ARN itself is operator infrastructure and
 * deliberately not represented in this package.
 */
export const TASK_ROLE_GRANT_MODEL = "inline-policy-single-bucket-arn" as const;