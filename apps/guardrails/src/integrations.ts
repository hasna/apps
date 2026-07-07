import type {
  GuardrailActionContext,
  GuardrailBusinessOperationContext,
  GuardrailInput,
  GuardrailMcpToolCallContext,
  GuardrailModelRoutingContext,
  GuardrailPromptMessage,
  GuardrailShellCommandContext,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function inferBusinessContext(action: GuardrailActionContext): GuardrailBusinessOperationContext | undefined {
  if (!isRecord(action.input)) return undefined;
  const inferred: GuardrailBusinessOperationContext = {};
  const operation = optionalString(action.input.operation);
  const resource = optionalString(action.input.resource);
  const amountUsd = optionalNumber(action.input.amountUsd);
  const customerId = optionalString(action.input.customerId);
  const accountId = optionalString(action.input.accountId);
  const irreversible = optionalBoolean(action.input.irreversible);
  const approvalState = optionalString(action.input.approvalState);
  if (operation) inferred.operation = operation;
  if (resource) inferred.resource = resource;
  if (amountUsd !== undefined) inferred.amountUsd = amountUsd;
  if (customerId) inferred.customerId = customerId;
  if (accountId) inferred.accountId = accountId;
  if (irreversible !== undefined) inferred.irreversible = irreversible;
  if (approvalState) inferred.approvalState = approvalState;
  const hasBusinessField = Object.keys(inferred).length > 0;
  if (!hasBusinessField) return undefined;
  return {
    ...(action.name ? { operation: action.name } : {}),
    ...(action.resource ? { resource: action.resource } : {}),
    ...inferred,
  };
}

export function promptGuardrailInput(input: {
  prompt?: string;
  messages?: GuardrailPromptMessage[];
  actorId?: string;
  tool?: string;
  target?: string;
  traceId?: string;
  sourceTrustLevel?: "trusted" | "internal" | "external" | "untrusted" | (string & {});
  metadata?: Record<string, unknown>;
}): GuardrailInput {
  return {
    operationType: "prompt",
    ...(input.target ? { subject: input.target } : {}),
    ...(input.actorId ? { actor: { id: input.actorId, type: "agent" } } : {}),
    session: {
      ...(input.tool ? { tool: input.tool } : {}),
      ...(input.traceId ? { traceId: input.traceId } : {}),
    },
    prompt: {
      ...(input.prompt ? { text: input.prompt } : {}),
      ...(input.messages ? { messages: input.messages } : {}),
    },
    ...(input.sourceTrustLevel ? { sourceAccess: { trustLevel: input.sourceTrustLevel } } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function openActionsGuardrailInput(input: {
  action: GuardrailActionContext;
  business?: GuardrailBusinessOperationContext;
  phase?: "preview" | "execute" | "rollback" | (string & {});
  actorId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}): GuardrailInput {
  const subject = input.action.name ?? input.action.id;
  const business = input.business ?? inferBusinessContext(input.action);
  return {
    operationType: "action",
    ...(subject ? { subject } : {}),
    ...(input.actorId ? { actor: { id: input.actorId, type: "agent" } } : {}),
    session: {
      tool: "open-actions",
      ...(input.traceId ? { traceId: input.traceId } : {}),
    },
    action: {
      ...input.action,
      ...(input.phase ? { phase: input.phase } : {}),
    },
    ...(business ? { business } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function openDispatchPromptGuardrailInput(input: {
  target: string;
  prompt: string;
  actorId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}): GuardrailInput {
  return promptGuardrailInput({
    prompt: input.prompt,
    target: input.target,
    tool: "open-dispatch",
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
}

export function openTerminalCommandGuardrailInput(input: GuardrailShellCommandContext & {
  actorId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}): GuardrailInput {
  return {
    operationType: "shell_command",
    subject: input.command,
    ...(input.actorId ? { actor: { id: input.actorId, type: "agent" } } : {}),
    session: {
      tool: "open-terminal",
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.traceId ? { traceId: input.traceId } : {}),
    },
    shell: {
      command: input.command,
      ...(input.args ? { args: input.args } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.envKeys ? { envKeys: input.envKeys } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.targetKind ? { targetKind: input.targetKind } : {}),
    },
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function openMcpsToolCallGuardrailInput(input: GuardrailMcpToolCallContext & {
  actorId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}): GuardrailInput {
  return {
    operationType: "mcp_tool_call",
    subject: input.toolName,
    ...(input.actorId ? { actor: { id: input.actorId, type: "agent" } } : {}),
    session: {
      tool: "open-mcps",
      ...(input.traceId ? { traceId: input.traceId } : {}),
    },
    mcp: {
      toolName: input.toolName,
      ...(input.serverId ? { serverId: input.serverId } : {}),
      ...(input.serverName ? { serverName: input.serverName } : {}),
      ...(input.arguments ? { arguments: input.arguments } : {}),
      ...(input.transport ? { transport: input.transport } : {}),
      ...(input.registrySource ? { registrySource: input.registrySource } : {}),
    },
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function modelRoutingGuardrailInput(input: GuardrailModelRoutingContext & {
  tool?: "open-gateway" | "open-router" | (string & {});
  actorId?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}): GuardrailInput {
  const subject = input.selectedModel ?? input.requestedModel;
  return {
    operationType: "model_routing",
    ...(subject ? { subject } : {}),
    ...(input.actorId ? { actor: { id: input.actorId, type: "agent" } } : {}),
    session: {
      tool: input.tool ?? "open-router",
      ...(input.traceId ? { traceId: input.traceId } : {}),
    },
    modelRouting: {
      ...(input.requestedModel ? { requestedModel: input.requestedModel } : {}),
      ...(input.selectedModel ? { selectedModel: input.selectedModel } : {}),
      ...(input.provider ? { provider: input.provider } : {}),
      ...(input.route ? { route: input.route } : {}),
      ...(input.inputUsdPerMillionTokens !== undefined ? { inputUsdPerMillionTokens: input.inputUsdPerMillionTokens } : {}),
      ...(input.outputUsdPerMillionTokens !== undefined ? { outputUsdPerMillionTokens: input.outputUsdPerMillionTokens } : {}),
      ...(input.estimatedInputTokens !== undefined ? { estimatedInputTokens: input.estimatedInputTokens } : {}),
      ...(input.estimatedOutputTokens !== undefined ? { estimatedOutputTokens: input.estimatedOutputTokens } : {}),
      ...(input.allowTraining !== undefined ? { allowTraining: input.allowTraining } : {}),
      ...(input.allowLogging !== undefined ? { allowLogging: input.allowLogging } : {}),
      ...(input.zeroDataRetentionRequired !== undefined ? { zeroDataRetentionRequired: input.zeroDataRetentionRequired } : {}),
      ...(input.byokOnly !== undefined ? { byokOnly: input.byokOnly } : {}),
      ...(input.regions ? { regions: input.regions } : {}),
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
    },
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
