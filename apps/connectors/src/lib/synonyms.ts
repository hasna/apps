/**
 * Synonym expansion for connector search.
 * Domain-specific terms only — not a general thesaurus.
 */

const SYNONYM_MAP: Record<string, string[]> = {
  // Communication
  email: ["smtp", "mail", "inbox", "resend", "ses"],
  chat: ["messaging", "im", "slack", "discord", "teams"],
  sms: ["text", "twilio", "messaging"],

  // Commerce & Finance
  payment: ["billing", "invoicing", "commerce", "checkout", "stripe"],
  payments: ["billing", "invoicing", "commerce", "checkout", "stripe"],
  ecommerce: ["shop", "store", "commerce", "shopify"],
  finance: ["banking", "accounting", "invoicing"],
  crypto: ["blockchain", "web3", "wallet"],

  // AI & ML
  ai: ["llm", "ml", "model", "gpt", "claude", "anthropic", "openai"],
  llm: ["ai", "model", "gpt", "claude"],
  gateway: ["vercel-ai-gateway", "ai-gateway", "vercel"],

  // Infrastructure & Dev
  auth: ["oauth", "sso", "login", "identity", "authentication"],
  database: ["db", "sql", "nosql", "postgres", "mongo", "supabase"],
  deploy: ["hosting", "infrastructure", "ci", "cd", "vercel"],
  storage: ["files", "drive", "s3", "bucket", "upload"],
  cloud: ["aws", "gcp", "azure", "infrastructure"],
  api: ["rest", "graphql", "endpoint", "webhook"],
  monitoring: ["logs", "observability", "alerting", "datadog", "sentry"],
  ci: ["cd", "deploy", "pipeline", "github", "actions"],

  // Business
  crm: ["sales", "leads", "contacts", "hubspot", "salesforce"],
  analytics: ["data", "metrics", "tracking", "mixpanel", "amplitude"],
  project: ["task", "issue", "board", "jira", "linear", "asana"],
  docs: ["documentation", "wiki", "notion", "confluence"],

  // Design
  design: ["figma", "sketch", "ui", "ux"],

  // Security
  security: ["auth", "encryption", "compliance", "vault"],
};

/**
 * Expand search tokens with domain synonyms.
 * Returns original tokens + synonym tokens (deduplicated).
 */
export function expandQuery(tokens: string[]): { original: string[]; expanded: string[] } {
  const synonyms = new Set<string>();

  for (const token of tokens) {
    const matches = SYNONYM_MAP[token];
    if (matches) {
      for (const syn of matches) {
        if (!tokens.includes(syn)) synonyms.add(syn);
      }
    }

    // Reverse lookup: if token appears as a synonym value, add the key
    for (const [key, values] of Object.entries(SYNONYM_MAP)) {
      if (values.includes(token) && !tokens.includes(key)) {
        synonyms.add(key);
      }
    }
  }

  return { original: tokens, expanded: [...synonyms] };
}
