import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  TelephonySafetyError,
  computeTwilioSignature,
  enforceTelephonyMutationGate,
  listQueuedTelephonyMutations,
  resetTelephonySafetyState,
  retryQueuedTelephonyMutation,
  telephonyProviderSmoke,
  validateOutboundTarget,
  validateProvisioningCountry,
} from "./safety.js";

const touchedEnv = [
  "TELEPHONY_ALLOWED_COUNTRIES",
  "TELEPHONY_BLOCKED_PHONE_PREFIXES",
  "TELEPHONY_MAX_DAILY_MUTATIONS_PER_DESTINATION",
  "TELEPHONY_MUTATION_QUOTA_WINDOW_MS",
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  resetTelephonySafetyState();
  for (const key of touchedEnv) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  resetTelephonySafetyState();
  for (const key of touchedEnv) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
});

describe("validateOutboundTarget", () => {
  test("accepts trimmed E.164 boundaries and WhatsApp-prefixed targets", () => {
    expect(() => validateOutboundTarget("  +1234567  ", "sms")).not.toThrow();
    expect(() => validateOutboundTarget("+123456789012345", "call")).not.toThrow();
    expect(() => validateOutboundTarget("whatsapp:+1234567890", "whatsapp")).not.toThrow();
  });

  test("rejects invalid types, lengths, prefixes, and punctuation", () => {
    for (const target of [undefined, 123, "", "+01234567", "+123456", "+1234567890123456", "+123-456-7890"]) {
      expect(() => validateOutboundTarget(target, "sms")).toThrow(TelephonySafetyError);
    }
  });

  test("honors configured blocked prefixes after syntax validation", () => {
    process.env["TELEPHONY_BLOCKED_PHONE_PREFIXES"] = "+1234,+9876";
    expect(() => validateOutboundTarget("+1234567890", "call")).toThrow("toll-fraud safety gate");
    expect(() => validateOutboundTarget("+5554567890", "call")).not.toThrow();
  });
});

describe("validateProvisioningCountry", () => {
  test("normalizes whitespace and case and defaults to the first-party baseline", () => {
    expect(() => validateProvisioningCountry(undefined)).not.toThrow();
    expect(() => validateProvisioningCountry(" ca ")).not.toThrow();
  });

  test("uses the configured allowlist and rejects values outside it", () => {
    process.env["TELEPHONY_ALLOWED_COUNTRIES"] = "gb, ro";
    expect(() => validateProvisioningCountry("RO")).not.toThrow();
    expect(() => validateProvisioningCountry("US")).toThrow("not in TELEPHONY_ALLOWED_COUNTRIES");
  });
});

