import { expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prepareRecurringCustomer } from "./recurring-customer.js";
import { prepareRecurringActivation, continueRecurringRecovery, readRecurringRecovery } from "./recurring-recovery.js";
import { executeRecurringSurface } from "./recurring-surface.js";
import { canonicalJsonSha256 } from "./canonical-json.js";
import { recurringProtocol } from "./recurring-surface.fixture.js";
import { saveApiUrl, saveAuthConfig } from "./auth-store.js";
useDefaultTestTimeout();

for (const mismatch of ["origin", "profile"] as const) for (const pending of [false, true]) {
  test(`confirmed interactive recovery binds the original ${mismatch} before draft or OTP work (${pending ? "pending" : "prepared"})`, () => recurringProtocol(async f => {
    const customer = await prepareRecurringCustomer(f.context, f.env), directory = join(f.root, "target-bound");
    await prepareRecurringActivation(customer, directory, f.draftId, f.approval);
    if (pending) {
      f.loseActivationResponse();
      await expect(continueRecurringRecovery(customer, directory, { confirm: true, email: "owner@example.test", code: "123456" })).rejects.toMatchObject({ outcomeUnknown: true });
    }
    const original = readRecurringRecovery(directory), selected = mismatch === "origin" ? "https://foreign.example.test/prefix" : f.origin;
    const env = { ...f.env, ...(mismatch === "profile" ? { HASNA_PROFILE: "other" } : {}) };
    saveApiUrl(selected, env); saveAuthConfig({ apiKey: "inert-selected-key" }, env);
    const requests: Array<{ path: string; method: string }> = [];
    // A different selected target deliberately returns matching identity UUIDs
    // and terms. Identity equality must not hide origin/profile substitution.
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      expect(url.origin).toBe(new URL(selected).origin);
      requests.push({ path: url.pathname, method: init?.method ?? "GET" });
      return f.fetch(f.origin + url.pathname.slice("/prefix".length), init);
    }) as typeof fetch;
    let accepted = 0, verified = 0;
    await expect(executeRecurringSurface("recover", { recoveryDirectory: directory, confirm: true, email: "owner@example.test" }, env, {
      async accept() { accepted++; return true; },
      async verification(_email, requestCode) { verified++; await requestCode(); return "123456"; },
    })).rejects.toMatchObject(pending ? { outcomeUnknown: true } : { code: "RECURRING_RECOVERY_TARGET_MISMATCH" });
    expect(requests.filter(row => row.path.includes("recurring-consent-drafts/") || row.method === "POST")).toHaveLength(0);
    expect(accepted).toBe(0); expect(verified).toBe(0);
    expect(readRecurringRecovery(directory)).toEqual(original);
  }));
}

test("unknown response keeps the original key; read-only recovery never replays and explicit recovery observes one protocol grant", () => recurringProtocol(async f => {
  const customer = await prepareRecurringCustomer(f.context, f.env), directory = join(f.root, "recovery");
  await prepareRecurringActivation(customer, directory, f.draftId, f.approval);
  const intent = readRecurringRecovery(directory).intent;
  f.loseActivationResponse();
  await expect(continueRecurringRecovery(customer, directory, { confirm: true, email: "owner@example.test", code: "123456" })).rejects.toMatchObject({ outcomeUnknown: true });
  expect(readRecurringRecovery(directory).phase).toBe("pending"); const count = f.calls.filter(c => c.path.endsWith("/activate")).length;
  expect((await continueRecurringRecovery(customer, directory, { confirm: false })).outcomeUnknown).toBe(true);
  expect(f.calls.filter(c => c.path.endsWith("/activate"))).toHaveLength(count);
  await expect(continueRecurringRecovery(customer, directory, { confirm: true, email: "owner@example.test", code: "000000" })).rejects.toMatchObject({ outcomeUnknown: true });
  expect(readRecurringRecovery(directory).phase).toBe("pending");
  const recovered = await continueRecurringRecovery(customer, directory, { confirm: true, email: "owner@example.test", code: "123456" });
  expect(recovered).toMatchObject({ outcomeUnknown: false, phase: "observed", result: { replayed: true } });
  expect(readRecurringRecovery(directory).intent).toEqual(intent);
  expect(f.calls.filter(c => c.path.endsWith("/activate")).map(c => c.body.idempotencyKey)).toEqual([f.approval.idempotencyKey, f.approval.idempotencyKey]);
  expect(readdirSync(directory).includes("operation.lock")).toBe(false);
}));

test("recognized first-attempt refusal is definitive but retains the exact intent", () => recurringProtocol(async f => {
  const customer = await prepareRecurringCustomer(f.context, f.env), directory = join(f.root, "refused");
  await prepareRecurringActivation(customer, directory, f.draftId, f.approval);
  f.intercept(call => call.path.endsWith("/activate") ? Response.json({ code: "RECURRING_AUTHORITY_REFUSED" }, { status: 403 }) : undefined);
  await expect(continueRecurringRecovery(customer, directory, { confirm: true, email: "owner@example.test", code: "123456" })).rejects.toMatchObject({ code: "RECURRING_AUTHORITY_REFUSED" });
  expect(readRecurringRecovery(directory).phase).toBe("prepared");
}));

