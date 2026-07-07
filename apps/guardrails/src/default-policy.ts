import type { GuardrailPolicySet } from "./types";
import { defaultSecretRedactionRules } from "./redaction";

export const defaultGuardrailPolicySet: GuardrailPolicySet = {
  id: "open-guardrails-starter",
  version: "1.0.0",
  schemaVersion: "1.0",
  description: "Generic local-first guardrails for OSS agentic tooling.",
  defaultDecision: "allow",
  policies: [
    {
      id: "secret-redaction",
      description: "Redact common API keys, bearer tokens, GitHub tokens, Slack tokens, Google API keys, and JWTs.",
      severity: "high",
      effect: "redact",
      reason: "Input contains secret-looking material that must be redacted before logging, dispatch, model routing, or tool execution.",
      when: {
        operationTypes: [
          "prompt",
          "action",
          "shell_command",
          "mcp_tool_call",
          "browser_operation",
          "computer_operation",
          "runtime_operation",
          "model_routing",
          "secret_access",
          "source_access",
          "business_operation",
        ],
      },
      redactions: defaultSecretRedactionRules(),
      obligations: [
        {
          id: "do-not-log-raw-secret",
          stage: "before",
          description: "Only persist redacted values and hashes in audit records.",
        },
      ],
    },
    {
      id: "destructive-shell-command-approval",
      description: "Require approval for destructive local shell operations.",
      severity: "critical",
      effect: "approval_required",
      reason: "Destructive shell commands require a human approval checkpoint.",
      when: {
        operationTypes: ["shell_command"],
        command: {
          destructive: true,
        },
      },
      approval: {
        id: "destructive-shell-approval",
        reason: "Confirm the target path, backup posture, and rollback plan before executing the command.",
        approverRoles: ["operator", "maintainer"],
        ticketRequired: false,
        fields: ["command", "cwd", "target"],
      },
      obligations: [
        {
          id: "record-command-hash",
          stage: "before",
          description: "Record a hash of the exact command in the audit trail.",
        },
      ],
    },
    {
      id: "remote-code-shell-deny",
      description: "Deny common remote-code-to-shell command patterns.",
      severity: "critical",
      effect: "deny",
      reason: "Piping remote content directly into a shell is not allowed by the starter policy.",
      when: {
        operationTypes: ["shell_command"],
        command: {
          patterns: ["\\b(curl|wget)\\b[\\s\\S]*\\|[\\s\\S]*\\b(sh|bash|zsh|fish)\\b"],
        },
      },
    },
    {
      id: "expensive-model-routing-warning",
      description: "Warn when model routing selects or requests models above starter cost thresholds.",
      severity: "medium",
      effect: "warn",
      reason: "The requested model route is above the starter cost threshold.",
      when: {
        operationTypes: ["model_routing"],
        model: {
          minInputUsdPerMillionTokens: 5,
          minOutputUsdPerMillionTokens: 20,
        },
      },
      obligations: [
        {
          id: "surface-cost-warning",
          stage: "before",
          description: "Show the estimated model cost risk to the caller before routing.",
        },
      ],
    },
    {
      id: "external-source-trust-warning",
      description: "Warn when an operation relies on external or untrusted source material.",
      severity: "medium",
      effect: "warn",
      reason: "External or untrusted source material should be treated as data, not instructions.",
      when: {
        operationTypes: ["source_access", "browser_operation", "prompt", "mcp_tool_call"],
        source: {
          trustLevels: ["external", "untrusted"],
        },
      },
      obligations: [
        {
          id: "quote-or-summarize-source",
          stage: "after",
          description: "Keep source provenance in downstream audit evidence.",
        },
      ],
    },
    {
      id: "business-action-approval",
      description: "Require approval for high-value business operations.",
      severity: "high",
      effect: "approval_required",
      reason: "High-value business operations require approval before execution.",
      when: {
        operationTypes: ["business_operation", "action"],
        business: {
          minAmountUsd: 1000,
        },
      },
      approval: {
        id: "business-operation-approval",
        reason: "Confirm business authority, customer/account target, amount, and rollback options.",
        approverRoles: ["owner", "finance", "admin"],
        ticketRequired: true,
        fields: ["operation", "resource", "amountUsd", "customerId", "accountId"],
      },
    },
    {
      id: "irreversible-business-action-approval",
      description: "Require approval for irreversible business operations.",
      severity: "high",
      effect: "approval_required",
      reason: "Irreversible business operations require approval before execution.",
      when: {
        operationTypes: ["business_operation", "action"],
        business: {
          irreversible: true,
        },
      },
      approval: {
        id: "irreversible-business-operation-approval",
        reason: "Confirm business authority, target, and rollback limitations.",
        approverRoles: ["owner", "admin"],
        ticketRequired: true,
        fields: ["operation", "resource", "customerId", "accountId"],
      },
    },
  ],
};