describe("mutation gate", () => {
  test("requires an idempotency header before recording any operation", async () => {
    const response = enforceTelephonyMutationGate(new Request("https://example.test/send"), "send_sms", "+1234567890");
    expect(response?.status).toBe(428);
    expect(await response?.json()).toEqual({
      error: "Mutating telephony REST requests require an Idempotency-Key header.",
      required_headers: ["Idempotency-Key"],
    });
    expect(listQueuedTelephonyMutations()).toEqual([]);
  });

  test("queues fixture operations and deduplicates by idempotency key", async () => {
    const request = new Request("https://example.test/send", {
      headers: { "idempotency-key": "fixture-operation-1" },
    });
    const first = enforceTelephonyMutationGate(request, "send_sms", " +1234567890 ");
    expect(first?.status).toBe(202);
    const firstBody = (await first?.json()) as { status: string; operation: { target: string } };
    expect(firstBody.status).toBe("queued");
    expect(firstBody.operation.target).toBe("+1234567890");

    const duplicate = enforceTelephonyMutationGate(request, "send_sms", "+1234567890");
    expect(duplicate?.status).toBe(202);
    expect((await duplicate?.json() as { status: string }).status).toBe("duplicate");
    expect(listQueuedTelephonyMutations()).toHaveLength(1);
  });

  test("blocks live mutation until every approval proof is present", async () => {
    const pendingRequest = new Request("https://example.test/send", {
      headers: {
        "idempotency-key": "live-operation-pending",
        "x-telephony-provider-mode": "live_mutating",
        "x-telephony-sandbox-smoke": "passed",
      },
    });
    const pending = enforceTelephonyMutationGate(pendingRequest, "make_call", "+1234567890");
    expect(pending?.status).toBe(202);
    const pendingBody = (await pending?.json()) as { status: string; missing_headers: string[] };
    expect(pendingBody.status).toBe("awaiting_operator_approval");
    expect(pendingBody.missing_headers).toEqual([
      "x-telephony-live-execution",
      "x-telephony-operator-approval",
    ]);

    const approvedRequest = new Request("https://example.test/send", {
      headers: {
        "idempotency-key": "live-operation-approved",
        "x-telephony-provider-mode": "live_mutating",
        "x-telephony-live-execution": "approved",
        "x-telephony-operator-approval": "approved",
        "x-telephony-sandbox-smoke": "passed",
      },
    });
    expect(enforceTelephonyMutationGate(approvedRequest, "make_call", "+1234567890")).toBeNull();
    expect(listQueuedTelephonyMutations()).toHaveLength(1);
  });

  test("enforces the configured per-destination quota", async () => {
    process.env["TELEPHONY_MAX_DAILY_MUTATIONS_PER_DESTINATION"] = "1";
    const first = new Request("https://example.test/send", { headers: { "idempotency-key": "quota-1" } });
    const second = new Request("https://example.test/send", { headers: { "idempotency-key": "quota-2" } });
    expect(enforceTelephonyMutationGate(first, "send_sms", "+1234567890")?.status).toBe(202);
    const limited = enforceTelephonyMutationGate(second, "send_sms", "+1234567890");
    expect(limited?.status).toBe(429);
    expect((await limited?.json() as { limit: number }).limit).toBe(1);
  });

  test("retries queued operations without exposing live-approved entries", async () => {
    const request = new Request("https://example.test/send", {
      headers: { "idempotency-key": "retry-operation" },
    });
    const response = enforceTelephonyMutationGate(request, "send_whatsapp", "whatsapp:+1234567890");
    const body = (await response?.json()) as { operation: { id: string } };
    const retried = retryQueuedTelephonyMutation(body.operation.id);
    expect(retried?.attempts).toBe(1);
    expect(Date.parse(retried?.retryAfter ?? "")).toBeGreaterThan(Date.parse(retried?.updatedAt ?? ""));
    expect(retryQueuedTelephonyMutation("missing")).toBeUndefined();
  });
});

describe("provider smoke and signatures", () => {
  test("rejects unknown smoke operations", async () => {
    const response = telephonyProviderSmoke(new Request("https://example.test/smoke"), { operation: "rest_read" });
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toContain("must be a mutating provider operation");
  });

  test("never marks live smoke ready without both approval headers", async () => {
    const blocked = telephonyProviderSmoke(
      new Request("https://example.test/smoke", {
        headers: { "x-telephony-provider-mode": "live_mutating" },
      }),
      { operation: "send_sms", to: "+1234567890" },
    );
    expect(blocked.status).toBe(202);
    const body = (await blocked.json()) as { status: string; live_execution: boolean; missing_headers: string[] };
    expect(body.status).toBe("live_smoke_blocked");
    expect(body.live_execution).toBeFalse();
    expect(body.missing_headers).toEqual([
      "x-telephony-operator-approval",
      "x-telephony-live-smoke",
    ]);
  });

  test("reports sandbox proof without provider side effects", async () => {
    const response = telephonyProviderSmoke(
      new Request("https://example.test/smoke", {
        headers: { "x-telephony-provider-mode": "sandbox" },
      }),
      { operation: "send_whatsapp", to: "whatsapp:+1234567890" },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "sandbox_smoke_passed",
      live_execution: false,
      provider_mode: "sandbox",
    });
  });

  test("signature generation is stable across parameter insertion order", () => {
    const url = "https://example.test/webhook";
    const first = computeTwilioSignature(url, { From: "+1234567890", Body: "hello" }, "fixture");
    const reordered = computeTwilioSignature(url, { Body: "hello", From: "+1234567890" }, "fixture");
    const changed = computeTwilioSignature(url, { Body: "changed", From: "+1234567890" }, "fixture");
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });
});
