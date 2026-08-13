import { z } from "zod";
import type { GuardrailInput, GuardrailPolicySet } from "./types";

export const guardrailOperationTypeSchema = z.enum([
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
]);

export const guardrailDecisionStatusSchema = z.enum(["allow", "deny", "warn", "redact", "approval_required"]);
export const guardrailSeveritySchema = z.enum(["info", "low", "medium", "high", "critical"]);

const stringArraySchema = z.array(z.string().min(1));

const actorSchema = z
  .object({
    id: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    roles: stringArraySchema.optional(),
    orgId: z.string().min(1).optional(),
    teamId: z.string().min(1).optional(),
  })
  .passthrough();

const sessionSchema = z
  .object({
    id: z.string().min(1).optional(),
    tool: z.string().min(1).optional(),
    cwd: z.string().min(1).optional(),
    workspace: z.string().min(1).optional(),
    traceId: z.string().min(1).optional(),
  })
  .passthrough();

const promptMessageSchema = z
  .object({
    role: z.string().min(1),
    content: z.union([z.string(), z.array(z.record(z.unknown())), z.null()]).optional(),
    name: z.string().min(1).optional(),
  })
  .passthrough();

export const guardrailInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    operationType: guardrailOperationTypeSchema,
    subject: z.string().min(1).optional(),
    actor: actorSchema.optional(),
    session: sessionSchema.optional(),
    prompt: z
      .object({
        text: z.string().optional(),
        messages: z.array(promptMessageSchema).optional(),
        channel: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
    action: z
      .object({
        id: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        kind: z.string().min(1).optional(),
        phase: z.string().min(1).optional(),
        input: z.unknown().optional(),
        preview: z.unknown().optional(),
        idempotencyKey: z.string().min(1).optional(),
        resource: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
    shell: z
      .object({
        command: z.string(),
        args: stringArraySchema.optional(),
        cwd: z.string().min(1).optional(),
        envKeys: stringArraySchema.optional(),
        target: z.string().min(1).optional(),
        targetKind: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
    mcp: z
      .object({
        serverId: z.string().min(1).optional(),
        serverName: z.string().min(1).optional(),
        toolName: z.string().min(1),
        arguments: z.record(z.unknown()).optional(),
        transport: z.string().min(1).optional(),
        registrySource: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
    browser: z
      .object({
        url: z.string().optional(),
        domain: z.string().min(1).optional(),
        action: z.string().min(1).optional(),
        method: z.string().min(1).optional(),
        userGesture: z.boolean().optional(),
        externalSource: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    computer: z
      .object({
        app: z.string().min(1).optional(),
        action: z.string().min(1).optional(),
        target: z.string().min(1).optional(),
        screenText: z.string().optional(),
        requiresUserVisibleChange: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    runtime: z
      .object({
        kind: z.string().min(1).optional(),
        action: z.string().min(1).optional(),
        path: z.string().min(1).optional(),
        host: z.string().min(1).optional(),
        packageName: z.string().min(1).optional(),
        method: z.string().min(1).optional(),
        capability: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
    modelRouting: z
      .object({
        requestedModel: z.string().min(1).optional(),
        selectedModel: z.string().min(1).optional(),
        provider: z.string().min(1).optional(),
        route: z.string().min(1).optional(),
        inputUsdPerMillionTokens: z.number().min(0).optional(),
        outputUsdPerMillionTokens: z.number().min(0).optional(),
        estimatedInputTokens: z.number().int().min(0).optional(),
        estimatedOutputTokens: z.number().int().min(0).optional(),
        allowTraining: z.boolean().optional(),
        allowLogging: z.boolean().optional(),
        zeroDataRetentionRequired: z.boolean().optional(),
        byokOnly: z.boolean().optional(),
        regions: stringArraySchema.optional(),
        capabilities: stringArraySchema.optional(),
      })
      .passthrough()
      .optional(),
    secretAccess: z
      .object({
        secretName: z.string().min(1).optional(),
        action: z.string().min(1).optional(),
        source: z.string().min(1).optional(),
        classification: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
    sourceAccess: z
      .object({
        uri: z.string().optional(),
        sourceType: z.string().min(1).optional(),
        trustLevel: z.string().min(1).optional(),
        license: z.string().min(1).optional(),
        contentType: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
    business: z
      .object({
        operation: z.string().min(1).optional(),
        resource: z.string().min(1).optional(),
        amountUsd: z.number().min(0).optional(),
        customerId: z.string().min(1).optional(),
        accountId: z.string().min(1).optional(),
        irreversible: z.boolean().optional(),
        approvalState: z.string().min(1).optional(),
      })
      .passthrough()
      .optional(),
    content: z
      .object({
        text: z.string().optional(),
        json: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
    tags: stringArraySchema.optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

const matcherSchema = z
  .object({
    operationTypes: z.array(guardrailOperationTypeSchema).optional(),
    tagsAny: stringArraySchema.optional(),
    actorRolesAny: stringArraySchema.optional(),
    textIncludes: stringArraySchema.optional(),
    textPatterns: stringArraySchema.optional(),
    command: z
      .object({
        names: stringArraySchema.optional(),
        includes: stringArraySchema.optional(),
        patterns: stringArraySchema.optional(),
        destructive: z.boolean().optional(),
      })
      .strict()
      .optional(),
    model: z
      .object({
        providers: stringArraySchema.optional(),
        models: stringArraySchema.optional(),
        minInputUsdPerMillionTokens: z.number().min(0).optional(),
        minOutputUsdPerMillionTokens: z.number().min(0).optional(),
        allowTraining: z.boolean().optional(),
        allowLogging: z.boolean().optional(),
        zeroDataRetentionRequired: z.boolean().optional(),
      })
      .strict()
      .optional(),
    source: z
      .object({
        trustLevels: stringArraySchema.optional(),
        uriPatterns: stringArraySchema.optional(),
        domains: stringArraySchema.optional(),
      })
      .strict()
      .optional(),
    business: z
      .object({
        operations: stringArraySchema.optional(),
        minAmountUsd: z.number().min(0).optional(),
        irreversible: z.boolean().optional(),
        resources: stringArraySchema.optional(),
      })
      .strict()
      .optional(),
    mcp: z
      .object({
        serverIds: stringArraySchema.optional(),
        toolNames: stringArraySchema.optional(),
        transports: stringArraySchema.optional(),
      })
      .strict()
      .optional(),
    action: z
      .object({
        ids: stringArraySchema.optional(),
        names: stringArraySchema.optional(),
        kinds: stringArraySchema.optional(),
        phases: stringArraySchema.optional(),
      })
      .strict()
      .optional(),
    secret: z
      .object({
        names: stringArraySchema.optional(),
        actions: stringArraySchema.optional(),
        classifications: stringArraySchema.optional(),
      })
      .strict()
      .optional(),
    runtime: z
      .object({
        kinds: stringArraySchema.optional(),
        actions: stringArraySchema.optional(),
        pathPatterns: stringArraySchema.optional(),
        hosts: stringArraySchema.optional(),
        packageNames: stringArraySchema.optional(),
      })
      .strict()
      .optional(),
    browser: z
      .object({
        domains: stringArraySchema.optional(),
        urlPatterns: stringArraySchema.optional(),
        actions: stringArraySchema.optional(),
        methods: stringArraySchema.optional(),
        externalSource: z.boolean().optional(),
        userGesture: z.boolean().optional(),
      })
      .strict()
      .optional(),
    computer: z
      .object({
        apps: stringArraySchema.optional(),
        actions: stringArraySchema.optional(),
        targets: stringArraySchema.optional(),
        requiresUserVisibleChange: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const guardrailPolicySetSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1).optional(),
    description: z.string().optional(),
    schemaVersion: z.string().min(1).optional(),
    defaultDecision: guardrailDecisionStatusSchema.optional(),
    policies: z.array(
      z
        .object({
          id: z.string().min(1),
          description: z.string().optional(),
          enabled: z.boolean().optional(),
          severity: guardrailSeveritySchema.optional(),
          when: matcherSchema.optional(),
          effect: guardrailDecisionStatusSchema,
          reason: z.string().min(1),
          evidence: stringArraySchema.optional(),
          obligations: z
            .array(
              z
                .object({
                  id: z.string().min(1),
                  description: z.string().min(1),
                  stage: z.string().min(1).optional(),
                  metadata: z.record(z.unknown()).optional(),
                })
                .passthrough(),
            )
            .optional(),
          redactions: z
            .array(
              z
                .object({
                  id: z.string().min(1).optional(),
                  pattern: z.string().min(1),
                  replacement: z.string().optional(),
                  paths: stringArraySchema.optional(),
                })
                .passthrough(),
            )
            .optional(),
          approval: z
            .object({
              id: z.string().min(1).optional(),
              reason: z.string().optional(),
              approverRoles: stringArraySchema.optional(),
              approverIds: stringArraySchema.optional(),
              ticketRequired: z.boolean().optional(),
              fields: stringArraySchema.optional(),
            })
            .passthrough()
            .optional(),
          metadata: z.record(z.unknown()).optional(),
        })
        .passthrough(),
    ),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough();

function formatZodIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "value";
  return `${path}: ${issue.message}`;
}

function compilePolicyPattern(pattern: string): void {
  if (pattern.startsWith("(?i)")) {
    new RegExp(pattern.slice(4), "u");
    return;
  }
  new RegExp(pattern, "u");
}

function validateRegexList(errors: string[], path: string, patterns: string[] | undefined): void {
  for (const [index, pattern] of (patterns ?? []).entries()) {
    try {
      compilePolicyPattern(pattern);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${path}.${index}: invalid regular expression ${JSON.stringify(pattern)} (${message})`);
    }
  }
}

function validatePolicyRegexes(policySet: GuardrailPolicySet): string[] {
  const errors: string[] = [];
  for (const [policyIndex, policy] of policySet.policies.entries()) {
    const base = `policies.${policyIndex}`;
    validateRegexList(errors, `${base}.when.textPatterns`, policy.when?.textPatterns);
    validateRegexList(errors, `${base}.when.command.patterns`, policy.when?.command?.patterns);
    validateRegexList(errors, `${base}.when.source.uriPatterns`, policy.when?.source?.uriPatterns);
    validateRegexList(errors, `${base}.when.runtime.pathPatterns`, policy.when?.runtime?.pathPatterns);
    validateRegexList(errors, `${base}.when.browser.urlPatterns`, policy.when?.browser?.urlPatterns);
    for (const [redactionIndex, redaction] of (policy.redactions ?? []).entries()) {
      validateRegexList(errors, `${base}.redactions.${redactionIndex}.pattern`, [redaction.pattern]);
    }
  }
  return errors;
}

export function parseGuardrailInput(value: unknown): GuardrailInput {
  const parsed = guardrailInputSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues.map(formatZodIssue).join("\n"));
  return parsed.data as GuardrailInput;
}

export function parseGuardrailPolicySet(value: unknown): GuardrailPolicySet {
  const parsed = guardrailPolicySetSchema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues.map(formatZodIssue).join("\n"));
  const policySet = parsed.data as GuardrailPolicySet;
  const regexErrors = validatePolicyRegexes(policySet);
  if (regexErrors.length > 0) throw new Error(regexErrors.join("\n"));
  return policySet;
}