test("record tampering, aliases, loose privacy and concurrent lock refuse without a mutation", () => recurringProtocol(async f => {
  const customer = await prepareRecurringCustomer(f.context, f.env);
  for (const fault of ["tamper", "alias", "privacy", "lock"]) {
    const directory = join(f.root, fault); await prepareRecurringActivation(customer, directory, f.draftId, f.approval);
    let target = directory;
    if (fault === "tamper") { const name = readdirSync(directory).find(n => n.startsWith("intent-"))!; const row = JSON.parse(readFileSync(join(directory, name), "utf8")); row.approval.idempotencyKey = "substituted-activation-key"; writeFileSync(join(directory, name), JSON.stringify(row)); }
    if (fault === "alias") { target = join(f.root, "alias-link"); symlinkSync(directory, target); }
    if (fault === "privacy") chmodSync(directory, 0o755);
    if (fault === "lock") writeFileSync(join(directory, "operation.lock"), "retained-other-operation", { mode: 0o600 });
    const count = f.calls.length;
    await expect(continueRecurringRecovery(customer, target, { confirm: true, email: "owner@example.test", code: "123456" })).rejects.toBeDefined();
    expect(f.calls).toHaveLength(count); expect(existsSync(directory)).toBe(true);
  }
}));

test("moving/replacing the owned recovery root during verification preserves both paths and refuses activation", () => recurringProtocol(async f => {
  const customer = await prepareRecurringCustomer(f.context, f.env), directory = join(f.root, "original"), moved = join(f.root, "moved");
  await prepareRecurringActivation(customer, directory, f.draftId, f.approval);
  f.intercept(call => {
    if (call.path.endsWith("/auth/verify")) { renameSync(directory, moved); mkdirSync(directory, { mode: 0o700 }); writeFileSync(join(directory, "replacement"), "preserve", { mode: 0o600 }); }
  });
  await expect(continueRecurringRecovery(customer, directory, { confirm: true, email: "owner@example.test", code: "123456" })).rejects.toBeDefined();
  expect(f.calls.filter(c => c.path.endsWith("/activate"))).toHaveLength(0);
  expect(existsSync(join(moved, "operation.lock"))).toBe(true); expect(readFileSync(join(directory, "replacement"), "utf8")).toBe("preserve");
}));

test("revocation readback preserves cancellation distinction and repeated recovery makes no second POST", () => recurringProtocol(async f => {
  await executeRecurringSurface("activate", { ...f.context, draftId: f.draftId, approval: f.approval, recoveryDirectory: join(f.root, "grant"), email: "owner@example.test", code: "123456", confirm: true }, f.env);
  const directory = join(f.root, "revoke");
  const result = await executeRecurringSurface("revoke", { ...f.context, consentId: f.consent()!.consentId, recoveryDirectory: directory, confirm: true }, f.env) as any;
  expect(result.result.cancellationIsSeparate).toBe(true);
  const count = f.calls.filter(c => c.path.endsWith("/revoke")).length;
  const recovered = await executeRecurringSurface("recover", { recoveryDirectory: directory }, f.env) as any;
  expect(recovered.result.state).toBe("revoked"); expect(f.calls.filter(c => c.path.endsWith("/revoke"))).toHaveLength(count);
}));

test("an observed activation record cannot substitute another same-tenant consent with different immutable terms", () => recurringProtocol(async f => {
  const directory = join(f.root, "observed");
  await executeRecurringSurface("activate", { ...f.context, draftId: f.draftId, approval: f.approval,
    recoveryDirectory: directory, email: "owner@example.test", code: "123456", confirm: true }, f.env);
  const other = f.consent()!;
  other.consentId = "00000000-0000-4000-8000-000000000010";
  other.terms.maxCreditsTotal++;
  other.termsSha256 = canonicalJsonSha256(other.terms);
  const state = JSON.parse(readFileSync(join(directory, "state.json"), "utf8"));
  state.consentId = other.consentId;
  writeFileSync(join(directory, "state.json"), JSON.stringify(state));
  f.intercept(call => call.path.endsWith(`/recurring-consents/${other.consentId}`) ? Response.json(other) : undefined);
  const mutations = f.calls.filter(call => call.method === "POST").length;
  await expect(executeRecurringSurface("recover", { recoveryDirectory: directory }, f.env)).rejects.toMatchObject({ code: "RECURRING_TERMS_UNAVAILABLE" });
  expect(f.calls.filter(call => call.method === "POST")).toHaveLength(mutations);
  expect(JSON.parse(readFileSync(join(directory, "state.json"), "utf8"))).toEqual(state);
}));
