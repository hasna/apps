import { randomUUID } from "node:crypto";
import { defaultGuardrailPolicySet } from "./default-policy";
import { collectSearchText, detectRedactions } from "./redaction";
import { parseGuardrailInput, parseGuardrailPolicySet } from "./schemas";
import type {
  EvaluateGuardrailOptions,
  GuardrailDecision,
  GuardrailDecisionStatus,
  GuardrailEvidence,
  GuardrailInput,
  GuardrailPolicy,
  GuardrailPolicyMatcher,
  GuardrailPolicySet,
  GuardrailSeverity,
} from "./types";
import { guardrailsVersion } from "./version";

const STATUS_PRECEDENCE: Record<GuardrailDecisionStatus, number> = {
  allow: 0,
  warn: 1,
  redact: 2,
  approval_required: 3,
  deny: 4,
};

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\b(?=[^\n\r;&|]*\s-[^\n\r;&|]*[rR])(?=[^\n\r;&|]*\s-[^\n\r;&|]*[fF])/,
  /\bmkfs(?:\.[\w-]+)?\b/,
  /\bdd\s+.*\bof=\/dev\//,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\b(?=[^\n\r;&|]*\s-[^\n\r;&|]*[fF])(?=[^\n\r;&|]*\s-[^\n\r;&|]*[dDxX])/,
  /\b(?:shutdown|reboot|halt|poweroff)\b/,
  /\b(?:killall|pkill)\b/,
  /:\s*\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
];

function includesAny(actual: string[] | undefined, expected: string[] | undefined): boolean {
  if (!expected?.length) return true;
  if (!actual?.length) return false;
  const actualSet = new Set(actual.map((value) => value.toLowerCase()));
  return expected.some((value) => actualSet.has(value.toLowerCase()));
}

function stringMatchesAny(actual: string | undefined, expected: string[] | undefined): boolean {
  if (!expected?.length) return true;
  if (!actual) return false;
  return expected.some((value) => value.toLowerCase() === actual.toLowerCase());
}

function regexMatchesAny(actual: string | undefined, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return true;
  if (!actual) return false;
  return patterns.some((pattern) => new RegExp(pattern, "iu").test(actual));
}

function commandName(command: string | undefined): string | undefined {
  if (!command) return undefined;
  const first = command.trim().split(/\s+/)[0];
  return first?.split(/[\\/]/).pop()?.toLowerCase();
}

function isDestructiveCommand(command: string | undefined): boolean {
  if (!command) return false;
  return DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

function hostnameFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname;
  } catch {
    return undefined;
  }
}

function textMatcher(input: GuardrailInput, matcher: GuardrailPolicyMatcher): boolean {
  const text = collectSearchText(input);
  if (matcher.textIncludes?.length) {
    const lower = text.toLowerCase();
    if (!matcher.textIncludes.some((needle) => lower.includes(needle.toLowerCase()))) return false;
  }
  if (matcher.textPatterns?.length && !regexMatchesAny(text, matcher.textPatterns)) return false;
  return true;
}

function commandMatcher(input: GuardrailInput, matcher: GuardrailPolicyMatcher): boolean {
  const command = input.shell?.command;
  const rule = matcher.command;
  if (!rule) return true;
  if (!stringMatchesAny(commandName(command), rule.names)) return false;
  if (rule.includes?.length) {
    const lower = command?.toLowerCase() ?? "";
    if (!rule.includes.some((part) => lower.includes(part.toLowerCase()))) return false;
  }
  if (!regexMatchesAny(command, rule.patterns)) return false;
  if (rule.destructive !== undefined && isDestructiveCommand(command) !== rule.destructive) return false;
  return true;
}

function modelMatcher(input: GuardrailInput, matcher: GuardrailPolicyMatcher): boolean {
  const rule = matcher.model;
  if (!rule) return true;
  const model = input.modelRouting;
  if (!model) return false;
  if (!stringMatchesAny(model.provider, rule.providers)) return false;
  const selectedModel = model.selectedModel ?? model.requestedModel;
  if (!stringMatchesAny(selectedModel, rule.models)) return false;
  if (
    rule.minInputUsdPerMillionTokens !== undefined &&
    (model.inputUsdPerMillionTokens ?? 0) < rule.minInputUsdPerMillionTokens
  ) {
    return false;
  }
  if (
    rule.minOutputUsdPerMillionTokens !== undefined &&
    (model.outputUsdPerMillionTokens ?? 0) < rule.minOutputUsdPerMillionTokens
  ) {
    return false;
  }
  if (rule.allowTraining !== undefined && model.allowTraining !== rule.allowTraining) return false;
  if (rule.allowLogging !== undefined && model.allowLogging !== rule.allowLogging) return false;
  if (rule.zeroDataRetentionRequired !== undefined && model.zeroDataRetentionRequired !== rule.zeroDataRetentionRequired) {
    return false;
  }
  return true;
}

