export type GuardrailOperationType =
  | "prompt"
  | "action"
  | "shell_command"
  | "mcp_tool_call"
  | "browser_operation"
  | "computer_operation"
  | "runtime_operation"
  | "model_routing"
  | "secret_access"
  | "source_access"
  | "business_operation";

export type GuardrailDecisionStatus = "allow" | "deny" | "warn" | "redact" | "approval_required";

export type GuardrailSeverity = "info" | "low" | "medium" | "high" | "critical";

export type GuardrailEffect = GuardrailDecisionStatus;

export type GuardrailActor = {
  id?: string;
  type?: "human" | "agent" | "service" | "system" | (string & {});
  roles?: string[];
  orgId?: string;
  teamId?: string;
};

export type GuardrailSession = {
  id?: string;
  tool?: string;
  cwd?: string;
  workspace?: string;
  traceId?: string;
};

export type GuardrailPromptMessage = {
  role: "system" | "developer" | "user" | "assistant" | "tool" | (string & {});
  content?: string | Array<Record<string, unknown>> | null;
  name?: string;
};

export type GuardrailActionContext = {
  id?: string;
  name?: string;
  kind?: string;
  phase?: "preview" | "execute" | "rollback" | (string & {});
  input?: unknown;
  preview?: unknown;
  idempotencyKey?: string;
  resource?: string;
};

export type GuardrailShellCommandContext = {
  command: string;
  args?: string[];
  cwd?: string;
  envKeys?: string[];
  target?: string;
  targetKind?: "shell" | "agent" | "unknown" | (string & {});
};

export type GuardrailMcpToolCallContext = {
  serverId?: string;
  serverName?: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  transport?: "stdio" | "sse" | "streamable-http" | (string & {});
  registrySource?: string;
};

export type GuardrailBrowserOperationContext = {
  url?: string;
  domain?: string;
  action?: string;
  method?: string;
  userGesture?: boolean;
  externalSource?: boolean;
};

export type GuardrailComputerOperationContext = {
  app?: string;
  action?: string;
  target?: string;
  screenText?: string;
  requiresUserVisibleChange?: boolean;
};

export type GuardrailRuntimeOperationContext = {
  kind?: "file" | "network" | "process" | "package" | "container" | "database" | (string & {});
  action?: string;
  path?: string;
  host?: string;
  packageName?: string;
  method?: string;
  capability?: string;
};

export type GuardrailModelRoutingContext = {
  requestedModel?: string;
  selectedModel?: string;
  provider?: string;
  route?: string;
  inputUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  allowTraining?: boolean;
  allowLogging?: boolean;
  zeroDataRetentionRequired?: boolean;
  byokOnly?: boolean;
  regions?: string[];
  capabilities?: string[];
};

export type GuardrailSecretAccessContext = {
  secretName?: string;
  action?: "read" | "write" | "list" | "delete" | "export" | (string & {});
  source?: string;
  classification?: "secret" | "credential" | "token" | "public" | (string & {});
};

export type GuardrailSourceAccessContext = {
  uri?: string;
  sourceType?: "file" | "url" | "git" | "email" | "chat" | "document" | (string & {});
  trustLevel?: "trusted" | "internal" | "external" | "untrusted" | (string & {});
  license?: string;
  contentType?: string;
};

export type GuardrailBusinessOperationContext = {
  operation?: string;
  resource?: string;
  amountUsd?: number;
  customerId?: string;
  accountId?: string;
  irreversible?: boolean;
  approvalState?: "none" | "requested" | "approved" | "rejected" | (string & {});
};

