// Claude Code backend adapter — renders semantic backend/model metadata into
// Claude-specific environment variables and declares the inherited-env
// conflicts it must remove.
//
// This is the Phase 1 adapter (DeepSeek via the Anthropic-compatible
// `anthropic-messages` protocol). Future harnesses get their own adapter in
// this directory; the backend registry stays protocol-semantic and the
// `[1m]` context suffix is rendered HERE, never stored (design 01a00e8a §6).

import type { BackendModel, BackendRoute } from "../../types.js";
import { AccountsError } from "../../types.js";
import { resolveBackendModel } from "../backend-routes.js";

/** The env var Claude Code reads as its bearer credential. */
export const CLAUDE_BACKEND_AUTH_ENV_VAR = "ANTHROPIC_AUTH_TOKEN";

/**
 * Inherited env that must be REMOVED before a backend-routed Claude launch.
 *
 * `ANTHROPIC_API_KEY` is the measured one: Claude Code treats API-key and
 * auth-token as mutually exclusive, and a stale ambient key next to a vault
 * auth token breaks authentication. Adapter-owned conflicts are declared
 * here (never arbitrary profile text) so the planner can enforce them.
 */
export const CLAUDE_BACKEND_UNSET_ENV = ["ANTHROPIC_API_KEY"] as const;

/** Claude renders the wire model as `<id>[1m]` when the window is >= 1M tokens. */
export const MIN_MILLION_TOKEN_WINDOW = 1_000_000;

export interface BackendAdapterEnv {
  /** Non-secret env the harness needs (base URL, model, aliases, behavior). */
  env: Record<string, string>;
  /** Inherited-env names the adapter owns and must unset. */
  unsetEnv: string[];
  /** Env var the harness reads its credential from (the vault binding target). */
  authEnvVar: string;
}

/** The `[1m]` suffix, rendered only when the semantic window is >= 1M tokens. */
export function claudeContextWindowSuffix(model: BackendModel): string {
  return model.contextWindowTokens >= MIN_MILLION_TOKEN_WINDOW ? "[1m]" : "";
}

/** The Claude wire model name for a semantic model record. */
export function claudeModelWireName(model: BackendModel): string {
  return `${model.id}${claudeContextWindowSuffix(model)}`;
}

const CLAUDE_ALIAS_ENV_VARS: ReadonlyArray<{ alias: "opus" | "sonnet" | "haiku"; envVar: string }> = [
  { alias: "opus", envVar: "ANTHROPIC_DEFAULT_OPUS_MODEL" },
  { alias: "sonnet", envVar: "ANTHROPIC_DEFAULT_SONNET_MODEL" },
  { alias: "haiku", envVar: "ANTHROPIC_DEFAULT_HAIKU_MODEL" },
];

/**
 * Render the Claude Code adapter env for a backend route.
 *
 * Throws for protocols Claude cannot speak — an adapter must refuse rather
 * than silently set plausible variables against a mismatched wire protocol.
 */
export function claudeBackendAdapter(backend: BackendRoute, modelId?: string): BackendAdapterEnv {
  if (backend.protocol !== "anthropic-messages") {
    throw new AccountsError(
      `the Claude adapter supports only the anthropic-messages protocol; backend "${backend.id}" declares "${backend.protocol}"`,
    );
  }
  const model = resolveBackendModel(backend, modelId);
  const wireModel = claudeModelWireName(model);
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: backend.baseUrl,
    ANTHROPIC_MODEL: wireModel,
    // Sub-agents inherit the same backend route.
    CLAUDE_CODE_SUBAGENT_MODEL: wireModel,
    // The harness knows the window; compact automatically instead of erroring
    // when the rendered `[1m]` window is exhausted. Claude Code accepts a plain
    // token count only — the literal "true" parses to NaN and is silently
    // ignored. 786432 (768K) is the value proven by the verified working
    // hotfixes env; it compacts before the rendered window edge.
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: "786432",
  };
  for (const { alias, envVar } of CLAUDE_ALIAS_ENV_VARS) {
    const aliasModelId = backend.defaults?.aliases?.[alias];
    if (aliasModelId !== undefined) {
      env[envVar] = claudeModelWireName(resolveBackendModel(backend, aliasModelId));
    }
  }
  return {
    env,
    unsetEnv: [...CLAUDE_BACKEND_UNSET_ENV],
    authEnvVar: CLAUDE_BACKEND_AUTH_ENV_VAR,
  };
}