function sourceMatcher(input: GuardrailInput, matcher: GuardrailPolicyMatcher): boolean {
  const rule = matcher.source;
  if (!rule) return true;
  const trustLevel = input.sourceAccess?.trustLevel ?? (input.browser?.externalSource ? "external" : undefined);
  const uri = input.sourceAccess?.uri ?? input.browser?.url;
  const domain = input.browser?.domain ?? hostnameFromUrl(uri);
  if (!stringMatchesAny(trustLevel, rule.trustLevels)) return false;
  if (!regexMatchesAny(uri, rule.uriPatterns)) return false;
  if (!stringMatchesAny(domain, rule.domains)) return false;
  return true;
}

function businessMatcher(input: GuardrailInput, matcher: GuardrailPolicyMatcher): boolean {
  const rule = matcher.business;
  if (!rule) return true;
  const business = input.business;
  if (!business) return false;
  if (!stringMatchesAny(business.operation, rule.operations)) return false;
  if (!stringMatchesAny(business.resource, rule.resources)) return false;
  if (rule.minAmountUsd !== undefined && (business.amountUsd ?? 0) < rule.minAmountUsd) return false;
  if (rule.irreversible !== undefined && business.irreversible !== rule.irreversible) return false;
  return true;
}

function mcpMatcher(input: GuardrailInput, matcher: GuardrailPolicyMatcher): boolean {
  const rule = matcher.mcp;
  if (!rule) return true;
  const mcp = input.mcp;
  if (!mcp) return false;
  if (!stringMatchesAny(mcp.serverId, rule.serverIds)) return false;
  if (!stringMatchesAny(mcp.toolName, rule.toolNames)) return false;
  if (!stringMatchesAny(mcp.transport, rule.transports)) return false;
  return true;
}

function actionMatcher(input: GuardrailInput, matcher: GuardrailPolicyMatcher): boolean {
  const rule = matcher.action;
  if (!rule) return true;
  const action = input.action;
  if (!action) return false;
  if (!stringMatchesAny(action.id, rule.ids)) return false;
  if (!stringMatchesAny(action.name, rule.names)) return false;
  if (!stringMatchesAny(action.kind, rule.kinds)) return false;
  if (!stringMatchesAny(action.phase, rule.phases)) return false;
  return true;
}

function secretMatcher(input: GuardrailInput, matcher: GuardrailPolicyMatcher): boolean {
  const rule = matcher.secret;
  if (!rule) return true;
  const secret = input.secretAccess;
  if (!secret) return false;
  if (!stringMatchesAny(secret.secretName, rule.names)) return false;
  if (!stringMatchesAny(secret.action, rule.actions)) return false;
  if (!stringMatchesAny(secret.classification, rule.classifications)) return false;
  return true;
}

function runtimeMatcher(input: GuardrailInput, matcher: GuardrailPolicyMatcher): boolean {
  const rule = matcher.runtime;
  if (!rule) return true;
  const runtime = input.runtime;
  if (!runtime) return false;
  if (!stringMatchesAny(runtime.kind, rule.kinds)) return false;
  if (!stringMatchesAny(runtime.action, rule.actions)) return false;
  if (!regexMatchesAny(runtime.path, rule.pathPatterns)) return false;
  if (!stringMatchesAny(runtime.host, rule.hosts)) return false;
  if (!stringMatchesAny(runtime.packageName, rule.packageNames)) return false;
  return true;
}

function browserMatcher(input: GuardrailInput, matcher: GuardrailPolicyMatcher): boolean {
  const rule = matcher.browser;
  if (!rule) return true;
  const browser = input.browser;
  if (!browser) return false;
  const domain = browser.domain ?? hostnameFromUrl(browser.url);
  if (!stringMatchesAny(domain, rule.domains)) return false;
  if (!regexMatchesAny(browser.url, rule.urlPatterns)) return false;
  if (!stringMatchesAny(browser.action, rule.actions)) return false;
  if (!stringMatchesAny(browser.method, rule.methods)) return false;
  if (rule.externalSource !== undefined && browser.externalSource !== rule.externalSource) return false;
  if (rule.userGesture !== undefined && browser.userGesture !== rule.userGesture) return false;
  return true;
}

function computerMatcher(input: GuardrailInput, matcher: GuardrailPolicyMatcher): boolean {
  const rule = matcher.computer;
  if (!rule) return true;
  const computer = input.computer;
  if (!computer) return false;
  if (!stringMatchesAny(computer.app, rule.apps)) return false;
  if (!stringMatchesAny(computer.action, rule.actions)) return false;
  if (!stringMatchesAny(computer.target, rule.targets)) return false;
  if (
    rule.requiresUserVisibleChange !== undefined &&
    computer.requiresUserVisibleChange !== rule.requiresUserVisibleChange
  ) {
    return false;
  }
  return true;
}

