import { describe, expect, test } from "bun:test";
import {
  recurringConsentActivationRequestSchema, recurringConsentPeriodSchema,
  recurringConsentPreviewSchema, recurringConsentTermsHash, recurringConsentTermsSchema,
  type RecurringConsentTerms,
} from "./recurring-consent.js";

const terms: RecurringConsentTerms = {
  contractVersion: 1, deploymentId: "deployment-1", tenantId: "tenant-1",
  approvingUserId: "user-1", scheduleRevisionId: "revision-1",
  skill: { slug: "blog-article", version: "1.0.0", runtimePolicySha256: "a".repeat(64) },
  inputArgsSha256: "b".repeat(64),
  credits: { unit: "credits", maxPerRun: 25, maxPerPeriod: 100, maxTotal: 200 },
  occurrences: { maxPerPeriod: 4, maxTotal: 8 },
  period: { kind: "utc-calendar-day", rollover: "none" },
  cadence: { kind: "fixed-utc-interval", everyMinutes: 60, dispatchGraceSeconds: 60 },
  startsAt: "2028-02-29T23:00:00.000Z", expiresAt: "2028-03-02T00:00:00.000Z",
  revocation: "stop-new-attempts-authorized-attempts-may-settle",
};
const makePreview = () => ({
  contractVersion: 1, draftId: "draft-1", terms: structuredClone(terms),
  termsSha256: recurringConsentTermsHash(terms), createdAt: "2028-02-29T22:00:00.000Z",
  approvalExpiresAt: "2028-02-29T22:05:00.000Z",
  currentQuote: { unit: "credits", credits: 25, quotedAt: "2028-02-29T22:00:00.000Z" },
  due: [
    { at: "2028-02-29T23:00:00.000Z", period: { start: "2028-02-29T00:00:00.000Z", end: "2028-03-01T00:00:00.000Z" } },
    { at: "2028-03-01T00:00:00.000Z", period: { start: "2028-03-01T00:00:00.000Z", end: "2028-03-02T00:00:00.000Z" } },
  ],
  approval: { kind: "fresh-human-session", challengeId: "challenge-1" },
});

describe("draft recurring consent terms", () => {
  test("strict fields and bounded integer credits; free work still has count limits", () => {
    expect(recurringConsentTermsSchema.parse(terms)).toEqual(terms);
    for (const value of [-1, 0.1, NaN, Infinity, -Infinity, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1, "25", null]) {
      for (const field of ["maxPerRun", "maxPerPeriod", "maxTotal"]) {
        const changed = structuredClone(terms) as any; changed.credits[field] = value;
        expect(recurringConsentTermsSchema.safeParse(changed).success).toBe(false);
      }
    }
    const free = { ...terms, credits: { unit: "credits", maxPerRun: 0, maxPerPeriod: 0, maxTotal: 0 } };
    expect(recurringConsentTermsSchema.safeParse(free).success).toBe(true);
    // Second independently computed vector: the zero-credit envelope is 791 bytes.
    expect(recurringConsentTermsHash(free)).toBe("a18d2e3e7008aa8ee3571def441087ee752a05f7a16c404a83c6e371deb47c64");
    expect(recurringConsentTermsSchema.safeParse({ ...free, occurrences: { maxPerPeriod: 0, maxTotal: 1 } }).success).toBe(false);
    expect(recurringConsentTermsSchema.safeParse({ ...terms, credits: { unit: "credits", maxPerRun: 2_147_483_647, maxPerPeriod: 1, maxTotal: 1 } }).success).toBe(true);
    for (const field of Object.keys(terms)) {
      const changed = { ...terms } as any; delete changed[field];
      expect(recurringConsentTermsSchema.safeParse(changed).success).toBe(false);
    }
    for (const extra of [{ apiKey: "not-a-credential" }, { callbackUrl: "https://example.com" }, { enabled: true }, { freshHumanProof: true }]) {
      expect(recurringConsentTermsSchema.safeParse({ ...terms, ...extra }).success).toBe(false);
    }
    expect(recurringConsentTermsSchema.safeParse({ ...terms, credits: { ...terms.credits, currency: "USD" } }).success).toBe(false);
  });

  test("canonical instants reject rollover, offsets, truncated precision and unsupported cadence", () => {
    for (const startsAt of ["2028-02-30T23:00:00.000Z", "2028-02-29T23:00:00Z", "2028-02-29T23:00:00.000+00:00", "not-a-date"]) {
      expect(recurringConsentTermsSchema.safeParse({ ...terms, startsAt }).success).toBe(false);
    }
    expect(recurringConsentTermsSchema.safeParse({ ...terms, expiresAt: terms.startsAt }).success).toBe(false);
    for (const everyMinutes of [0, 1, 59, 61, 1.5, 2_147_483_648]) {
      expect(recurringConsentTermsSchema.safeParse({ ...terms, cadence: { ...terms.cadence, everyMinutes } }).success).toBe(false);
    }
    expect(recurringConsentTermsSchema.safeParse({ ...terms, period: { kind: "local-day", rollover: "none" } }).success).toBe(false);
  });

  test("hash is stable across object ordering and changes with every authority or budget binding", () => {
    // Independently computed with Python's sorted compact JSON + UTF-8 SHA256;
    // the domain prefix and JSON together contain exactly 796 bytes.
    expect(recurringConsentTermsHash(terms)).toBe("8ddf74bff1eff54e76d8f0241c92a96c9e9d7ae781d6a198b7c34f0d70018368");
    const reordered = Object.fromEntries(Object.entries(terms).reverse());
    expect(recurringConsentTermsHash(reordered)).toBe(recurringConsentTermsHash(terms));
    const changes: [string, unknown][] = [
      ["deploymentId", "deployment-2"], ["tenantId", "tenant-2"], ["approvingUserId", "user-2"],
      ["scheduleRevisionId", "revision-2"], ["inputArgsSha256", "c".repeat(64)],
      ["skill", { ...terms.skill, version: "2.0.0" }],
      ["skill", { ...terms.skill, runtimePolicySha256: "c".repeat(64) }],
      ["skill", { ...terms.skill, slug: "another-skill" }],
      ...["maxPerRun", "maxPerPeriod", "maxTotal"].map(field => ["credits", { ...terms.credits, [field]: 1 }] as [string, unknown]),
      ["occurrences", { ...terms.occurrences, maxTotal: 9 }], ["occurrences", { ...terms.occurrences, maxPerPeriod: 5 }],
      ["cadence", { ...terms.cadence, everyMinutes: 120 }], ["cadence", { ...terms.cadence, dispatchGraceSeconds: 0 }],
      ["startsAt", "2028-02-29T22:00:00.000Z"], ["expiresAt", "2028-03-03T00:00:00.000Z"],
    ];
    for (const [field, value] of changes) expect(recurringConsentTermsHash({ ...terms, [field]: value })).not.toBe(recurringConsentTermsHash(terms));
    expect(() => recurringConsentTermsHash({ ...terms, unknown: "must-not-disappear" })).toThrow();
  });
});

