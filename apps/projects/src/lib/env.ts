/**
 * Env-var naming standard (2026-08-24): harness apps use the HASNA_<APP>_
 * prefix. Projects historically read a large trailing surface from legacy
 * PROJECTS_* names (and the pre-rename WORKSPACES_* names) with no HASNA_
 * variant; HASNA_PROJECTS_* is now canonical and the legacy names remain as
 * a compatibility alias for one deprecation window. Never a silent rename.
 * OPENROUTER_* stays the sanctioned provider generic for the raw key.
 *
 * Reads are lazy (function calls) so callers that set process.env at runtime
 * observe the values they set. Canonical wins when both are set; never set
 * both with different values.
 */
const alias = (...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
};

export const env = {
  json: (): string | undefined => alias("HASNA_PROJECTS_JSON", "PROJECTS_JSON"),
  reportsToken: (): string | undefined =>
    alias("HASNA_PROJECTS_REPORTS_TOKEN", "PROJECTS_REPORTS_TOKEN"),
  conversationsBin: (): string | undefined =>
    alias("HASNA_PROJECTS_CONVERSATIONS_BIN", "PROJECTS_CONVERSATIONS_BIN"),
  agentModel: (): string | undefined =>
    alias("HASNA_PROJECTS_AGENT_MODEL", "PROJECTS_AGENT_MODEL"),
  agentContextLimit: (): string | undefined =>
    alias("HASNA_PROJECTS_AGENT_CONTEXT_LIMIT", "PROJECTS_AGENT_CONTEXT_LIMIT"),
  openrouterApiKey: (): string | undefined =>
    alias("HASNA_PROJECTS_OPENROUTER_API_KEY", "OPENROUTER_API_KEY", "PROJECTS_OPENROUTER_API_KEY"),
  openrouterSecretKey: (): string | undefined =>
    alias("HASNA_PROJECTS_OPENROUTER_SECRET_KEY", "PROJECTS_OPENROUTER_SECRET_KEY"),
  useSecrets: (): string | undefined =>
    alias("HASNA_PROJECTS_USE_SECRETS", "PROJECTS_USE_SECRETS"),
  modelPricingJson: (): string | undefined =>
    alias("HASNA_PROJECTS_MODEL_PRICING_JSON", "PROJECTS_MODEL_PRICING_JSON"),
} as const;
