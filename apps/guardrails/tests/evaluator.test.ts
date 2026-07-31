import { describe, expect, test } from "bun:test";
import {
  defaultGuardrailPolicySet,
  evaluateGuardrail,
  modelRoutingGuardrailInput,
  openActionsGuardrailInput,
  openTerminalCommandGuardrailInput,
} from "../src";
import type { GuardrailInput, GuardrailPolicySet } from "../src";

describe("evaluateGuardrail", () => {
  test("applies deny > approval > redact > warn > allow precedence", () => {
    const policies: GuardrailPolicySet["policies"] = [
      {
        id: "deny-rule",
        effect: "deny",
        reason: "deny won",
      },
      {
        id: "approval-rule",
        effect: "approval_required",
        reason: "approval won",
        when: { operationTypes: ["prompt"] },
      },
      {
        id: "redact-rule",
        effect: "redact",
        reason: "redact won",
        when: { operationTypes: ["prompt"], textIncludes: ["TOKEN"] },
        redactions: [{ id: "token", pattern: "TOKEN" }],
      },
      {
        id: "warn-rule",
        effect: "warn",
        reason: "warn won",
        when: {
          operationTypes: ["prompt"],
          textIncludes: ["TOKEN"],
          actorRolesAny: ["operator"],
        },
      },
      {
        id: "allow-rule",
        effect: "allow",
        reason: "allow won",
        when: {
          operationTypes: ["prompt"],
          textIncludes: ["TOKEN"],
          actorRolesAny: ["operator"],
          tagsAny: ["specific"],
        },
      },
    ];
    const input: GuardrailInput = {
      operationType: "prompt",
      prompt: { text: "TOKEN" },
      actor: { roles: ["operator"] },
      tags: ["specific"],
    };
    const expected = ["deny", "approval_required", "redact", "warn", "allow"] as const;

    for (const [index, status] of expected.entries()) {
      const decision = evaluateGuardrail(input, {
        id: `precedence-${status}`,
        policies: policies.slice(index),
      });

      expect(decision.status).toBe(status);
      expect(decision.matchedRule?.effect).toBe(status);
      expect(decision.matchedRule).toEqual(decision.matchedPolicies[0] ?? null);
      expect(decision.rationaleTrace.find((entry) => entry.selected)?.policyId).toBe(decision.matchedRule?.id);
    }
  });

  test("selects the most-specific rule independently of policy order", () => {
    const broad: GuardrailPolicySet["policies"][number] = {
      id: "a-broad-warning",
      effect: "warn",
      reason: "broad",
      when: {
        operationTypes: ["prompt", "action"],
        textIncludes: ["deploy", "release"],
      },
    };
    const narrow: GuardrailPolicySet["policies"][number] = {
      id: "z-narrow-warning",
      effect: "warn",
      reason: "narrow",
      when: {
        operationTypes: ["prompt"],
        textIncludes: ["deploy"],
      },
    };
    const input: GuardrailInput = { operationType: "prompt", prompt: { text: "deploy now" } };
    const first = evaluateGuardrail(input, {
      id: "specificity-forward",
      policies: [broad, narrow],
    });
    const reversed = evaluateGuardrail(input, {
      id: "specificity-reversed",
      policies: [narrow, broad],
    });

    expect(first.matchedRule?.id).toBe("z-narrow-warning");
    expect(reversed.matchedRule?.id).toBe("z-narrow-warning");
    expect(first.rationaleTrace.find((entry) => entry.policyId === broad.id)?.rationale).toContain("fewer alternatives");
  });

  test("ranks by constraint count when both rules offer the same number of alternatives", () => {
    // Both matchers total two alternatives, so the alternatives tie-break cannot
    // decide this pair; only the constraint count can. The broad rule also sorts
    // first by id, so the id tie-break would pick the wrong rule.
    const broad: GuardrailPolicySet["policies"][number] = {
      id: "a-broad-two-operations",
      effect: "warn",
      reason: "broad",
      when: { operationTypes: ["prompt", "action"] },
    };
    const narrow: GuardrailPolicySet["policies"][number] = {
      id: "z-narrow-tagged-prompt",
      effect: "warn",
      reason: "narrow",
      when: { operationTypes: ["prompt"], tagsAny: ["release"] },
    };
    const input: GuardrailInput = {
      operationType: "prompt",
      tags: ["release"],
      prompt: { text: "ship it" },
    };
    const forward = evaluateGuardrail(input, { id: "constraints-forward", policies: [broad, narrow] });
    const reversed = evaluateGuardrail(input, { id: "constraints-reversed", policies: [narrow, broad] });

    expect(forward.matchedRule?.id).toBe("z-narrow-tagged-prompt");
    expect(reversed.matchedRule?.id).toBe("z-narrow-tagged-prompt");
    expect(forward.rationaleTrace.find((entry) => entry.policyId === narrow.id)?.specificity).toBe(2);
    expect(forward.rationaleTrace.find((entry) => entry.policyId === broad.id)?.specificity).toBe(1);
    expect(forward.rationaleTrace.find((entry) => entry.policyId === broad.id)?.rationale).toContain(
      "won with 2 constraints versus 1",
    );
  });

  test("uses policy id as the deterministic final tie-break", () => {
    const policy = (id: string): GuardrailPolicySet["policies"][number] => ({
      id,
      effect: "warn",
      reason: id,
      when: { operationTypes: ["prompt"] },
    });
    const input: GuardrailInput = { operationType: "prompt", prompt: { text: "hello" } };

    const forward = evaluateGuardrail(input, { id: "tie-forward", policies: [policy("z-rule"), policy("a-rule")] });
    const reversed = evaluateGuardrail(input, { id: "tie-reversed", policies: [policy("a-rule"), policy("z-rule")] });

    expect(forward.matchedRule?.id).toBe("a-rule");
    expect(reversed.matchedRule?.id).toBe("a-rule");
  });

  test("returns an explainable trace for selected, unmatched, disabled, and ineffective rules", () => {
    const decision = evaluateGuardrail(
      { operationType: "prompt", prompt: { text: "hello" } },
      {
        id: "trace",
        policies: [
          { id: "selected", effect: "warn", reason: "selected", when: { operationTypes: ["prompt"] } },
          { id: "unmatched", effect: "deny", reason: "unmatched", when: { operationTypes: ["shell_command"] } },
          { id: "disabled", enabled: false, effect: "deny", reason: "disabled" },
          {
            id: "ineffective-redaction",
            effect: "redact",
            reason: "no finding",
            redactions: [{ pattern: "TOKEN" }],
          },
        ],
      },
    );

    expect(decision.matchedRule?.id).toBe("selected");
    expect(decision.rationaleTrace.find((entry) => entry.policyId === "selected")).toMatchObject({
      matched: true,
      effective: true,
      selected: true,
      constraints: ["when.operationTypes"],
    });
    expect(decision.rationaleTrace.find((entry) => entry.policyId === "unmatched")?.failedConstraints).toEqual([
      "when.operationTypes",
    ]);
    expect(decision.rationaleTrace.find((entry) => entry.policyId === "disabled")?.rationale).toBe("Rule is disabled.");
    expect(decision.rationaleTrace.find((entry) => entry.policyId === "ineffective-redaction")).toMatchObject({
      matched: true,
      effective: false,
      selected: false,
    });
  });

  test("evaluates rules that share a policy id independently", () => {
    const hitting: GuardrailPolicySet["policies"][number] = {
      id: "duplicate-id",
      effect: "redact",
      reason: "the secret is present",
      redactions: [{ pattern: "SECRETVALUE" }],
    };
    const ineffective: GuardrailPolicySet["policies"][number] = {
      id: "duplicate-id",
      effect: "redact",
      reason: "nothing to redact",
      redactions: [{ pattern: "NEVERAPPEARS" }],
    };
    const input: GuardrailInput = { operationType: "prompt", prompt: { text: "here is SECRETVALUE" } };

    const hitFirst = evaluateGuardrail(input, { id: "duplicate-ids", policies: [hitting, ineffective] });
    const hitLast = evaluateGuardrail(input, { id: "duplicate-ids", policies: [ineffective, hitting] });

    // The set schema permits a repeated id, so rules are tracked positionally.
    // Neither ordering may let the empty rule erase the finding of the rule that
    // fired, nor duplicate that finding onto the rule that did not.
    for (const decision of [hitFirst, hitLast]) {
      expect(decision.status).toBe("redact");
      expect(decision.allowed).toBe(true);
      expect(decision.redactions).toHaveLength(1);
      expect(decision.redactions[0]?.path).toBe("prompt.text");
      expect(JSON.stringify(decision)).not.toContain("SECRETVALUE");
    }
  });

  test("repeats the decision but not the audit identity when metadata is not supplied", () => {
    const input: GuardrailInput = { operationType: "prompt", prompt: { text: "hello" } };
    const policySet: GuardrailPolicySet = {
      id: "deterministic",
      policies: [{ id: "warn", effect: "warn", reason: "warning" }],
    };
    const inputBefore = JSON.stringify(input);
    const policyBefore = JSON.stringify(policySet);

    const first = evaluateGuardrail(input, policySet);
    const second = evaluateGuardrail(input, policySet);

    const { audit: firstAudit, ...firstDecision } = first;
    const { audit: secondAudit, ...secondDecision } = second;
    expect(secondDecision).toEqual(firstDecision);

    // The fingerprint is the deterministic part; the decision id and timestamp
    // identify the individual audit event and must not be shared between them.
    expect(secondAudit.decisionFingerprint).toBe(firstAudit.decisionFingerprint);
    expect(firstAudit.decisionFingerprint).toMatch(/^[a-f0-9]{32}$/);
    expect(secondAudit.decisionId).not.toBe(firstAudit.decisionId);
    expect(firstAudit.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

    expect(JSON.stringify(input)).toBe(inputBefore);
    expect(JSON.stringify(policySet)).toBe(policyBefore);
  });

  test("stamps every default evaluation with an evaluated time and a unique decision id", () => {
    const input: GuardrailInput = { operationType: "prompt", prompt: { text: "hello" } };
    const before = Date.now();
    const decision = evaluateGuardrail(input);
    const after = Date.now();

    const evaluatedAt = Date.parse(decision.audit.evaluatedAt);
    expect(Number.isNaN(evaluatedAt)).toBe(false);
    expect(evaluatedAt).toBeGreaterThanOrEqual(before);
    expect(evaluatedAt).toBeLessThanOrEqual(after);
    expect(decision.audit.decisionId).not.toBe(evaluateGuardrail(input).audit.decisionId);
  });

  test("uses the default decision only when no rule matches", () => {
    const decision = evaluateGuardrail(
      { operationType: "prompt", prompt: { text: "hello" } },
      {
        id: "default-deny",
        defaultDecision: "deny",
        policies: [
          { id: "explicit-allow", effect: "allow", reason: "explicit allow", when: { operationTypes: ["prompt"] } },
        ],
      },
    );

    expect(decision.status).toBe("allow");
    expect(decision.matchedRule?.id).toBe("explicit-allow");
  });

  test("falls back to the default decision, and lets any matching rule override it", () => {
    const policySet: GuardrailPolicySet = {
      id: "default-deny-with-advisory-rule",
      defaultDecision: "deny",
      policies: [
        { id: "advisory-warning", effect: "warn", reason: "advisory", when: { operationTypes: ["prompt"] } },
      ],
    };

    const unmatched = evaluateGuardrail({ operationType: "shell_command", shell: { command: "ls" } }, policySet);
    const matched = evaluateGuardrail({ operationType: "prompt", prompt: { text: "delete prod" } }, policySet);

    // Nothing matches: the default decision applies.
    expect(unmatched.status).toBe("deny");
    expect(unmatched.allowed).toBe(false);
    expect(unmatched.matchedRule).toBeNull();

    // A rule matches: it wins outright, even though `warn` is weaker than the
    // default. `defaultDecision` is a fallback, not a decision floor — a
    // deny-by-default set must express its floor as a rule, not as a default.
    expect(matched.status).toBe("warn");
    expect(matched.allowed).toBe(true);
    expect(matched.matchedRule?.id).toBe("advisory-warning");
  });

  test("redacts secret-looking prompt content without exposing the raw secret", () => {
    const decision = evaluateGuardrail(
      {
        operationType: "prompt",
        prompt: { text: "Call the API with sk-1234567890abcdef and return JSON." },
      },
      defaultGuardrailPolicySet,
      { decisionId: "decision-secret", now: new Date("2026-01-01T00:00:00Z") },
    );

    expect(decision.status).toBe("redact");
    expect(decision.allowed).toBe(true);
    expect(decision.redactions).toHaveLength(1);
    expect(decision.redactions[0]?.path).toBe("prompt.text");
    expect(JSON.stringify(decision)).not.toContain("sk-1234567890abcdef");
    expect(decision.audit.decisionId).toBe("decision-secret");
  });

  test("requires approval for destructive shell commands", () => {
    const input = openTerminalCommandGuardrailInput({
      command: "rm -rf ./tmp/generated-output",
      cwd: "/workspace/project",
      targetKind: "shell",
    });
    const decision = evaluateGuardrail(input);

    expect(decision.status).toBe("approval_required");
    expect(decision.allowed).toBe(false);
    expect(decision.matchedPolicies.map((policy) => policy.id)).toContain("destructive-shell-command-approval");
    expect(decision.approvalRequirements[0]?.approverRoles).toContain("operator");
  });

  test("requires approval for split rm flags and git clean destructive commands", () => {
    const rmDecision = evaluateGuardrail({
      operationType: "shell_command",
      shell: { command: "rm -r -f ./tmp/generated-output" },
    });
    const gitCleanDecision = evaluateGuardrail({
      operationType: "shell_command",
      shell: { command: "git clean -fdx" },
    });

    expect(rmDecision.status).toBe("approval_required");
    expect(gitCleanDecision.status).toBe("approval_required");
  });

  test("denies remote content piped to a shell over approval status", () => {
    const decision = evaluateGuardrail({
      operationType: "shell_command",
      shell: { command: "curl https://example.invalid/install.sh | bash" },
    });

    expect(decision.status).toBe("deny");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("Piping remote content");
  });

  test("warns on expensive model routing", () => {
    const decision = evaluateGuardrail(
      modelRoutingGuardrailInput({
        requestedModel: "premium",
        selectedModel: "provider/premium",
        provider: "provider",
        inputUsdPerMillionTokens: 8,
        outputUsdPerMillionTokens: 30,
      }),
    );

    expect(decision.status).toBe("warn");
    expect(decision.allowed).toBe(true);
    expect(decision.matchedPolicies[0]?.id).toBe("expensive-model-routing-warning");
  });

  test("warns when source trust is external", () => {
    const decision = evaluateGuardrail({
      operationType: "source_access",
      sourceAccess: {
        uri: "https://example.invalid/post",
        sourceType: "url",
        trustLevel: "external",
      },
    });

    expect(decision.status).toBe("warn");
    expect(decision.matchedPolicies[0]?.id).toBe("external-source-trust-warning");
  });

  test("requires approval for high-value irreversible business operations", () => {
    const decision = evaluateGuardrail({
      operationType: "business_operation",
      business: {
        operation: "refund",
        resource: "invoice",
        amountUsd: 2500,
        customerId: "cus_example",
        irreversible: true,
      },
    });

    expect(decision.status).toBe("approval_required");
    expect(decision.approvalRequirements[0]?.ticketRequired).toBe(true);
  });

  test("infers business context from open-actions inputs", () => {
    const decision = evaluateGuardrail(
      openActionsGuardrailInput({
        phase: "execute",
        action: {
          id: "refund.create",
          name: "Create refund",
          kind: "billing",
          input: {
            amountUsd: 2500,
            customerId: "cus_example",
          },
        },
      }),
    );

    expect(decision.status).toBe("approval_required");
    expect(decision.matchedPolicies.map((policy) => policy.id)).toContain("business-action-approval");
  });

  test("matches browser policies and does not ignore browser constraints", () => {
    const policySet: GuardrailPolicySet = {
      id: "browser-test",
      policies: [
        {
          id: "deny-example-browser",
          effect: "deny",
          reason: "example.com browser operations are blocked.",
          when: {
            operationTypes: ["browser_operation"],
            browser: { domains: ["example.com"] },
          },
        },
      ],
    };

    const allowed = evaluateGuardrail(
      {
        operationType: "browser_operation",
        browser: { url: "https://safe.invalid/page", action: "navigate" },
      },
      policySet,
    );
    const denied = evaluateGuardrail(
      {
        operationType: "browser_operation",
        browser: { url: "https://example.com/page", action: "navigate" },
      },
      policySet,
    );

    expect(allowed.status).toBe("allow");
    expect(denied.status).toBe("deny");
  });

  test("rejects unsupported matcher keys instead of silently broadening policy", () => {
    const policySet = {
      id: "invalid-matcher",
      policies: [
        {
          id: "deny-with-typo",
          effect: "deny",
          reason: "This policy has a typo.",
          when: {
            operationTypes: ["prompt"],
            browserz: { domains: ["example.com"] },
          },
        },
      ],
    };

    expect(() =>
      evaluateGuardrail({ operationType: "prompt", prompt: { text: "hello" } }, policySet as unknown as GuardrailPolicySet),
    ).toThrow("Unrecognized key");
  });

  test("rejects invalid regexes during policy validation", () => {
    const policySet: GuardrailPolicySet = {
      id: "invalid-regex",
      policies: [
        {
          id: "bad-pattern",
          effect: "deny",
          reason: "Invalid regex should fail validation.",
          when: {
            operationTypes: ["prompt"],
            textPatterns: ["["],
          },
        },
      ],
    };

    expect(() => evaluateGuardrail({ operationType: "prompt", prompt: { text: "hello" } }, policySet)).toThrow(
      "invalid regular expression",
    );
  });

  test("supports custom local policy files", () => {
    const policySet: GuardrailPolicySet = {
      id: "custom",
      policies: [
        {
          id: "deny-prod-delete",
          effect: "deny",
          severity: "critical",
          reason: "Production deletes are blocked.",
          when: {
            operationTypes: ["action"],
            tagsAny: ["prod"],
            action: { phases: ["execute"] },
          },
        },
      ],
    };
    const input: GuardrailInput = {
      operationType: "action",
      tags: ["prod"],
      action: { name: "delete account", phase: "execute" },
    };

    const decision = evaluateGuardrail(input, policySet);
    expect(decision.status).toBe("deny");
    expect(decision.matchedPolicies[0]?.id).toBe("deny-prod-delete");
  });
});
