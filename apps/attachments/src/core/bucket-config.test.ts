import { describe, expect, it } from "bun:test";
import {
  BUCKET_LIFECYCLE_RULES,
  BUCKET_TAGS,
  BUCKET_VERSIONING,
  TASK_ROLE_GRANT_MODEL,
} from "./bucket-config";

describe("bucket-config — documented S3 end state (hasna/apps#1650)", () => {
  it("enables versioning", () => {
    expect(BUCKET_VERSIONING).toBe("Enabled");
  });

  it("carries the lifecycle rules: noncurrent 90d + incomplete multipart 7d", () => {
    expect(BUCKET_LIFECYCLE_RULES.length).toBeGreaterThan(0);
    for (const rule of BUCKET_LIFECYCLE_RULES) {
      expect(rule.id).toMatch(/^[a-z0-9-]+$/);
      expect(rule.noncurrentVersionExpirationDays).toBeGreaterThan(0);
      expect(rule.abortIncompleteMultipartDays).toBeGreaterThan(0);
    }
    expect(BUCKET_LIFECYCLE_RULES.some((r) => r.noncurrentVersionExpirationDays === 90)).toBe(true);
    expect(BUCKET_LIFECYCLE_RULES.some((r) => r.abortIncompleteMultipartDays === 7)).toBe(true);
  });

  it("declares the Class/Project/Component tag keys", () => {
    const keys = BUCKET_TAGS.map((t) => t.key);
    expect(keys).toContain("Class");
    expect(keys).toContain("Project");
    expect(keys).toContain("Component");
    for (const tag of BUCKET_TAGS) {
      expect(tag.description.length).toBeGreaterThan(0);
    }
  });

  it("scopes task-role grants to one inline policy per bucket ARN", () => {
    expect(TASK_ROLE_GRANT_MODEL).toBe("inline-policy-single-bucket-arn");
  });

  it("carries no internal-infra identity (publish guard)", () => {
    const text = JSON.stringify({ BUCKET_VERSIONING, BUCKET_LIFECYCLE_RULES, BUCKET_TAGS, TASK_ROLE_GRANT_MODEL });
    expect(text).not.toMatch(/[.]hasna[.]xyz/);
    expect(text).not.toMatch(/arn:aws:/);
    expect(text).not.toMatch(/bucket[_-]?name/i);
  });
});