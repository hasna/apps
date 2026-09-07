import { describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "./test-preload.js";
import {
  SKILLS_ADMIN_ADDITIVE_RESPONSE_FIELDS,
  SKILLS_ADMIN_API_CONTRACT_VERSION,
  SKILLS_ADMIN_AUTH_HEADER,
  SKILLS_ADMIN_AUTH_HEADER_FORM,
  SKILLS_ADMIN_AUTH_SCHEME,
  SKILLS_ADMIN_ENV_KEY,
  SKILLS_ADMIN_ENV_URL,
  SKILLS_ADMIN_OPERATIONS,
  SkillsAdminGrantEntitlementRequestSchema,
  SkillsAdminSetUserRoleRequestSchema,
  SkillsAdminStatusResponseSchema,
  SkillsAdminListUsersResponseSchema,
  SkillsAdminShowOrganizationResponseSchema,
  SkillsAdminSetUserRoleResponseSchema,
} from "./admin-contract";

useDefaultTestTimeout();

describe("skills admin API contract", () => {
  test("exports only configuration names and the bearer header form", () => {
    expect(SKILLS_ADMIN_API_CONTRACT_VERSION).toBe("1.0.0");
    expect(SKILLS_ADMIN_ENV_URL).toBe("HASNA_SKILLS_API_URL");
    expect(SKILLS_ADMIN_ENV_KEY).toBe("HASNA_SKILLS_ADMIN_API_KEY");
    expect(SKILLS_ADMIN_AUTH_HEADER).toBe("Authorization");
    expect(SKILLS_ADMIN_AUTH_SCHEME).toBe("Bearer");
    expect(SKILLS_ADMIN_AUTH_HEADER_FORM).toBe("Authorization: Bearer <admin-api-key>");
  });

  test("enumerates the complete command contract without impersonation", () => {
    expect(Object.keys(SKILLS_ADMIN_OPERATIONS)).toHaveLength(21);
    expect(SKILLS_ADMIN_OPERATIONS).not.toHaveProperty("impersonate");
    for (const operation of Object.values(SKILLS_ADMIN_OPERATIONS)) {
      expect(operation.path).toStartWith("/api/v1/");
      expect(operation.successStatuses.length).toBeGreaterThan(0);
      expect(operation.errorStatuses).toContain(401);
      expect(operation.additiveResponseFields).toBe(SKILLS_ADMIN_ADDITIVE_RESPONSE_FIELDS);
    }
  });

  test("requires exactly one entitlement selector", () => {
    const base = { organizationId: "org-1", source: "manual" as const };
    expect(SkillsAdminGrantEntitlementRequestSchema.safeParse({ ...base, skillId: "skill-1" }).success).toBeTrue();
    expect(SkillsAdminGrantEntitlementRequestSchema.safeParse({ ...base, slug: "skill-slug" }).success).toBeTrue();
    expect(SkillsAdminGrantEntitlementRequestSchema.safeParse(base).success).toBeFalse();
    expect(SkillsAdminGrantEntitlementRequestSchema.safeParse({ ...base, skillId: "skill-1", slug: "skill-slug" }).success).toBeFalse();
  });

  test("binds each named suspend and resume operation to its literal mutation", () => {
    const cases = [
      ["orgsSuspend", true, false],
      ["orgsResume", false, true],
      ["usersSuspend", true, false],
      ["usersResume", false, true],
    ] as const;

    for (const [operationId, accepted, rejected] of cases) {
      const schema = SKILLS_ADMIN_OPERATIONS[operationId].bodySchema;
      expect(schema.safeParse({ suspended: accepted, reason: "contract test" }).success).toBeTrue();
      expect(schema.safeParse({ suspended: rejected, reason: "contract test" }).success).toBeFalse();
    }
  });

  test("accepts only declared administrative roles and no extra mutation fields", () => {
    for (const role of ["owner", "admin", "member", "viewer"] as const) {
      expect(SkillsAdminSetUserRoleRequestSchema.parse({ role })).toEqual({ role });
    }
    expect(SkillsAdminSetUserRoleRequestSchema.safeParse({ role: "superuser" }).success).toBeFalse();
    expect(SkillsAdminSetUserRoleRequestSchema.safeParse({ role: "admin", suspended: true }).success).toBeFalse();
  });

  test("retains global identities with an explicit absent default membership role", () => {
    const user = { id: "user-1", email: "reader@example.test", organizationId: "org-1", role: null, metadata: {}, createdAt: "2026-09-06T00:00:00Z" };
    const list = (row: unknown) => SkillsAdminListUsersResponseSchema.safeParse({ users: [row], limit: 50, offset: 0 });
    expect(list(user).success).toBeTrue();
    expect(list({ ...user, role: "viewer" }).success).toBeTrue();
    for (const role of [undefined, "superuser", 0]) expect(list({ ...user, role }).success).toBeFalse();
    const { role: _role, ...missingRole } = user;
    expect(list(missingRole).success).toBeFalse();
  });

  test("nullable list roles do not widen active organization members or role mutations", () => {
    const user = { id: "user-1", email: "reader@example.test", role: "viewer", metadata: {}, createdAt: "2026-09-06T00:00:00Z" };
    const organization = { id: "org-1", slug: "example", name: "Example", metadata: {}, createdAt: user.createdAt };
    const show = (row: unknown) => SkillsAdminShowOrganizationResponseSchema.safeParse({ organization, users: [row], balance: null, subscription: null });
    expect(show(user).success).toBeTrue();
    expect(show({ ...user, role: null }).success).toBeFalse();
    expect(SkillsAdminSetUserRoleRequestSchema.safeParse({ role: null }).success).toBeFalse();
    expect(SkillsAdminSetUserRoleResponseSchema.safeParse({ ok: true, user: { ...user, role: null } }).success).toBeFalse();
    expect(SkillsAdminSetUserRoleResponseSchema.safeParse({ ok: true, user }).success).toBeTrue();
  });

  test("response schemas tolerate additive fields but retain required fields", () => {
    const fixture = {
      account: {
        user: { email: "owner@example.com", displayName: null, role: "owner", additive: true },
        organization: { slug: "acme", name: "Acme", additive: true },
        authMethod: "jwt",
      },
      queue: {
        counts: { queued: 0, running: 0, pendingApproval: 0, failed24h: 0 },
        oldestQueuedAt: null,
        lastActiveAt: null,
        lastCompletedAt: null,
      },
      worker: { mode: "separate-service", runnerEnabledInProcess: false, healthSource: "tenant queue state" },
      usage: { recentCount: 0, recentNetAmountCents: 0, recentTransactions: [] },
      connectors: { status: "unconfigured", readinessEndpoint: "/api/v1/connectors/readiness" },
      deployment: {
        status: "ok",
        appEnv: "test",
        nodeEnv: "test",
        version: "0.1.68",
        commitSha: null,
        runnerEnabled: false,
        serviceMode: false,
        generatedAt: "2026-08-24T00:00:00.000Z",
      },
      futureField: { accepted: true },
    };
    expect(SkillsAdminStatusResponseSchema.safeParse(fixture).success).toBeTrue();
    expect(SkillsAdminStatusResponseSchema.safeParse({ ...fixture, queue: undefined }).success).toBeFalse();
  });
});
