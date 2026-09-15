import { afterEach, describe, expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAuthFilePath, saveApiUrl, saveAuthConfig } from "./auth-store.js";
import { RemoteSkillsClient, createRemoteSkillsClient } from "./remote-client.js";
import { canonicalJson, canonicalJsonSha256 } from "./canonical-json.js";
import { recurringInput, parseRecurringResult, RecurringInputError, RemoteRecurringUnavailableError,
  RemoteRecurringReadError, RemoteRecurringUnconfirmedError, RemoteRecurringError,
  type RecurringRequest, type RecurringTerms, type RecurringPreview, type RecurringConsentView } from "./remote-recurring.js";
useDefaultTestTimeout();

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const identity = { authMethod: "jwt", user: { id: id(1), membershipId: id(2), email: "fixture@example.test", role: "owner" as const, displayName: null },
  organization: { id: id(3), slug: "fixture", name: "Fixture" } };
const context = { userId: id(1), membershipId: id(2) };
const request = (): RecurringRequest => ({ contractVersion: 1, skill: "fixture-skill", input: { nested: { value: "original" } }, args: ["original"],
  runtime: { timeoutMs: 1000, maxOutputBytes: 4096, maxAttempts: 1, connectorOperations: [] }, everyMinutes: 60,
  startsAt: "2026-09-15T01:00:00.000Z", expiresAt: "2026-09-15T05:00:00.000Z", dispatchGraceSeconds: 10,
  period: "utc-day", inFlightPolicy: "finish-authorized-attempt", maxCreditsPerRun: 1, maxCreditsPerPeriod: 3, maxCreditsTotal: 3,
  maxOccurrencesPerPeriod: 3, maxOccurrencesTotal: 3 });
function terms(raw = request()): RecurringTerms {
  return { ...structuredClone(raw), deploymentId: "fixture", organizationId: id(3), approvedByUserId: id(1), approvedMembershipId: id(2),
    policyId: id(4), policyRevision: 1, skillId: id(5), skillVersionId: id(6), runtimeApprovalDigest: "a".repeat(64),
    payloadSha256: canonicalJsonSha256({ skill: raw.skill, input: raw.input, args: raw.args, runtime: raw.runtime }) };
}
function preview(raw = request()): RecurringPreview {
  const t = terms(raw);
  return { contractVersion: 1, draftId: id(7), terms: t, termsSha256: canonicalJsonSha256(t), quote: { costCredits: 1, quotedAt: "2026-09-14T01:00:00.000Z", admissionReprices: true },
    approvalDeadline: "2026-09-14T01:05:00.000Z", firstDueInstants: [1,2,3,4].map(h => `2026-09-15T0${h}:00:00.000Z`),
    firstPeriod: { startsAt: "2026-09-15T00:00:00.000Z", endsAt: "2026-09-16T00:00:00.000Z" }, additionalBudget: true };
}
function consent(): RecurringConsentView {
  const p = preview(); return { contractVersion: 1, consentId: id(8), scheduleId: id(9), terms: p.terms, termsSha256: p.termsSha256,
    state: "active", activatedAt: "2026-09-14T01:01:00.000Z", revokedAt: null, total: { reservedCredits: 0, settledCredits: 0, admittedOccurrences: 0 },
    currentPeriod: null, nextDueAt: p.terms.startsAt };
}
const approval = () => ({ contractVersion: 1 as const, acceptedTermsSha256: preview().termsSha256,
  acceptance: "authorize-recurring-credit-use" as const, idempotencyKey: "original-approval-key-01" });
