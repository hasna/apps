import { describe, expect, test } from "bun:test";
import { evaluateGuardrail, evaluateGuardrailWithDefaultPolicy } from "../src";
import type { GuardrailDecisionStatus, GuardrailInput, GuardrailPolicy, GuardrailPolicySet } from "../src";

function policySet(policies: GuardrailPolicy[], defaultDecision?: GuardrailDecisionStatus): GuardrailPolicySet {
  return {
    id: "test-policy-set",
    version: "test-version",
    ...(defaultDecision ? { defaultDecision } : {}),
    policies,
  };
}

function policy(id: string, effect: GuardrailDecisionStatus, overrides: Partial<GuardrailPolicy> = {}): GuardrailPolicy {
  return { id, effect, reason: `${id} reason`, ...overrides };
}

describe("engine precedence and decision metadata", () => {
  test("uses deny > approval > redact > warn > allow precedence", () => {
    const input: GuardrailInput = {
      id: "input-id",
      operationType: "prompt",
      subject: "precedence",
      actor: { id: "actor-id" },
      session: { traceId: "trace-id" },
      tags: ["existing", "existing"],
      prompt: { text: "PLACEHOLDER_SECRET_VALUE" },
    };
    const policies = [
      policy("allow-rule", "allow"),
      policy("warn-rule", "warn"),
      policy("redact-rule", "redact", {
        redactions: [{ pattern: "PLACEHOLDER_SECRET_VALUE", replacement: "[placeholder-redacted]" }],
      }),
      policy("approval-rule", "approval_required"),
      policy("deny-rule", "deny"),
    ];

    const expected: Array<[number, GuardrailDecisionStatus]> = [
      [1, "allow"],
      [2, "warn"],
      [3, "redact"],
      [4, "approval_required"],
      [5, "deny"],
    ];
    for (const [count, status] of expected) {
      expect(evaluateGuardrail(input, policySet(policies.slice(0, count))).status).toBe(status);
    }
    const strongestFirstPairs: Array<[GuardrailPolicy, GuardrailPolicy, GuardrailDecisionStatus]> = [
      [policies[1]!, policies[0]!, "warn"],
      [policies[2]!, policies[1]!, "redact"],
      [policies[3]!, policies[2]!, "approval_required"],
      [policies[4]!, policies[3]!, "deny"],
    ];
    for (const [stronger, weaker, status] of strongestFirstPairs) {
      expect(evaluateGuardrail(input, policySet([stronger, weaker])).status).toBe(status);
    }

    const decision = evaluateGuardrail(input, policySet(policies), {
      decisionId: "decision-id",
      engineVersion: "test-engine",
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(decision.reason).toBe("deny-rule reason");
    expect(decision.audit).toEqual({
      decisionId: "decision-id",
      evaluatedAt: "2026-07-01T00:00:00.000Z",
      engineVersion: "test-engine",
      policySetId: "test-policy-set",
      policySetVersion: "test-version",
      inputId: "input-id",
      operationType: "prompt",
      subject: "precedence",
      actorId: "actor-id",
      traceId: "trace-id",
      labels: ["existing", "allow-rule", "warn-rule", "redact-rule", "approval-rule", "deny-rule"],
    });
  });

  test("uses each default decision and its corresponding default reason", () => {
    const cases: Array<[GuardrailDecisionStatus, boolean, string]> = [
      ["allow", true, "No guardrail policies matched."],
      ["warn", true, "One or more guardrail policies produced warnings."],
      ["redact", true, "One or more guardrail policies require redaction."],
      ["approval_required", false, "One or more guardrail policies require approval."],
      ["deny", false, "One or more guardrail policies denied the operation."],
    ];

    for (const [status, allowed, reason] of cases) {
      const decision = evaluateGuardrail({ operationType: "prompt" }, policySet([], status));
      expect([decision.status, decision.allowed, decision.reason]).toEqual([status, allowed, reason]);
    }
  });

  test("keeps meaningful policy details, evidence, obligations, and synthesized approvals", () => {
    const decision = evaluateGuardrail(
      { operationType: "action", action: { name: "preview", phase: "preview" } },
      policySet([
        policy("approval", "approval_required", {
          evidence: ["first signal", "second signal"],
          obligations: [{ id: "record", description: "Record the placeholder operation." }],
        }),
      ]),
    );

    expect(decision.matchedPolicies).toEqual([
      { id: "approval", effect: "approval_required", reason: "approval reason", severity: "medium" },
    ]);
    expect(decision.evidence).toEqual([
      { policyId: "approval", message: "first signal" },
      { policyId: "approval", message: "second signal" },
    ]);
    expect(decision.obligations).toHaveLength(1);
    expect(decision.approvalRequirements).toEqual([{ id: "approval-approval", reason: "approval reason" }]);
  });

  test("drops a redact rule when its pattern does not occur", () => {
    const decision = evaluateGuardrail(
      { operationType: "prompt", prompt: { text: "ordinary placeholder text" } },
      policySet([
        policy("conditional-redaction", "redact", {
          description: "Only effective when a match exists.",
          redactions: [{ id: "placeholder", pattern: "PLACEHOLDER_SECRET" }],
        }),
      ]),
    );

    expect(decision.status).toBe("allow");
    expect(decision.matchedPolicies).toEqual([]);
  });

  test("default-policy convenience wrapper returns a generated audit identity", () => {
    const decision = evaluateGuardrailWithDefaultPolicy({ operationType: "prompt", prompt: { text: "hello" } });
    expect(decision.status).toBe("allow");
    expect(decision.audit.decisionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(decision.audit.evaluatedAt))).toBe(false);
  });
});

describe("policy matcher coverage", () => {
  test("matches text, tags, and actor roles case-insensitively", () => {
    const rule = policy("text", "deny", {
      when: {
        operationTypes: ["prompt"],
        tagsAny: ["PROD"],
        actorRolesAny: ["ADMIN"],
        textIncludes: ["PLACEHOLDER"],
        textPatterns: ["value$"],
      },
    });
    const matching: GuardrailInput = {
      operationType: "prompt",
      tags: ["prod"],
      actor: { roles: ["admin"] },
      prompt: { text: "placeholder value" },
    };

    expect(evaluateGuardrail(matching, policySet([rule])).status).toBe("deny");
    expect(evaluateGuardrail({ ...matching, prompt: { text: "different" } }, policySet([rule])).status).toBe("allow");
    expect(evaluateGuardrail({ ...matching, tags: [] }, policySet([rule])).status).toBe("allow");
    expect(evaluateGuardrail({ ...matching, actor: {} }, policySet([rule])).status).toBe("allow");
  });

  test("matches command name, content, regex, and destructive classification", () => {
    const rule = policy("command", "warn", {
      when: {
        operationTypes: ["shell_command"],
        command: { names: ["bash"], includes: ["placeholder"], patterns: ["--safe$"], destructive: false },
      },
    });
    const matching: GuardrailInput = {
      operationType: "shell_command",
      shell: { command: "/usr/bin/bash run-placeholder --safe" },
    };

    expect(evaluateGuardrail(matching, policySet([rule])).status).toBe("warn");
    expect(
      evaluateGuardrail({ operationType: "prompt", prompt: { text: "placeholder" } }, policySet([
        policy("missing-command", "deny", { when: { command: { includes: ["placeholder"] } } }),
      ])).status,
    ).toBe("allow");
  });

  test("recognizes the starter destructive-command rule pack", () => {
    const destructiveCommands = [
      "rm -rf ./placeholder-output",
      "mkfs.ext4 /dev/placeholder-device",
      "dd if=/dev/zero of=/dev/placeholder-device",
      "git reset --hard HEAD~1",
      "git clean -fdx",
      "shutdown now",
      "pkill placeholder-process",
      ":(){ :|:& };:",
    ];
    for (const command of destructiveCommands) {
      expect(evaluateGuardrail({ operationType: "shell_command", shell: { command } }).status).toBe(
        "approval_required",
      );
    }
    expect(
      evaluateGuardrail({ operationType: "shell_command", shell: { command: "rm ./placeholder-output" } }).status,
    ).toBe("allow");
  });

  test("matches full model routing constraints and rejects values below thresholds", () => {
    const rule = policy("model", "deny", {
      when: {
        model: {
          providers: ["placeholder-provider"],
          models: ["placeholder-model"],
          minInputUsdPerMillionTokens: 2,
          minOutputUsdPerMillionTokens: 4,
          allowTraining: false,
          allowLogging: false,
          zeroDataRetentionRequired: true,
        },
      },
    });
    const input: GuardrailInput = {
      operationType: "model_routing",
      modelRouting: {
        requestedModel: "placeholder-model",
        provider: "placeholder-provider",
        inputUsdPerMillionTokens: 2,
        outputUsdPerMillionTokens: 4,
        allowTraining: false,
        allowLogging: false,
        zeroDataRetentionRequired: true,
      },
    };

    expect(evaluateGuardrail(input, policySet([rule])).status).toBe("deny");
    expect(
      evaluateGuardrail(
        { ...input, modelRouting: { ...input.modelRouting, inputUsdPerMillionTokens: 1 } },
        policySet([rule]),
      ).status,
    ).toBe("allow");
    expect(
      evaluateGuardrail(
        { ...input, modelRouting: { ...input.modelRouting, outputUsdPerMillionTokens: 3 } },
        policySet([rule]),
      ).status,
    ).toBe("allow");
    expect(
      evaluateGuardrail(
        { ...input, modelRouting: { ...input.modelRouting, zeroDataRetentionRequired: false } },
        policySet([rule]),
      ).status,
    ).toBe("allow");
  });

  test("matches source constraints and safely rejects malformed URLs", () => {
    const rule = policy("source", "warn", {
      when: {
        source: {
          trustLevels: ["external"],
          uriPatterns: ["/placeholder"],
          domains: ["example.invalid"],
        },
      },
    });
    const matching: GuardrailInput = {
      operationType: "source_access",
      sourceAccess: { trustLevel: "external", uri: "https://example.invalid/placeholder" },
    };

    expect(evaluateGuardrail(matching, policySet([rule])).status).toBe("warn");
    expect(
      evaluateGuardrail(
        { operationType: "source_access", sourceAccess: { trustLevel: "external", uri: "not a valid URL" } },
        policySet([policy("domain", "deny", { when: { source: { domains: ["example.invalid"] } } })]),
      ).status,
    ).toBe("allow");
  });

  test("matches business, action, secret, runtime, browser, and computer rules", () => {
    const cases: Array<[GuardrailInput, GuardrailPolicy]> = [
      [
        {
          operationType: "business_operation",
          business: { operation: "refund", resource: "invoice", amountUsd: 50, irreversible: false },
        },
        policy("business", "deny", {
          when: { business: { operations: ["refund"], resources: ["invoice"], minAmountUsd: 50, irreversible: false } },
        }),
      ],
      [
        { operationType: "action", action: { id: "action-id", name: "action-name", kind: "test", phase: "execute" } },
        policy("action", "deny", {
          when: { action: { ids: ["action-id"], names: ["action-name"], kinds: ["test"], phases: ["execute"] } },
        }),
      ],
      [
        {
          operationType: "secret_access",
          secretAccess: { secretName: "PLACEHOLDER_SECRET", action: "read", classification: "secret" },
        },
        policy("secret", "deny", {
          when: { secret: { names: ["PLACEHOLDER_SECRET"], actions: ["read"], classifications: ["secret"] } },
        }),
      ],
      [
        {
          operationType: "runtime_operation",
          runtime: {
            kind: "file",
            action: "write",
            path: "/tmp/placeholder.txt",
            host: "localhost",
            packageName: "placeholder-package",
          },
        },
        policy("runtime", "deny", {
          when: {
            runtime: {
              kinds: ["file"],
              actions: ["write"],
              pathPatterns: ["placeholder\\.txt$"],
              hosts: ["localhost"],
              packageNames: ["placeholder-package"],
            },
          },
        }),
      ],
      [
        {
          operationType: "browser_operation",
          browser: {
            url: "https://example.invalid/placeholder",
            action: "submit",
            method: "POST",
            externalSource: true,
            userGesture: true,
          },
        },
        policy("browser", "deny", {
          when: {
            browser: {
              domains: ["example.invalid"],
              urlPatterns: ["/placeholder$"],
              actions: ["submit"],
              methods: ["post"],
              externalSource: true,
              userGesture: true,
            },
          },
        }),
      ],
      [
        {
          operationType: "computer_operation",
          computer: { app: "placeholder-app", action: "click", target: "placeholder-button", requiresUserVisibleChange: true },
        },
        policy("computer", "deny", {
          when: {
            computer: {
              apps: ["placeholder-app"],
              actions: ["click"],
              targets: ["placeholder-button"],
              requiresUserVisibleChange: true,
            },
          },
        }),
      ],
    ];

    for (const [input, rule] of cases) {
      expect(evaluateGuardrail(input, policySet([rule])).status).toBe("deny");
      expect(evaluateGuardrail({ operationType: input.operationType }, policySet([rule])).status).toBe("allow");
    }
    const computerRule = cases.at(-1)?.[1];
    expect(computerRule).toBeDefined();
    expect(
      evaluateGuardrail(
        {
          operationType: "computer_operation",
          computer: {
            app: "placeholder-app",
            action: "click",
            target: "placeholder-button",
            requiresUserVisibleChange: false,
          },
        },
        policySet([computerRule!]),
      ).status,
    ).toBe("allow");
  });

  test("evaluates an MCP tool call against server, tool, and transport rules", () => {
    const mcpRule = policy("mcp-evaluate-tool", "approval_required", {
      when: {
        operationTypes: ["mcp_tool_call"],
        mcp: {
          serverIds: ["placeholder-server"],
          toolNames: ["evaluate"],
          transports: ["stdio"],
        },
      },
      approval: { id: "mcp-approval", approverRoles: ["operator"] },
    });
    const input: GuardrailInput = {
      operationType: "mcp_tool_call",
      mcp: { serverId: "placeholder-server", toolName: "evaluate", transport: "stdio", arguments: { dryRun: true } },
    };

    const decision = evaluateGuardrail(input, policySet([mcpRule]));
    expect(decision.status).toBe("approval_required");
    expect(decision.approvalRequirements).toEqual([{ id: "mcp-approval", approverRoles: ["operator"] }]);
    expect(
      evaluateGuardrail({ operationType: "mcp_tool_call", mcp: { toolName: "other" } }, policySet([mcpRule])).status,
    ).toBe("allow");
  });

  test("ignores disabled and operation-mismatched policies", () => {
    const input: GuardrailInput = { operationType: "prompt", prompt: { text: "placeholder" } };
    const decision = evaluateGuardrail(
      input,
      policySet([
        policy("disabled", "deny", { enabled: false }),
        policy("wrong-operation", "deny", { when: { operationTypes: ["action"] } }),
      ]),
    );
    expect(decision.status).toBe("allow");
  });
});
