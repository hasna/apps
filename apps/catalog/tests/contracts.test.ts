import { describe, expect, it } from "bun:test";
import {
  AppIdSchema,
  AppSchema,
  AppSurfacesSchema,
  GithubUrlSchema,
  GitShaSchema,
  NpmPackageNameSchema,
  RolloutRecordSchema,
  SemverSchema,
  Sha256DigestSchema,
  TimestampSchema,
  UriSchema,
} from "../src/contracts.js";

const validApp = {
  schema: "hasna.app.v1",
  id: "app_open_todos",
  createdAt: "2026-07-06T08:00:00.000Z",
  appId: "open-alpha",
  npmName: "@example/alpha",
  repoFolder: "open-alpha",
  githubUrl: "https://github.com/example/todos",
  projectSlug: "open-alpha",
  surfaces: {
    bins: ["todos", "todos-cli", "todos-mcp"],
    mcp: { transport: "http", bin: "todos-mcp" },
    http: { healthPath: "/health", port: 4310 },
  },
  lifecycle: "active",
  releaseChannel: "stable",
  summary: "Task and plan tracking for Hasna agents",
  tags: ["distribution", "oss"],
};

describe("vendored hasna.app.v1 mirror", () => {
  it("accepts the foundation valid example", () => {
    const parsed = AppSchema.parse(validApp);
    expect(parsed.appId).toBe("open-alpha");
    expect(parsed.surfaces.mcp?.transport).toBe("http");
  });

  it("applies defaults for surfaces, releaseChannel, and tags", () => {
    const parsed = AppSchema.parse({
      schema: "hasna.app.v1",
      id: "app_open_uptime",
      createdAt: "2026-07-06T08:00:00.000Z",
      appId: "open-beta",
      npmName: "@example/beta",
      repoFolder: "open-beta",
      githubUrl: "https://github.com/example/uptime",
      projectSlug: "open-beta",
      lifecycle: "active",
    });
    expect(parsed.surfaces).toEqual({ bins: [] });
    expect(parsed.releaseChannel).toBe("stable");
    expect(parsed.tags).toEqual([]);
  });

  it("rejects uppercase app ids", () => {
    expect(AppSchema.safeParse({ ...validApp, appId: "Open-Todos" }).success).toBe(false);
  });

  it("rejects non-github urls", () => {
    expect(AppSchema.safeParse({ ...validApp, githubUrl: "https://gitlab.com/hasna/todos" }).success).toBe(false);
  });

  it("rejects duplicate surface bins", () => {
    const result = AppSchema.safeParse({
      ...validApp,
      surfaces: { bins: ["todos", "todos"] },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown keys (strict contract)", () => {
    expect(AppSchema.safeParse({ ...validApp, installState: "installed" }).success).toBe(false);
  });
});

// --- shared distribution primitives ----------------------------------------

const validRolloutRecord = {
  schema: "hasna.rollout_record.v1",
  id: "rollout_0001",
  createdAt: "2026-07-06T08:00:00.000Z",
  appId: "open-alpha",
  package: "@example/alpha",
  version: "1.2.3",
  machine: "spark01",
  action: "install",
  result: "pending",
  at: "2026-07-06T08:05:00.000Z",
};

describe("primitive validation schemas", () => {
  it("rejects semver shapes that are not full three-part versions", () => {
    // The regex requires exactly <digits>.<digits>.<digits> before any
    // prerelease/build suffix. Each of these would be accepted by a naive
    // /^\d+\.\d+\.\d+/ prefix check.
    expect(SemverSchema.safeParse("1.2").success).toBe(false);
    expect(SemverSchema.safeParse("v1.2.3").success).toBe(false);
    expect(SemverSchema.safeParse("1.2.3.4").success).toBe(false);
    expect(SemverSchema.safeParse("1.2.3-").success).toBe(false);
    expect(SemverSchema.safeParse("1.2.3+").success).toBe(false);
  });

  it("accepts valid semver with prerelease and build metadata", () => {
    expect(SemverSchema.safeParse("1.2.3").success).toBe(true);
    expect(SemverSchema.safeParse("1.2.3-beta.1").success).toBe(true);
    expect(SemverSchema.safeParse("1.2.3+build.5").success).toBe(true);
    expect(SemverSchema.safeParse("10.20.30-alpha+build.7").success).toBe(true);
  });

  it("enforces the git sha length and lowercase bounds", () => {
    // 7..40 lowercase hex only: 6 is too short, 41 is too long, uppercase is out.
    expect(GitShaSchema.safeParse("abcdef").success).toBe(false);
    expect(GitShaSchema.safeParse("a".repeat(41)).success).toBe(false);
    expect(GitShaSchema.safeParse("ABCDEF1").success).toBe(false);
    expect(GitShaSchema.safeParse("abcdef1").success).toBe(true);
    expect(GitShaSchema.safeParse("a".repeat(40)).success).toBe(true);
  });

  it("rejects app id shapes a naive dashed-slug regex would let through", () => {
    // /^[a-z0-9-]+$/ would accept all four of these; the real contract
    // requires segments separated by single dashes, no leading/trailing dash,
    // and no underscores.
    expect(AppIdSchema.safeParse("open--alpha").success).toBe(false);
    expect(AppIdSchema.safeParse("-alpha").success).toBe(false);
    expect(AppIdSchema.safeParse("alpha-").success).toBe(false);
    expect(AppIdSchema.safeParse("alpha_beta").success).toBe(false);
    expect(AppIdSchema.safeParse("open-alpha").success).toBe(true);
  });

  it("rejects npm package names that npm itself would never accept", () => {
    expect(NpmPackageNameSchema.safeParse("@Example/alpha").success).toBe(false);
    expect(NpmPackageNameSchema.safeParse(".alpha").success).toBe(false);
    expect(NpmPackageNameSchema.safeParse("@hasna/todos").success).toBe(true);
    expect(NpmPackageNameSchema.safeParse("todos").success).toBe(true);
  });

  it("requires full ISO datetimes, not bare dates or prose", () => {
    expect(TimestampSchema.safeParse("2026-07-06").success).toBe(false);
    expect(TimestampSchema.safeParse("not-a-date").success).toBe(false);
    expect(TimestampSchema.safeParse("2026-07-06T08:00:00.000Z").success).toBe(true);
  });

  it("requires exactly 64 hex chars for sha256 digests", () => {
    expect(Sha256DigestSchema.safeParse("a".repeat(63)).success).toBe(false);
    expect(Sha256DigestSchema.safeParse("a".repeat(65)).success).toBe(false);
    expect(Sha256DigestSchema.safeParse("a".repeat(64)).success).toBe(true);
    // The regex admits uppercase hex — pin that, so a tightening is deliberate.
    expect(Sha256DigestSchema.safeParse("A".repeat(64)).success).toBe(true);
  });

  it("restricts URIs to the recognized scheme allowlist", () => {
    expect(UriSchema.safeParse("ftp://host/path").success).toBe(false);
    expect(UriSchema.safeParse("host/path").success).toBe(false);
    expect(UriSchema.safeParse("artifact://x/y").success).toBe(true);
    expect(UriSchema.safeParse("https://hasna.com/x").success).toBe(true);
    expect(UriSchema.safeParse("git+https://github.com/hasna/x.git").success).toBe(true);
  });

  it("restricts github urls to github.com (https or git+https)", () => {
    expect(GithubUrlSchema.safeParse("git@github.com:hasna/todos.git").success).toBe(false);
    expect(GithubUrlSchema.safeParse("https://gitlab.com/hasna/todos").success).toBe(false);
    expect(GithubUrlSchema.safeParse("git+https://github.com/hasna/todos.git").success).toBe(true);
    expect(GithubUrlSchema.safeParse("https://github.com/hasna/todos").success).toBe(true);
  });

  it("rejects empty summary and empty tags while accepting their absence", () => {
    expect(AppSchema.safeParse({ ...validApp, summary: "" }).success).toBe(false);
    expect(AppSchema.safeParse({ ...validApp, tags: ["oss", ""] }).success).toBe(false);
    expect(AppSchema.safeParse({ ...validApp, summary: undefined }).success).toBe(true);
  });

  it("accepts whitespace-only summary, tags, and bins (length checks, not trim checks)", () => {
    // z.string().min(1) measures length; "   " passes. If these should be
    // rejected, the schemas need .trim() — pin the current looseness so the
    // tightening is a deliberate contract change.
    expect(AppSchema.safeParse({ ...validApp, summary: "   " }).success).toBe(true);
    expect(AppSchema.safeParse({ ...validApp, tags: ["   "] }).success).toBe(true);
    expect(AppSchema.safeParse({ ...validApp, surfaces: { bins: ["   "] } }).success).toBe(true);
  });

  it("accepts leading-zero semver like 01.2.3 (regex is shape, not semver semantics)", () => {
    expect(SemverSchema.safeParse("01.2.3").success).toBe(true);
    expect(SemverSchema.safeParse("1.2.3-01").success).toBe(true);
  });

  it("accepts scheme-prefixed-but-not-a-URL values (prefix checks, not URL parsing)", () => {
    // UriSchema and GithubUrlSchema are startsWith checks: "https://" alone
    // passes. A test that asserts real-URL rejection would fail against the
    // current contract — pin the prefix-only behavior.
    expect(UriSchema.safeParse("https://").success).toBe(true);
    expect(GithubUrlSchema.safeParse("https://github.com/").success).toBe(true);
  });

  it("accepts an empty verifiedBy object (presence check, not content check)", () => {
    // The superRefine requires verifiedBy to EXIST on succeeded installs; it
    // does not require it to have content. Pin that so a content requirement
    // is a deliberate tightening.
    const record = {
      schema: "hasna.rollout_record.v1",
      id: "r1",
      createdAt: "2026-07-06T08:00:00.000Z",
      appId: "open-x",
      package: "@example/x",
      version: "1.2.3",
      machine: "m",
      action: "install",
      result: "succeeded",
      verifiedBy: {},
      at: "2026-01-01T00:00:00.000Z",
    };
    expect(RolloutRecordSchema.safeParse(record).success).toBe(true);
  });

  it("applies surface defaults for mcp transport and http health path", () => {
    const surfaces = AppSurfacesSchema.parse({});
    expect(surfaces).toEqual({ bins: [] });
    const withMcp = AppSurfacesSchema.parse({ mcp: {} });
    expect(withMcp.mcp?.transport).toBe("http");
    const withHttp = AppSurfacesSchema.parse({ http: {} });
    expect(withHttp.http?.healthPath).toBe("/health");
  });
});

describe("hasna.rollout_record.v1 mirror", () => {
  it("accepts the foundation valid example", () => {
    const parsed = RolloutRecordSchema.parse(validRolloutRecord);
    expect(parsed.action).toBe("install");
    expect(parsed.evidenceRefs).toEqual([]);
  });

  it("rejects a freeze-blocked record whose result is not blocked/skipped", () => {
    // A freeze-blocked action that reports success would be the failure mode
    // where a rollout that never happened is recorded as done.
    expect(
      RolloutRecordSchema.safeParse({ ...validRolloutRecord, action: "freeze-blocked", result: "succeeded" }).success
    ).toBe(false);
    expect(
      RolloutRecordSchema.safeParse({ ...validRolloutRecord, action: "freeze-blocked", result: "blocked" }).success
    ).toBe(true);
    expect(
      RolloutRecordSchema.safeParse({ ...validRolloutRecord, action: "freeze-blocked", result: "skipped" }).success
    ).toBe(true);
  });

  it("requires verifiedBy on succeeded install/update records", () => {
    // A record that claims success with no verification is exactly the kind of
    // doc that later audits trust. The superRefine is the only guard.
    expect(
      RolloutRecordSchema.safeParse({ ...validRolloutRecord, action: "install", result: "succeeded" }).success
    ).toBe(false);
    expect(
      RolloutRecordSchema.safeParse({
        ...validRolloutRecord,
        action: "update",
        result: "succeeded",
        verifiedBy: { cliVersion: "0.1.0" },
      }).success
    ).toBe(true);
  });

  it("does not require verifiedBy on non-succeeded or non-install/update results", () => {
    expect(
      RolloutRecordSchema.safeParse({ ...validRolloutRecord, action: "rollback", result: "succeeded" }).success
    ).toBe(true);
    expect(
      RolloutRecordSchema.safeParse({ ...validRolloutRecord, action: "install", result: "failed" }).success
    ).toBe(true);
  });

  it("rejects unknown keys and validates the package/version fields", () => {
    expect(RolloutRecordSchema.safeParse({ ...validRolloutRecord, extra: 1 }).success).toBe(false);
    expect(RolloutRecordSchema.safeParse({ ...validRolloutRecord, version: "1.2" }).success).toBe(false);
  });
});