function policyMatches(input: GuardrailInput, policy: GuardrailPolicy): boolean {
  if (policy.enabled === false) return false;
  const matcher = policy.when;
  if (!matcher) return true;
  if (matcher.operationTypes?.length && !matcher.operationTypes.includes(input.operationType)) return false;
  if (!includesAny(input.tags, matcher.tagsAny)) return false;
  if (!includesAny(input.actor?.roles, matcher.actorRolesAny)) return false;
  return (
    textMatcher(input, matcher) &&
    commandMatcher(input, matcher) &&
    modelMatcher(input, matcher) &&
    sourceMatcher(input, matcher) &&
    businessMatcher(input, matcher) &&
    mcpMatcher(input, matcher) &&
    actionMatcher(input, matcher) &&
    secretMatcher(input, matcher) &&
    runtimeMatcher(input, matcher) &&
    browserMatcher(input, matcher) &&
    computerMatcher(input, matcher)
  );
}

function strongestStatus(statuses: GuardrailDecisionStatus[], fallback: GuardrailDecisionStatus): GuardrailDecisionStatus {
  return statuses.reduce(
    (strongest, status) => (STATUS_PRECEDENCE[status] > STATUS_PRECEDENCE[strongest] ? status : strongest),
    fallback,
  );
}

function allowedForStatus(status: GuardrailDecisionStatus): boolean {
  return status === "allow" || status === "warn" || status === "redact";
}

function evidenceForPolicy(policy: GuardrailPolicy, input: GuardrailInput): GuardrailEvidence[] {
  const evidence = policy.evidence ?? [];
  if (evidence.length > 0) {
    return evidence.map((message) => ({ policyId: policy.id, message }));
  }
  return [
    {
      policyId: policy.id,
      message: `Matched ${input.operationType} policy ${policy.id}.`,
    },
  ];
}

function defaultReason(status: GuardrailDecisionStatus): string {
  if (status === "allow") return "No guardrail policies matched.";
  if (status === "deny") return "One or more guardrail policies denied the operation.";
  if (status === "approval_required") return "One or more guardrail policies require approval.";
  if (status === "redact") return "One or more guardrail policies require redaction.";
  return "One or more guardrail policies produced warnings.";
}

export function evaluateGuardrail(
  inputValue: GuardrailInput,
  policySetValue: GuardrailPolicySet = defaultGuardrailPolicySet,
  options: EvaluateGuardrailOptions = {},
): GuardrailDecision {
  const input = parseGuardrailInput(inputValue);
  const policySet = parseGuardrailPolicySet(policySetValue);
  const matched = policySet.policies.filter((policy) => policyMatches(input, policy));
  const redactions = matched.flatMap((policy) => detectRedactions(input, policy.id, policy.redactions ?? []));
  const effectivePolicies = matched.filter(
    (policy) => policy.effect !== "redact" || redactions.some((redaction) => redaction.policyId === policy.id),
  );
  const effectiveStatuses = effectivePolicies.map((policy) => policy.effect);
  const status = strongestStatus(effectiveStatuses, policySet.defaultDecision ?? "allow");
  const reason = effectivePolicies.find((policy) => policy.effect === status)?.reason ?? defaultReason(status);
  const now = options.now ?? new Date();
  const decisionId = options.decisionId ?? randomUUID();
  const labels = Array.from(new Set([...(input.tags ?? []), ...effectivePolicies.map((policy) => policy.id)]));

  return {
    status,
    allowed: allowedForStatus(status),
    reason,
    matchedPolicies: effectivePolicies.map((policy) => {
      const base = {
        id: policy.id,
        effect: policy.effect,
        reason: policy.reason,
        severity: policy.severity ?? ("medium" as GuardrailSeverity),
      };
      return policy.description ? { ...base, description: policy.description } : base;
    }),
    evidence: effectivePolicies.flatMap((policy) => evidenceForPolicy(policy, input)),
    obligations: effectivePolicies.flatMap((policy) => policy.obligations ?? []),
    redactions,
    approvalRequirements: effectivePolicies.flatMap((policy) => {
      if (policy.effect !== "approval_required") return [];
      if (policy.approval) return [policy.approval];
      return [{ id: `${policy.id}-approval`, reason: policy.reason }];
    }),
    audit: {
      decisionId,
      evaluatedAt: now.toISOString(),
      engineVersion: options.engineVersion ?? guardrailsVersion,
      policySetId: policySet.id,
      ...(policySet.version ? { policySetVersion: policySet.version } : {}),
      ...(input.id ? { inputId: input.id } : {}),
      operationType: input.operationType,
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.actor?.id ? { actorId: input.actor.id } : {}),
      ...(input.session?.traceId ? { traceId: input.session.traceId } : {}),
      labels,
    },
  };
}

export function evaluateGuardrailWithDefaultPolicy(input: GuardrailInput, options: EvaluateGuardrailOptions = {}): GuardrailDecision {
  return evaluateGuardrail(input, defaultGuardrailPolicySet, options);
}