test("preview dates retain leap-day and midnight ownership; duplicate, unanchored and wrong-period slots refuse", () => {
  expect(recurringConsentPreviewSchema.safeParse(makePreview()).success).toBe(true);
  const illustrative = makePreview();
  illustrative.createdAt = "2028-03-01T01:00:00.000Z";
  illustrative.approvalExpiresAt = "2028-03-01T01:05:00.000Z";
  // Wire parsing can describe older anchored slots. It neither admits them nor
  // grants a catch-up exception to the future database-clock dispatcher.
  expect(recurringConsentPreviewSchema.safeParse(illustrative).success).toBe(true);
  for (const mutate of [
    (p: any) => { p.termsSha256 = "c".repeat(64); },
    (p: any) => { p.due[1].period = p.due[0].period; },
    (p: any) => { p.due[1].at = p.due[0].at; },
    (p: any) => { p.due.reverse(); },
    (p: any) => { p.due[0].at = "2028-02-29T23:30:00.000Z"; },
    (p: any) => { p.due[1].at = terms.expiresAt; },
    (p: any) => { p.approvalExpiresAt = p.createdAt; },
    (p: any) => { p.currentQuote.quotedAt = p.approvalExpiresAt; },
    (p: any) => { p.terms.expiresAt = p.terms.startsAt; },
    (p: any) => { p.terms.cadence.everyMinutes = 61; },
  ]) {
    const p = makePreview(); mutate(p);
    expect(recurringConsentPreviewSchema.safeParse(p).success).toBe(false);
  }
  expect(recurringConsentPeriodSchema.safeParse({ start: "2028-02-29T00:00:00.000Z", end: "2028-03-01T01:00:00.000Z" }).success).toBe(false);
});

test("activation requires explicit acceptance and opaque references; shape validation is never authentication", () => {
  const request = { contractVersion: 1, draftId: "draft-1", acceptedTermsSha256: recurringConsentTermsHash(terms),
    acceptRecurringSpend: true, approvalChallengeId: "challenge-1", approvalAssertionRef: "assertion-1", idempotencyKey: "activate-1" };
  expect(recurringConsentActivationRequestSchema.safeParse(request).success).toBe(true);
  for (const field of ["approvalChallengeId", "approvalAssertionRef", "acceptedTermsSha256", "idempotencyKey"]) {
    const changed = { ...request } as any; delete changed[field];
    expect(recurringConsentActivationRequestSchema.safeParse(changed).success).toBe(false);
  }
  for (const value of [false, "true", 1, undefined]) {
    expect(recurringConsentActivationRequestSchema.safeParse({ ...request, acceptRecurringSpend: value }).success).toBe(false);
  }
  expect(recurringConsentActivationRequestSchema.safeParse({ ...request, freshHumanProof: true }).success).toBe(false);
  expect(recurringConsentActivationRequestSchema.safeParse({ ...request, contractVersion: 2 }).success).toBe(false);
  // Deliberately unknown references still parse: only a future authoritative
  // server lookup can reject them. The parser exposes no active/granted result.
  const parsed = recurringConsentActivationRequestSchema.parse({ ...request, approvalAssertionRef: "unknown-server-reference" });
  expect(parsed).not.toHaveProperty("authenticated");
  expect(parsed).not.toHaveProperty("active");
});