export type GuardrailInput = {
  id?: string;
  operationType: GuardrailOperationType;
  subject?: string;
  actor?: GuardrailActor;
  session?: GuardrailSession;
  prompt?: {
    text?: string;
    messages?: GuardrailPromptMessage[];
    channel?: string;
  };
  action?: GuardrailActionContext;
  shell?: GuardrailShellCommandContext;
  mcp?: GuardrailMcpToolCallContext;
  browser?: GuardrailBrowserOperationContext;
  computer?: GuardrailComputerOperationContext;
  runtime?: GuardrailRuntimeOperationContext;
  modelRouting?: GuardrailModelRoutingContext;
  secretAccess?: GuardrailSecretAccessContext;
  sourceAccess?: GuardrailSourceAccessContext;
  business?: GuardrailBusinessOperationContext;
  content?: {
    text?: string;
    json?: unknown;
  };
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type GuardrailCommandMatcher = {
  names?: string[];
  includes?: string[];
  patterns?: string[];
  destructive?: boolean;
};

export type GuardrailModelMatcher = {
  providers?: string[];
  models?: string[];
  minInputUsdPerMillionTokens?: number;
  minOutputUsdPerMillionTokens?: number;
  allowTraining?: boolean;
  allowLogging?: boolean;
  zeroDataRetentionRequired?: boolean;
};

export type GuardrailSourceMatcher = {
  trustLevels?: string[];
  uriPatterns?: string[];
  domains?: string[];
};

export type GuardrailBusinessMatcher = {
  operations?: string[];
  minAmountUsd?: number;
  irreversible?: boolean;
  resources?: string[];
};

export type GuardrailMcpMatcher = {
  serverIds?: string[];
  toolNames?: string[];
  transports?: string[];
};

export type GuardrailActionMatcher = {
  ids?: string[];
  names?: string[];
  kinds?: string[];
  phases?: string[];
};

export type GuardrailSecretMatcher = {
  names?: string[];
  actions?: string[];
  classifications?: string[];
};

export type GuardrailRuntimeMatcher = {
  kinds?: string[];
  actions?: string[];
  pathPatterns?: string[];
  hosts?: string[];
  packageNames?: string[];
};

export type GuardrailBrowserMatcher = {
  domains?: string[];
  urlPatterns?: string[];
  actions?: string[];
  methods?: string[];
  externalSource?: boolean;
  userGesture?: boolean;
};

export type GuardrailComputerMatcher = {
  apps?: string[];
  actions?: string[];
  targets?: string[];
  requiresUserVisibleChange?: boolean;
};

export type GuardrailPolicyMatcher = {
  operationTypes?: GuardrailOperationType[];
  tagsAny?: string[];
  actorRolesAny?: string[];
  textIncludes?: string[];
  textPatterns?: string[];
  command?: GuardrailCommandMatcher;
  model?: GuardrailModelMatcher;
  source?: GuardrailSourceMatcher;
  business?: GuardrailBusinessMatcher;
  mcp?: GuardrailMcpMatcher;
  action?: GuardrailActionMatcher;
  secret?: GuardrailSecretMatcher;
  runtime?: GuardrailRuntimeMatcher;
  browser?: GuardrailBrowserMatcher;
  computer?: GuardrailComputerMatcher;
};

export type GuardrailObligation = {
  id: string;
  description: string;
  stage?: "before" | "after" | "continuous" | (string & {});
  metadata?: Record<string, unknown>;
};

export type GuardrailRedactionRule = {
  id?: string;
  pattern: string;
  replacement?: string;
  paths?: string[];
};

export type GuardrailApprovalRequirement = {
  id?: string;
  reason?: string;
  approverRoles?: string[];
  approverIds?: string[];
  ticketRequired?: boolean;
  fields?: string[];
};

export type GuardrailPolicy = {
  id: string;
  description?: string;
  enabled?: boolean;
  severity?: GuardrailSeverity;
  when?: GuardrailPolicyMatcher;
  effect: GuardrailEffect;
  reason: string;
  evidence?: string[];
  obligations?: GuardrailObligation[];
  redactions?: GuardrailRedactionRule[];
  approval?: GuardrailApprovalRequirement;
  metadata?: Record<string, unknown>;
};

export type GuardrailPolicySet = {
  id: string;
  version?: string;
  description?: string;
  schemaVersion?: "1.0" | (string & {});
  defaultDecision?: GuardrailDecisionStatus;
  policies: GuardrailPolicy[];
  metadata?: Record<string, unknown>;
};

export type MatchedGuardrailPolicy = {
  id: string;
  effect: GuardrailEffect;
  reason: string;
  severity: GuardrailSeverity;
  description?: string;
};

export type GuardrailRationaleTraceEntry = {
  policyId: string;
  effect: GuardrailEffect;
  matched: boolean;
  effective: boolean;
  selected: boolean;
  specificity: number;
  constraints: string[];
  failedConstraints: string[];
  rationale: string;
};

export type GuardrailEvidence = {
  policyId: string;
  message: string;
  path?: string;
  excerpt?: string;
  metadata?: Record<string, unknown>;
};

export type GuardrailRedaction = {
  policyId: string;
  ruleId?: string;
  path: string;
  replacement: string;
  originalSha256: string;
  start?: number;
  end?: number;
};

export type GuardrailAuditMetadata = {
  /** Unique per evaluation, so two identical requests remain separate audit events. */
  decisionId: string;
  /**
   * Content hash of the input, policy set, and engine version. Two evaluations of the
   * same request share a fingerprint even though their decision ids differ.
   */
  decisionFingerprint: string;
  evaluatedAt: string;
  engineVersion: string;
  policySetId: string;
  policySetVersion?: string;
  inputId?: string;
  operationType: GuardrailOperationType;
  subject?: string;
  actorId?: string;
  traceId?: string;
  labels: string[];
};

export type GuardrailDecision = {
  status: GuardrailDecisionStatus;
  allowed: boolean;
  reason: string;
  matchedRule: MatchedGuardrailPolicy | null;
  matchedPolicies: MatchedGuardrailPolicy[];
  rationaleTrace: GuardrailRationaleTraceEntry[];
  evidence: GuardrailEvidence[];
  obligations: GuardrailObligation[];
  redactions: GuardrailRedaction[];
  approvalRequirements: GuardrailApprovalRequirement[];
  audit: GuardrailAuditMetadata;
};

export type EvaluateGuardrailOptions = {
  now?: Date;
  decisionId?: string;
  engineVersion?: string;
};
