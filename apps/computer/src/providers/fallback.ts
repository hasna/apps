import { logAuditEvent } from "../db/index.js";
import type {
  ComputerProvider,
  ModelResponse,
  Provider,
  ProviderFallbackConfig,
  ProviderFallbackReason,
  Screenshot,
} from "../types/index.js";

export interface FallbackComputerProviderOptions {
  policy?: Partial<ProviderFallbackConfig>;
  actor?: string;
  transport?: string;
  metadata?: Record<string, unknown>;
}

export class FallbackComputerProvider implements ComputerProvider {
  readonly name: Provider;
  readonly providers: readonly ComputerProvider[];
  private readonly fallbackOn: Set<ProviderFallbackReason>;
  private readonly actor?: string;
  private readonly transport: string;
  private readonly metadata?: Record<string, unknown>;

  constructor(
    primary: ComputerProvider,
    fallbacks: readonly ComputerProvider[],
    options: FallbackComputerProviderOptions = {},
  ) {
    this.name = primary.name;
    this.providers = [primary, ...fallbacks];
    this.fallbackOn = new Set(options.policy?.fallbackOn ?? DEFAULT_PROVIDER_FALLBACK_ON);
    this.actor = options.actor;
    this.transport = options.transport ?? "provider";
    this.metadata = options.metadata;
  }

  async analyze(params: {
    task: string;
    screenshot: Screenshot;
    history: ModelResponse[];
    systemPrompt?: string;
  }): Promise<ModelResponse> {
    const failures: Array<{ provider: Provider; reason: ProviderFallbackReason; error: string }> = [];

    for (const [index, provider] of this.providers.entries()) {
      try {
        const response = await provider.analyze(params);
        if (index > 0) {
          await this.recordAudit({
            event: "provider.fallback_succeeded",
            provider: this.providers[0]!.name,
            fallbackProvider: provider.name,
            decision: "succeeded",
            reason: `Fallback provider ${provider.name} succeeded after ${failures.length} failure(s).`,
            actionData: {
              failure_count: failures.length,
              fallback_provider: provider.name,
              redacted: true,
            },
            screenshot: params.screenshot,
            historyLength: params.history.length,
          });
        }
        return index > 0
          ? {
            ...response,
            reasoning: response.reasoning
              ? `[provider fallback: ${provider.name}] ${response.reasoning}`
              : `[provider fallback: ${provider.name}]`,
          }
          : response;
      } catch (error) {
        const reason = classifyProviderError(error);
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ provider: provider.name, reason, error: message });
        await this.recordAudit({
          event: "provider.fallback_attempt",
          provider: provider.name,
          fallbackProvider: this.providers[index + 1]?.name,
          decision: index + 1 < this.providers.length && this.fallbackOn.has(reason) ? "fallback" : "failed",
          reason: message,
          actionData: {
            failed_provider: provider.name,
            fallback_provider: this.providers[index + 1]?.name ?? null,
            failure_reason: reason,
            redacted: true,
          },
          screenshot: params.screenshot,
          historyLength: params.history.length,
        });
        if (!this.fallbackOn.has(reason) || index === this.providers.length - 1) {
          throw new Error(formatProviderFallbackFailure(failures));
        }
      }
    }

    throw new Error(formatProviderFallbackFailure(failures));
  }

  private async recordAudit(input: {
    event: string;
    provider: Provider;
    fallbackProvider?: Provider;
    decision: string;
    reason?: string;
    actionData: Record<string, unknown>;
    screenshot: Screenshot;
    historyLength: number;
  }): Promise<void> {
    await logAuditEvent({
      event: input.event,
      actor: this.actor,
      transport: this.transport,
      capability: "provider.analyze",
      action_type: "provider_fallback",
      action_data: input.actionData,
      decision: input.decision,
      reason: input.reason,
      metadata: {
        primary_provider: this.providers[0]!.name,
        failed_provider: input.provider,
        fallback_provider: input.fallbackProvider,
        screenshot_width: input.screenshot.size.width,
        screenshot_height: input.screenshot.size.height,
        history_length: input.historyLength,
        ...this.metadata,
      },
    });
  }
}

export const DEFAULT_PROVIDER_FALLBACK_ON: ProviderFallbackReason[] = [
  "rate_limit",
  "unsupported",
  "error",
];

export function classifyProviderError(error: unknown): ProviderFallbackReason {
  const value = error as {
    status?: number;
    code?: string;
    type?: string;
    response?: { status?: number };
    error?: { code?: string; type?: string; message?: string };
    message?: string;
  };
  const status = value?.status ?? value?.response?.status;
  const text = [
    value?.code,
    value?.type,
    value?.error?.code,
    value?.error?.type,
    value?.error?.message,
    value?.message,
    typeof error === "string" ? error : undefined,
  ].filter(Boolean).join(" ").toLowerCase();

  if (status === 429 || text.includes("rate limit") || text.includes("rate_limit") || text.includes("quota")) {
    return "rate_limit";
  }
  if (
    status === 400 ||
    status === 404 ||
    text.includes("unsupported") ||
    text.includes("not supported") ||
    text.includes("capability") ||
    text.includes("computer_use") ||
    text.includes("computer-use") ||
    text.includes("tool not available")
  ) {
    return "unsupported";
  }
  return "error";
}

export function chooseDefaultFallbackProvider(provider: Provider): Provider {
  return provider === "anthropic" ? "openai" : "anthropic";
}

function formatProviderFallbackFailure(failures: Array<{ provider: Provider; reason: ProviderFallbackReason; error: string }>): string {
  if (failures.length === 0) return "Provider analysis failed before any provider was attempted.";
  return `Provider analysis failed after ${failures.length} attempt(s): ${failures
    .map((failure) => `${failure.provider}/${failure.reason}: ${failure.error}`)
    .join("; ")}`;
}
