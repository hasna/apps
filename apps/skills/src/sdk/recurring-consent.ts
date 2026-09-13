/** Draft recurring-consent wire validation. Parsing never grants spending authority. */
import { createHash } from "node:crypto";
import { z } from "zod/v3";
import { canonicalJson } from "./execution/types.js";

export const RECURRING_CONSENT_DRAFT_VERSION = 1;
// Credits retain the existing reservation/store int32 wire range. Reusing that
// range for counts and durations is a draft representation bound, not a service
// allowance; actual grant, cadence, grace and lifetime policy must be stricter
// where required and supplied by the independently reviewed service policy.
const boundedInteger = z.number().int().min(0).max(2_147_483_647);
const count = boundedInteger.refine(value => value > 0, "A positive count is required");
const reference = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value,
    "A canonical UTC instant is required");
const fail = (context: z.RefinementCtx, path: (string | number)[], message: string) =>
  context.addIssue({ code: z.ZodIssueCode.custom, path, message });

/** All limits are explicit. Independent caps are not silently raised or reset. */
export const recurringConsentTermsSchema = z.object({
  contractVersion: z.literal(RECURRING_CONSENT_DRAFT_VERSION),
  deploymentId: reference,
  tenantId: reference,
  approvingUserId: reference,
  scheduleRevisionId: reference,
  skill: z.object({
    slug: z.string().max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    version: reference,
    runtimePolicySha256: hash,
  }).strict(),
  inputArgsSha256: hash,
  credits: z.object({
    unit: z.literal("credits"),
    maxPerRun: boundedInteger,
    maxPerPeriod: boundedInteger,
    maxTotal: boundedInteger,
  }).strict(),
  occurrences: z.object({ maxPerPeriod: count, maxTotal: count }).strict(),
  period: z.object({ kind: z.literal("utc-calendar-day"), rollover: z.literal("none") }).strict(),
  cadence: z.object({
    kind: z.literal("fixed-utc-interval"),
    everyMinutes: count.refine(value => value % 60 === 0, "Cadence must use whole hours"),
    dispatchGraceSeconds: boundedInteger,
  }).strict(),
  startsAt: instant,
  expiresAt: instant,
  // Explicit proposed semantics, not an application default or an enablement flag.
  revocation: z.literal("stop-new-attempts-authorized-attempts-may-settle"),
}).strict().superRefine((terms, context) => {
  if (Date.parse(terms.expiresAt) <= Date.parse(terms.startsAt)) {
    fail(context, ["expiresAt"], "Expiry must be after the schedule anchor");
  }
});
export type RecurringConsentTerms = z.infer<typeof recurringConsentTermsSchema>;

/** Domain-separated hash of validated terms; no coercion, defaults or Unicode rewriting. */
export function recurringConsentTermsHash(input: unknown): string {
  const terms = recurringConsentTermsSchema.parse(input);
  return createHash("sha256").update("skills:recurring-consent:terms:v1\n")
    .update(canonicalJson(terms), "utf8").digest("hex");
}

/** A UTC day is half-open; an old reservation keeps its original due-day identity. */
export const recurringConsentPeriodSchema = z.object({ start: instant, end: instant }).strict()
  .superRefine((period, context) => {
    if (!period.start.endsWith("T00:00:00.000Z") || !period.end.endsWith("T00:00:00.000Z") ||
        Date.parse(period.end) - Date.parse(period.start) !== 86_400_000) {
      fail(context, [], "A period must be one complete UTC calendar day [start, end)");
    }
  });
export type RecurringConsentPeriod = z.infer<typeof recurringConsentPeriodSchema>;

/** Draft response only: the server must bind and retain input, identities and approval. */
export const recurringConsentPreviewSchema = z.object({
  contractVersion: z.literal(RECURRING_CONSENT_DRAFT_VERSION),
  draftId: reference,
  terms: recurringConsentTermsSchema,
  termsSha256: hash,
  createdAt: instant,
  approvalExpiresAt: instant,
  currentQuote: z.object({ unit: z.literal("credits"), credits: boundedInteger, quotedAt: instant }).strict(),
  // Illustrative anchored slots, not an admission clock or a promise of future
  // dispatch: slots may precede preview creation/approval. The eventual server
  // must select upcoming slots and apply its database-clock/grace rules.
  // Transport bound only; this is not an occurrence or service-policy default.
  due: z.array(z.object({ at: instant, period: recurringConsentPeriodSchema }).strict()).min(1).max(100),
  approval: z.object({
    kind: z.literal("fresh-human-session"),
    challengeId: reference,
  }).strict(),
}).strict().superRefine((preview, context) => {
  // Nested refinements can leave a dirty value: safeParse must still report
  // issues rather than throw while this parent refinement is running.
  const checkedTerms = recurringConsentTermsSchema.safeParse(preview.terms);
  if (checkedTerms.success && preview.termsSha256 !== recurringConsentTermsHash(checkedTerms.data)) {
    fail(context, ["termsSha256"], "Preview terms do not match their hash");
  }
  const created = Date.parse(preview.createdAt), deadline = Date.parse(preview.approvalExpiresAt);
  if (deadline <= created || deadline > Date.parse(preview.terms.expiresAt)) {
    fail(context, ["approvalExpiresAt"], "Approval deadline must follow creation and not outlive terms");
  }
  if (Date.parse(preview.currentQuote.quotedAt) > created) {
    fail(context, ["currentQuote", "quotedAt"], "A quote cannot be newer than its preview");
  }
  let previous = -Infinity;
  const anchor = Date.parse(preview.terms.startsAt), expiry = Date.parse(preview.terms.expiresAt);
  const interval = preview.terms.cadence.everyMinutes * 60_000;
  for (const [index, due] of preview.due.entries()) {
    const at = Date.parse(due.at);
    if (at < anchor || at >= expiry || (at - anchor) % interval !== 0 || at <= previous) {
      fail(context, ["due", index, "at"], "Due instants must be ordered unique anchored slots inside the lifetime");
    }
    if (at < Date.parse(due.period.start) || at >= Date.parse(due.period.end)) {
      fail(context, ["due", index, "period"], "Due instant must belong to its half-open period");
    }
    previous = at;
  }
});
export type RecurringConsentPreview = z.infer<typeof recurringConsentPreviewSchema>;

/**
 * Untrusted request shape, not proof of approval. The server must verify both
 * opaque references against its fresh non-impersonated owner/admin session,
 * draft, tenant, user, terms, expiry and one-time activation transaction.
 * A key or a caller-supplied boolean cannot substitute for that verification.
 */
export const recurringConsentActivationRequestSchema = z.object({
  contractVersion: z.literal(RECURRING_CONSENT_DRAFT_VERSION),
  draftId: reference,
  acceptedTermsSha256: hash,
  acceptRecurringSpend: z.literal(true),
  approvalChallengeId: reference,
  approvalAssertionRef: reference,
  idempotencyKey: reference,
}).strict();
export type RecurringConsentActivationRequest = z.infer<typeof recurringConsentActivationRequestSchema>;