const capabilities = () => ({ contractVersion: 1, apiVersion: 1, capabilities: ["recurring.preview", "recurring.drafts.read", "recurring.activate", "recurring.read", "recurring.occurrences", "recurring.revoke"],
  recurringConsents: { contractVersion: 1, available: true } });
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
type Call = { url: URL; method: string; body: unknown; authorization: string | null };
function fixture(handler?: (call: Call) => Response | Promise<Response | undefined> | undefined) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: new URL(typeof input === "string" || input instanceof URL ? input : input.url), method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined, authorization: new Headers(init?.headers).get("authorization") };
    expect(init?.redirect).toBe("error"); expect(init?.credentials).toBe("omit"); expect(init?.signal).toBeDefined(); calls.push(call);
    const override = await handler?.(call); if (override) return override;
    const path = call.url.pathname;
    if (path.endsWith("/capabilities")) return Response.json(capabilities());
    if (path.endsWith("/auth/whoami")) return Response.json(identity);
    if (path.endsWith("/preview")) return Response.json(preview(call.body as RecurringRequest));
    if (path.includes("recurring-consent-drafts/")) return Response.json(preview());
    if (path.endsWith("/activate")) return Response.json({ replayed: false, consent: consent() });
    if (path.endsWith("/occurrences")) return Response.json({ contractVersion: 1, items: [], nextCursor: null });
    if (path.endsWith("/revoke")) return Response.json({ contractVersion: 1, consentId: id(8), revokedAt: "2026-09-14T01:02:00.000Z", authorizedRuns: [], authorizedRunCount: 0,
      residualReservedCredits: 0, inFlightPolicy: "finish-authorized-attempt", cancellationIsSeparate: true });
    if (path.endsWith("/recurring-consents")) return Response.json({ contractVersion: 1, items: [consent()], nextCursor: null });
    return Response.json(consent());
  }) as typeof fetch;
  return calls;
}
describe("portable recurring SDK", () => {
  test("actual profile resolver preserves selected and sibling credential files across recurring reads", async () => {
    const root = mkdtempSync(join(tmpdir(), "recurring-profile-"));
    const base = { HASNA_CONFIG_HOME: join(root, "config"), HASNA_HOME: join(root, "data"), HASNA_STATION: "recurring-no-keychain-entry" };
    const selected = { ...base, HASNA_PROFILE: "selected" }, sibling = { ...base, HASNA_PROFILE: "sibling" };
    try {
      saveApiUrl("https://selected.example.test/prefix/api/v1", selected); saveAuthConfig({ apiKey: "fixture-selected" }, selected);
      saveApiUrl("https://sibling.example.test/api/v1", sibling); saveAuthConfig({ apiKey: "fixture-sibling" }, sibling);
      const before = [selected, sibling].map(env => readFileSync(getAuthFilePath(env)));
      const pending = createRemoteSkillsClient(selected); selected.HASNA_PROFILE = "sibling";
      const client = await pending; expect(client).not.toBeNull(); const calls = fixture();
      expect(await client!.getRecurringDraft(id(7), context)).toEqual(preview());
      expect(calls.every(call => call.url.origin === "https://selected.example.test" && call.url.pathname.startsWith("/prefix/") && call.authorization === "Bearer fixture-selected")).toBe(true);
      expect(readFileSync(getAuthFilePath({ ...selected, HASNA_PROFILE: "selected" }))).toEqual(before[0]!);
      expect(readFileSync(getAuthFilePath(sibling))).toEqual(before[1]!);
      const priorCalls = calls.length;
      await expect(createRemoteSkillsClient({ ...sibling, HASNA_SKILLS_API_URL: "https://foreign.example.test" })).rejects.toThrow("does not match");
      expect(calls).toHaveLength(priorCalls);
    } finally { rmSync(root, { recursive: true }); }
  });
  test("all seven operations retain explicit origin, bearer, approval and immutable expired draft", async () => {
    const calls = fixture(), client = new RemoteSkillsClient("inert-fixture-bearer", "https://fixture.example.test/custom/api/v1");
    expect(await client.previewRecurringConsent(request(), context)).toEqual(preview());
    expect(await client.getRecurringDraft(id(7), context)).toEqual(preview());
    expect(await client.activateRecurringConsent(id(7), approval(), context)).toEqual({ replayed: false, consent: consent() });
    expect((await client.listRecurringConsents({ limit: 1 }, context)).items).toHaveLength(1);
    expect(await client.getRecurringConsent(id(8), context)).toEqual(consent());
    expect((await client.listRecurringOccurrences(id(8), {}, context)).items).toEqual([]);
    expect((await client.revokeRecurringConsent(id(8), context)).cancellationIsSeparate).toBe(true);
    expect(calls.every(call => call.url.origin === "https://fixture.example.test" && call.url.pathname.startsWith("/custom/") && call.authorization === "Bearer inert-fixture-bearer")).toBe(true);
    expect(calls.filter(call => call.method === "POST").map(call => call.body)).toEqual([request(), approval(), { contractVersion: 1 }]);
  });
  test("gateway prefix and async caller/client mutation cannot retarget captured preview", async () => {
    let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
    const calls = fixture(async call => { if (call.url.pathname.endsWith("/capabilities")) { await hold; return Response.json(capabilities()); } });
    const input = request(), selected = { ...context }, client = new RemoteSkillsClient("original-bearer", "https://api.example.test/skills/v1");
    const result = client.previewRecurringConsent(input, selected);
    (input.input.nested as { value: string }).value = "changed"; input.args.push("changed"); selected.membershipId = id(99);
    (client as unknown as { apiUrl: string }).apiUrl = "https://other.example.test/api/v1";
    (client as unknown as { apiKey: string }).apiKey = "changed-bearer"; release();
    expect(await result).toEqual(preview());
    expect(calls.every(call => call.url.origin === "https://api.example.test" && call.url.pathname.startsWith("/skills/") && call.authorization === "Bearer original-bearer")).toBe(true);
    expect(calls.find(call => call.method === "POST")!.body).toEqual(request());
  });
  test("missing, disabled, incompatible or forged capability prevents every mutation", async () => {
    for (const value of [{}, { ...capabilities(), recurringConsents: { contractVersion: 1, available: false } },
      { ...capabilities(), recurringConsents: { contractVersion: 2, available: true } }, { ...capabilities(), capabilities: [] },
      { ...capabilities(), recurringConsents: { contractVersion: 1, available: "true" } }]) {
      const calls = fixture(call => call.url.pathname.endsWith("/capabilities") ? Response.json(value) : undefined);
      await expect(new RemoteSkillsClient("fixture", "https://fixture.example.test").previewRecurringConsent(request())).rejects.toBeInstanceOf(RemoteRecurringUnavailableError);
      expect(calls).toHaveLength(1);
    }
  });
  test("invalid input, identity mismatch and nonhuman metadata refuse before activation POST", async () => {
    let calls = fixture(); const client = new RemoteSkillsClient("fixture", "https://fixture.example.test");
    for (const change of [{ human: true }, { everyMinutes: 1 }, { maxCreditsTotal: -1 }, { input: { value: undefined } }, { idempotencyKey: "injected" }]) {
      await expect(client.previewRecurringConsent({ ...request(), ...change } as RecurringRequest)).rejects.toBeInstanceOf(RecurringInputError);
    }
    expect(calls).toHaveLength(0);
    await expect(client.activateRecurringConsent(id(7), approval(), { ...context, membershipId: id(99) })).rejects.toBeInstanceOf(RemoteRecurringReadError);
    expect(calls.filter(c => c.method === "POST")).toHaveLength(0);
    calls = fixture(call => call.url.pathname.endsWith("/auth/whoami") ? Response.json({ ...identity, authMethod: "api_key" }) : undefined);
    await expect(client.activateRecurringConsent(id(7), approval())).rejects.toBeInstanceOf(RemoteRecurringError);
    expect(calls.filter(c => c.method === "POST")).toHaveLength(0);
  });
  test("only exact domain404 maps to null; arbitrary or malformed replies remain failures", async () => {
    for (const body of [{ code: "NOT_FOUND" }, { code: "RECURRING_NOT_FOUND", outcomeUnknown: true }, { error: "secret-response" }]) {
      fixture(call => call.url.pathname.includes("recurring-consent-drafts/") ? Response.json(body, { status: 404 }) : undefined);
      await expect(new RemoteSkillsClient("fixture", "https://fixture.example.test").getRecurringDraft(id(7))).rejects.toBeInstanceOf(RemoteRecurringReadError);
    }
    fixture(call => call.url.pathname.includes("recurring-consent-drafts/") ? Response.json({ code: "RECURRING_NOT_FOUND" }, { status: 404 }) : undefined);
    expect(await new RemoteSkillsClient("fixture", "https://fixture.example.test").getRecurringDraft(id(7))).toBeNull();
    fixture(call => call.url.pathname.includes("recurring-consent-drafts/") ? Response.json(null) : undefined);
    await expect(new RemoteSkillsClient("fixture", "https://fixture.example.test").getRecurringDraft(id(7))).rejects.toBeInstanceOf(RemoteRecurringReadError);
  });
  test("one dispatched mutation stays unknown after loss, malformed body, wrong identity or mismatched status", async () => {
    for (const mode of ["loss", "body", "identity", "status", "server"] as const) {
      const calls = fixture(call => {
        if (!call.url.pathname.endsWith("/activate")) return;
        if (mode === "loss") throw new Error("secret-request-url");
        if (mode === "body") return new Response("secret-response", { status: 200 });
        if (mode === "server") return Response.json({ error: "secret-SQL", code: "UNCLASSIFIED" }, { status: 503 });
        const value = { replayed: false, consent: consent() };
        if (mode === "identity") value.consent.terms.organizationId = id(99);
        return Response.json(value, { status: mode === "status" ? 201 : 200 });
      });
      let error: unknown; try { await new RemoteSkillsClient("fixture", "https://fixture.example.test").activateRecurringConsent(id(7), approval()); } catch (e) { error = e; }
      expect(error).toBeInstanceOf(RemoteRecurringUnconfirmedError); expect(String(error)).not.toContain("secret-");
      expect(calls.filter(c => c.method === "POST")).toHaveLength(1);
      expect(calls.find(c => c.method === "POST")!.body).toEqual(approval());
    }
  });
  test("terms hash, original member and anchor corruption are refused; consent control stays tenant-wide", async () => {
    for (const mutate of [
      (p: RecurringPreview) => { p.terms.input = { altered: true }; },
      (p: RecurringPreview) => { p.terms.approvedMembershipId = id(99); p.termsSha256 = canonicalJsonSha256(p.terms); },
      (p: RecurringPreview) => { p.firstDueInstants[0] = p.firstDueInstants[1]!; },
      (p: RecurringPreview) => { p.firstPeriod.endsAt = p.firstPeriod.startsAt; },
    ]) {
      const p = preview(); mutate(p); fixture(call => call.url.pathname.includes("recurring-consent-drafts/") ? Response.json(p) : undefined);
      await expect(new RemoteSkillsClient("fixture", "https://fixture.example.test").getRecurringDraft(id(7))).rejects.toBeInstanceOf(RemoteRecurringReadError);
    }
    const retained = consent(); retained.terms.approvedByUserId = id(90); retained.terms.approvedMembershipId = id(91); retained.terms.deploymentId = "retained-other"; retained.termsSha256 = canonicalJsonSha256(retained.terms);
    fixture(call => call.url.pathname.endsWith(id(8)) ? Response.json(retained) : undefined);
    expect(await new RemoteSkillsClient("fixture", "https://fixture.example.test").getRecurringConsent(id(8))).toEqual(retained);
  });
  test("bounded responses cancel chunked/declared overflow and never automatically reduce page size", async () => {
    for (const declared of [true, false]) {
      let cancelled = false;
      const calls = fixture(call => {
        if (!call.url.pathname.includes("recurring-consent-drafts/")) return;
        return new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } }),
          { headers: declared ? { "content-length": String(3 * 1024 * 1024) } : {} });
      });
      await expect(new RemoteSkillsClient("fixture", "https://fixture.example.test").getRecurringDraft(id(7))).rejects.toBeInstanceOf(RemoteRecurringReadError);
      expect(cancelled).toBe(true); expect(calls.filter(c => c.url.pathname.includes("recurring-consent-drafts/"))).toHaveLength(1);
    }
  });
  test("page count, duplicates, cursor progress and schedule binding fail closed", async () => {
    for (const value of [ { contractVersion: 1, items: [consent(), consent()], nextCursor: null },
      { contractVersion: 1, items: [consent()], nextCursor: "same" }, { contractVersion: 1, items: [], nextCursor: "next" }]) {
      expect(() => parseRecurringResult("list", value, { limit: 1, cursor: "same" }, identity)).toThrow();
    }
    const calls = fixture(call => call.url.pathname.endsWith("/occurrences") ? Response.json({ contractVersion: 1, items: [{ occurrenceId: id(20), scheduleId: id(99), dueAt: request().startsAt,
      periodStartsAt: "2026-09-15T00:00:00.000Z", periodEndsAt: "2026-09-16T00:00:00.000Z", outcome: "admitted", reason: null, runId: id(21), quotedCredits: 1, allocationState: "reserved" }], nextCursor: null }) : undefined);
    await expect(new RemoteSkillsClient("fixture", "https://fixture.example.test").listRecurringOccurrences(id(8))).rejects.toBeInstanceOf(RemoteRecurringReadError);
    expect(calls.every(c => c.method === "GET")).toBe(true);
  });
  test("canonical JSON preserves key order, refuses silent transforms and snapshots bounded finite data", () => {
    expect(canonicalJson({ b: 2, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":2}');
    expect(canonicalJsonSha256({ a: 1, b: 2 })).toBe(canonicalJsonSha256({ b: 2, a: 1 }));
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const value of [undefined, NaN, Infinity, new Date(), { a: undefined }, [undefined], Array(1), cycle, { get value() { throw Error("must not execute"); } }, { toJSON: () => 1 }])
      expect(() => canonicalJson(value)).toThrow();
    let nested: unknown = {}; for (let i = 0; i < 66; i++) nested = { nested };
    expect(() => canonicalJson(nested)).toThrow(); expect(() => canonicalJson("oversized", 2)).toThrow();
    const raw = request(), captured = recurringInput("preview", raw); raw.args.push("later"); expect(captured.args).toEqual(["original"]);
  });
  test("maximum-depth inputs survive preview, draft, activation and page wrappers without relaxing terms", async () => {
    const nested = (levels: number): NonNullable<RecurringRequest["input"][string]> => {
      let value: NonNullable<RecurringRequest["input"][string]> = "leaf";
      for (let i = 0; i < levels; i++) value = { child: value };
      return value;
    };
    for (const levels of [0, 59, 60, 61, 62]) {
      const raw = request(); raw.input = { nested: nested(levels) };
      const captured = recurringInput("preview", raw), p = preview(captured);
      const view = { ...consent(), terms: p.terms, termsSha256: p.termsSha256 };
      const accepted = { ...approval(), acceptedTermsSha256: p.termsSha256 };
      const calls = fixture(call => {
        const path = call.url.pathname;
        if (path.endsWith("/preview") || path.includes("recurring-consent-drafts/")) return Response.json(p);
        if (path.endsWith("/activate")) return Response.json({ replayed: false, consent: view });
        if (path.endsWith("/recurring-consents")) return Response.json({ contractVersion: 1, items: [view], nextCursor: null });
        if (path.endsWith(id(8))) return Response.json(view);
      });
      const client = new RemoteSkillsClient("fixture", "https://fixture.example.test");
      expect(await client.previewRecurringConsent(raw)).toEqual(p);
      expect(await client.getRecurringDraft(p.draftId)).toEqual(p);
      expect(await client.activateRecurringConsent(p.draftId, accepted)).toEqual({ replayed: false, consent: view });
      expect(await client.getRecurringConsent(view.consentId)).toEqual(view);
      expect((await client.listRecurringConsents({ limit: 1 })).items).toEqual([view]);
      expect(calls.filter(call => call.method === "POST").length).toBe(2);
      expect(calls.find(call => call.url.pathname.endsWith("/activate"))!.body).toEqual(accepted);
    }
    const oversized = request(); oversized.input = { nested: nested(63) };
    const calls = fixture();
    await expect(new RemoteSkillsClient("fixture", "https://fixture.example.test").previewRecurringConsent(oversized)).rejects.toBeInstanceOf(RecurringInputError);
    expect(calls.length).toBe(0);
    const invalid = { ...preview(), terms: { ...terms(), input: oversized.input } };
    expect(() => parseRecurringResult("draft", invalid, { draftId: invalid.draftId }, identity)).toThrow("Canonical JSON exceeds its depth bound");
    const excessiveEnvelope = { ...preview(), extra: nested(67) };
    expect(() => parseRecurringResult("draft", excessiveEnvelope, { draftId: excessiveEnvelope.draftId }, identity)).toThrow("Canonical JSON exceeds its depth bound");
  });
});
