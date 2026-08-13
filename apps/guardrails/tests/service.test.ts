import { describe, expect, mock, test } from "bun:test";
import { HttpGuardrailDecisionService, LocalGuardrailDecisionService } from "../src";
import type { GuardrailDecision, GuardrailInput, GuardrailPolicySet } from "../src";

const input: GuardrailInput = { operationType: "prompt", prompt: { text: "placeholder" } };
const policySet: GuardrailPolicySet = {
  id: "service-policy",
  policies: [{ id: "warn", effect: "warn", reason: "Service placeholder warning." }],
};

const responseDecision: GuardrailDecision = {
  status: "allow",
  allowed: true,
  reason: "Remote placeholder allow.",
  matchedRule: null,
  matchedPolicies: [],
  rationaleTrace: [],
  evidence: [],
  obligations: [],
  redactions: [],
  approvalRequirements: [],
  audit: {
    decisionId: "remote-decision",
    decisionFingerprint: "0123456789abcdef0123456789abcdef",
    evaluatedAt: "2026-07-01T00:00:00.000Z",
    engineVersion: "test",
    policySetId: "remote-policy",
    operationType: "prompt",
    labels: [],
  },
};

describe("decision services", () => {
  test("local service evaluates with its configured policy", async () => {
    const service = new LocalGuardrailDecisionService(policySet);
    const decision = await service.evaluate(input, { decisionId: "local-decision" });
    expect(service.policySet).toBe(policySet);
    expect(decision.status).toBe("warn");
    expect(decision.audit.decisionId).toBe("local-decision");
  });

  test("HTTP service posts input and options with configured headers", async () => {
    const fetchMock = mock(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json(responseDecision),
    );
    const service = new HttpGuardrailDecisionService({
      endpoint: "https://guardrails.invalid/evaluate",
      headers: { authorization: "Bearer PLACEHOLDER_TOKEN" },
      fetch: fetchMock as unknown as typeof fetch,
    });
    const decision = await service.evaluate(input, { decisionId: "requested-decision" });

    expect(decision).toEqual(responseDecision);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://guardrails.invalid/evaluate");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer PLACEHOLDER_TOKEN",
    });
    expect(JSON.parse(String(init?.body))).toEqual({ input, options: { decisionId: "requested-decision" } });
  });

  test("HTTP service rejects non-success responses", async () => {
    const fetchMock = mock(async () => new Response("placeholder failure", { status: 503 }));
    const service = new HttpGuardrailDecisionService({
      endpoint: "https://guardrails.invalid/evaluate",
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(service.evaluate(input)).rejects.toThrow("Guardrail service returned HTTP 503");
  });
});
