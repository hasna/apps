import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJsonSha256 } from "./canonical-json.js";
import { saveApiUrl, saveAuthConfig, getAuthFilePath } from "./auth-store.js";
import type { RecurringRequest, RecurringPreview, RecurringConsentView } from "./remote-recurring.js";

/** Protocol/host-custody fixture only. It supplies no real authentication or DB
 * authority evidence; installed HTTP/OTP/PostgreSQL acceptance is separate. */
export async function recurringProtocol<T>(action: (f: ReturnType<typeof setup>) => Promise<T>): Promise<T> {
  const f = setup(), original = globalThis.fetch;
  globalThis.fetch = f.fetch as typeof fetch;
  try { return await action(f); }
  finally { globalThis.fetch = original; f.cleanup(); }
}
export async function recurringFixtureEnvironment<T>(env: Record<string, string | undefined>, action: () => Promise<T>): Promise<T> {
  const before = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  try { return await action(); }
  finally { for (const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env, before); }
}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function recurringFixtureRequest(): RecurringRequest {
  return { contractVersion: 1, skill: "fixture-skill", input: { original: "payload" }, args: [],
    runtime: { timeoutMs: 1000, maxOutputBytes: 4096, maxAttempts: 1, connectorOperations: [] },
    everyMinutes: 60, startsAt: "2026-09-15T01:00:00.000Z", expiresAt: "2026-09-15T03:00:00.000Z",
    dispatchGraceSeconds: 10, period: "utc-day", inFlightPolicy: "finish-authorized-attempt",
    maxCreditsPerRun: 1, maxCreditsPerPeriod: 2, maxCreditsTotal: 2, maxOccurrencesPerPeriod: 2, maxOccurrencesTotal: 2 };
}
function setup() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "recurring-surface-unit-")), origin = "https://recurring.example.test/prefix";
  const rootOwner = lstatSync(root);
  const env: Record<string, string | undefined> = { HOME: root, HASNA_HOME: join(root, "hasna"), HASNA_CONFIG_HOME: join(root, "config"),
    HASNA_PROFILE: "selected", HASNA_STATION: "recurring-owned-unit" };
  saveApiUrl(origin, env); saveAuthConfig({ apiKey: "inert-selected-key" }, env);
  const sibling = { ...env, HASNA_PROFILE: "sibling" }; saveApiUrl("https://sibling.example.test", sibling); saveAuthConfig({ apiKey: "inert-sibling-key" }, sibling);
  const context = { userId: id(1), membershipId: id(2) }, identity = { user: { id: id(1), membershipId: id(2), email: "owner@example.test", displayName: null, role: "owner" }, organization: { id: id(3), name: "Owned", slug: "owned" } };
  let current: RecurringPreview, consent: RecurringConsentView | null = null, revokedAt: string | null = null, loseActivation = false;
  const calls: Array<{ path: string; method: string; body: any; authorization: string | null }> = [];
  let intercept: ((call: (typeof calls)[number]) => Promise<Response | void> | Response | void) | undefined;
  const makePreview = (request: RecurringRequest) => {
    const terms = { ...request, organizationId: id(3), approvedByUserId: id(1), approvedMembershipId: id(2), deploymentId: "fixture",
      policyId: id(4), policyRevision: 1, skillId: id(5), skillVersionId: id(6), runtimeApprovalDigest: "a".repeat(64),
      payloadSha256: canonicalJsonSha256({ skill: request.skill, input: request.input, args: request.args, runtime: request.runtime }) };
    return { contractVersion: 1 as const, draftId: id(7), terms, termsSha256: canonicalJsonSha256(terms),
      quote: { costCredits: 1, quotedAt: "2026-09-15T00:00:00.000Z", admissionReprices: true as const },
      approvalDeadline: "2026-09-15T00:05:00.000Z", firstDueInstants: [request.startsAt, "2026-09-15T02:00:00.000Z"],
      firstPeriod: { startsAt: "2026-09-15T00:00:00.000Z", endsAt: "2026-09-16T00:00:00.000Z" }, additionalBudget: true as const };
  };
  current = makePreview(recurringFixtureRequest());
  const approval = { contractVersion: 1 as const, acceptedTermsSha256: current.termsSha256,
    acceptance: "authorize-recurring-credit-use" as const, idempotencyKey: "original-activation-request-01" };
  const snapshot = () => [env, sibling].map(e => readFileSync(getAuthFilePath(e)).toString("hex"));
  return { root, env, origin, context, identity, calls, approval, draftId: current.draftId, preview: () => structuredClone(current),
    consent: () => structuredClone(consent), snapshot,
    intercept: (handler: typeof intercept) => { intercept = handler; },
    loseActivationResponse: () => { loseActivation = true; },
    cleanup: () => {
      const now = lstatSync(root);
      if (realpathSync(root) !== root || !now.isDirectory() || now.dev !== rootOwner.dev || now.ino !== rootOwner.ino || now.uid !== rootOwner.uid || (now.mode & 0o7777) !== 0o700)
        throw new Error("Unit fixture root identity changed; preserve it");
      rmSync(root, { recursive: true, force: true });
    },
    async fetch(input: string | URL | Request, init?: RequestInit) {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      if (url.origin !== new URL(origin).origin || !url.pathname.startsWith("/prefix/") || init?.redirect !== "error") throw new Error("External protocol-fixture request refused");
      const call = { path: url.pathname, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null,
        authorization: new Headers(init?.headers).get("authorization") };
      calls.push(call); const altered = await intercept?.(call); if (altered) return altered;
      if (call.path.endsWith("/auth/whoami")) return Response.json({ ...identity, authMethod: call.authorization === "Bearer inert-session" ? "jwt" : "api_key" });
      if (call.path.endsWith("/auth/login")) return Response.json({ sent: true });
      if (call.path.endsWith("/auth/verify")) return call.body.email === "owner@example.test" && call.body.code === "123456"
        ? Response.json({ user: identity.user, token: "inert-session" }) : Response.json({ error: "inert-secret-response" }, { status: 401 });
      if (call.path.endsWith("/account/workspaces/switch")) return Response.json({ ...identity, token: "inert-session" });
      if (call.path.endsWith("/capabilities")) return Response.json({ contractVersion: 1, apiVersion: 1,
        recurringConsents: { contractVersion: 1, available: true }, capabilities: ["recurring.preview", "recurring.drafts.read", "recurring.activate", "recurring.read", "recurring.occurrences", "recurring.revoke"] });
      if (call.path.endsWith("/preview")) { current = makePreview(call.body); return Response.json(current); }
      if (call.path.includes("recurring-consent-drafts/")) return Response.json(current);
      if (call.path.endsWith("/activate")) {
        const replayed = consent !== null;
        consent ??= { contractVersion: 1, consentId: id(8), scheduleId: id(9), terms: current.terms, termsSha256: current.termsSha256,
          state: "active", activatedAt: "2026-09-15T00:01:00.000Z", revokedAt: null,
          total: { reservedCredits: 0, settledCredits: 0, admittedOccurrences: 0 }, currentPeriod: null, nextDueAt: current.terms.startsAt };
        if (loseActivation) { loseActivation = false; throw new TypeError("Owned protocol response lost after simulated commit"); }
        return Response.json({ replayed, consent });
      }
      if (call.path.endsWith("/revoke")) {
        revokedAt ??= "2026-09-15T00:02:00.000Z"; if (consent) { consent.state = "revoked"; consent.revokedAt = revokedAt; }
        return Response.json({ contractVersion: 1, consentId: id(8), revokedAt, authorizedRuns: [], authorizedRunCount: 0,
          residualReservedCredits: 0, inFlightPolicy: "finish-authorized-attempt", cancellationIsSeparate: true });
      }
      if (call.path.endsWith("/occurrences")) return Response.json({ contractVersion: 1, items: [], nextCursor: null });
      if (call.path.endsWith("/recurring-consents")) return Response.json({ contractVersion: 1, items: consent ? [consent] : [], nextCursor: null });
      return consent ? Response.json(consent) : Response.json({ code: "RECURRING_NOT_FOUND" }, { status: 404 });
    },
  };
}
