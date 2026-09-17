import { expect, test } from "bun:test";
import { useDefaultTestTimeout } from "../test-preload.js";
import { join } from "node:path";
import { prepareRecurringCustomer, recurringCustomerError } from "./recurring-customer.js";
import { executeRecurringSurface } from "./recurring-surface.js";
import { recurringProtocol, recurringFixtureRequest } from "./recurring-surface.fixture.js";
import { readRecurringRecovery } from "./recurring-recovery.js";
useDefaultTestTimeout();

test("shared surface captures original approval and current profile before asynchronous work", () => recurringProtocol(async f => {
  const before = f.snapshot(), originalKey = f.approval.idempotencyKey;
  const value = { ...f.context, draftId: f.draftId, approval: { ...f.approval }, recoveryDirectory: join(f.root, "activation"), email: "owner@example.test", code: "123456", confirm: true };
  let changed = false;
  f.intercept(() => { if (!changed) { changed = true; value.approval.idempotencyKey = "replacement-key-not-accepted"; value.draftId = "ffffffff-ffff-4fff-8fff-ffffffffffff"; } });
  const result = await executeRecurringSurface("activate", value, f.env) as any;
  expect(result.phase).toBe("observed"); expect(result.result.consent.consentId).toBe(f.consent()!.consentId);
  const posts = f.calls.filter(call => call.path.endsWith("/activate")); expect(posts).toHaveLength(1);
  expect(posts[0]!.body.idempotencyKey).toBe(originalKey); expect(posts[0]!.authorization).toBe("Bearer inert-session");
  expect(f.snapshot()).toEqual(before);
  const receipt = readRecurringRecovery(value.recoveryDirectory);
  expect(receipt.intent.operation).toBe("activate"); expect(JSON.stringify(receipt)).not.toContain("inert-session"); expect(JSON.stringify(receipt)).not.toContain("123456");
}));

test("profile changes during a request refuse before a later mutation and never retarget", () => recurringProtocol(async f => {
  const customer = await prepareRecurringCustomer(f.context, f.env);
  f.env.HASNA_PROFILE = "sibling";
  const count = f.calls.length;
  await expect(customer.call("preview", recurringFixtureRequest())).rejects.toMatchObject({ code: "RECURRING_TARGET_CHANGED" });
  expect(f.calls).toHaveLength(count);
}));

test("TTY consent cancellation precedes OTP, local recovery creation and activation", () => recurringProtocol(async f => {
  let shown = false, codeRequested = false;
  const result = await executeRecurringSurface("activate", { ...f.context, draftId: f.draftId, approval: f.approval,
    recoveryDirectory: join(f.root, "cancelled"), email: "owner@example.test" }, f.env, {
    accept: async draft => { expect(draft).toEqual(f.preview()); shown = true; return false; },
    verification: async () => { codeRequested = true; return "123456"; },
  });
  expect(result).toEqual({ cancelled: true, activated: false }); expect(shown).toBe(true); expect(codeRequested).toBe(false);
  expect(f.calls.filter(call => call.method === "POST")).toHaveLength(0);
}));

test("noninteractive absence of exact confirmation and malformed inputs refuse before any request", () => recurringProtocol(async f => {
  const base = { ...f.context, draftId: f.draftId, approval: f.approval, recoveryDirectory: join(f.root, "rejected"), email: "owner@example.test" };
  for (const value of [base, { ...base, confirm: true }, { ...base, confirm: false, code: "123456" },
    { ...base, confirm: true, code: "123456", approval: { ...f.approval, acceptance: "yes" } }])
    await expect(executeRecurringSurface("activate", value, f.env)).rejects.toBeDefined();
  for (const request of [{ ...recurringFixtureRequest(), maxCreditsTotal: -1 }, { ...recurringFixtureRequest(), extra: "unexpected" }])
    await expect(executeRecurringSurface("preview", { request }, f.env)).rejects.toBeDefined();
  await expect(executeRecurringSurface("list", { userId: f.context.userId }, f.env)).rejects.toBeDefined();
  expect(f.calls).toHaveLength(0);
}));

test("fresh verification mismatch preserves current profile and never submits activation", () => recurringProtocol(async f => {
  const before = f.snapshot();
  await expect(executeRecurringSurface("activate", { ...f.context, draftId: f.draftId, approval: f.approval,
    recoveryDirectory: join(f.root, "wrong-code"), email: "owner@example.test", code: "000000", confirm: true }, f.env))
    .rejects.toMatchObject({ code: "RECURRING_VERIFICATION_FAILED" });
  expect(f.calls.filter(call => call.path.endsWith("/activate"))).toHaveLength(0); expect(f.snapshot()).toEqual(before);
  const error = recurringCustomerError(new Error("inert-secret-response")); expect(JSON.stringify(error)).not.toContain("inert-secret-response");
}));

test("verification helper reads the original draft then requests delivery without claiming delivery", () => recurringProtocol(async f => {
  const result = await executeRecurringSurface("verification", { ...f.context, draftId: f.draftId, email: "owner@example.test", confirm: true }, f.env);
  expect(result).toEqual({ verificationRequested: true, deliveryConfirmed: false, draftId: f.draftId, activated: false });
  expect(f.calls.filter(call => call.method === "POST").map(call => call.path)).toEqual(["/prefix/api/auth/login"]);
}));

test("verification binds the current account email before login or OTP consumption", () => recurringProtocol(async f => {
  const customer = await prepareRecurringCustomer(f.context, f.env);
  for (const email of ["unknown@example.test", "other@example.test"]) {
    await expect(customer.requestCode(email)).rejects.toMatchObject({ code: "RECURRING_ACCOUNT_EMAIL_MISMATCH" });
    await expect(customer.fresh(email, "123456")).rejects.toMatchObject({ code: "RECURRING_ACCOUNT_EMAIL_MISMATCH" });
  }
  expect(f.calls.filter(call => call.method === "POST")).toHaveLength(0);
  await customer.requestCode("  OWNER@EXAMPLE.TEST  ");
  await customer.fresh(" OWNER@EXAMPLE.TEST ", "123456");
  expect(f.calls.filter(call => ["/prefix/api/auth/login", "/prefix/api/auth/verify"].includes(call.path)).map(call => call.body.email))
    .toEqual(["owner@example.test", "owner@example.test"]);
}));

test("fresh approval rereads current account email after a verification request", () => recurringProtocol(async f => {
  const customer = await prepareRecurringCustomer(f.context, f.env);
  await customer.requestCode("owner@example.test");
  f.intercept(call => call.path.endsWith("/auth/whoami") ? Response.json({ ...f.identity, user: { ...f.identity.user, email: "changed@example.test" }, authMethod: "api_key" }) : undefined);
  await expect(customer.fresh("owner@example.test", "123456")).rejects.toMatchObject({ code: "RECURRING_ACCOUNT_EMAIL_MISMATCH" });
  expect(f.calls.filter(call => call.path.endsWith("/auth/verify"))).toHaveLength(0);
}));
