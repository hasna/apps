import { evaluateGuardrail } from "./evaluator";
import type { EvaluateGuardrailOptions, GuardrailDecision, GuardrailInput, GuardrailPolicySet } from "./types";

export interface GuardrailDecisionService {
  evaluate(input: GuardrailInput, options?: EvaluateGuardrailOptions): Promise<GuardrailDecision>;
}

export class LocalGuardrailDecisionService implements GuardrailDecisionService {
  readonly policySet: GuardrailPolicySet;

  constructor(policySet: GuardrailPolicySet) {
    this.policySet = policySet;
  }

  async evaluate(input: GuardrailInput, options: EvaluateGuardrailOptions = {}): Promise<GuardrailDecision> {
    return evaluateGuardrail(input, this.policySet, options);
  }
}

export type HttpGuardrailDecisionServiceOptions = {
  endpoint: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
};

export class HttpGuardrailDecisionService implements GuardrailDecisionService {
  readonly endpoint: string;
  readonly headers: Record<string, string>;
  readonly fetchImpl: typeof fetch;

  constructor(options: HttpGuardrailDecisionServiceOptions) {
    this.endpoint = options.endpoint;
    this.headers = options.headers ?? {};
    this.fetchImpl = options.fetch ?? fetch;
  }

  async evaluate(input: GuardrailInput, options: EvaluateGuardrailOptions = {}): Promise<GuardrailDecision> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...this.headers,
      },
      body: JSON.stringify({ input, options }),
    });
    if (!response.ok) throw new Error(`Guardrail service returned HTTP ${response.status}`);
    return (await response.json()) as GuardrailDecision;
  }
}
