/**
 * Test endpoint definitions for verifying API credentials.
 * Each entry maps a connector name to its health-check endpoint.
 */

export interface TestEndpoint {
  url: string;
  method?: string;
  headers: (key: string) => Record<string, string>;
  /** Expected successful status codes */
  successCodes?: number[];
}

export const TEST_ENDPOINTS: Record<string, TestEndpoint> = {
  anthropic: {
    url: "https://api.anthropic.com/v1/models",
    headers: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  openai: {
    url: "https://api.openai.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  xai: {
    url: "https://api.x.ai/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  mistral: {
    url: "https://api.mistral.ai/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  github: {
    url: "https://api.github.com/user",
    headers: (key) => ({ Authorization: `Bearer ${key}`, "User-Agent": "connectors-cli" }),
  },
  stripe: {
    url: "https://api.stripe.com/v1/balance",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  figma: {
    url: "https://api.figma.com/v1/me",
    headers: (key) => ({ "X-Figma-Token": key }),
  },
  discord: {
    url: "https://discord.com/api/v10/users/@me",
    headers: (key) => ({ Authorization: `Bot ${key}` }),
  },
  resend: {
    url: "https://api.resend.com/domains",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  notion: {
    url: "https://api.notion.com/v1/users/me",
    headers: (key) => ({ Authorization: `Bearer ${key}`, "Notion-Version": "2022-06-28" }),
  },
  exa: {
    url: "https://api.exa.ai/search",
    method: "POST",
    headers: (key) => ({ "x-api-key": key, "Content-Type": "application/json" }),
  },
  sentry: {
    url: "https://sentry.io/api/0/",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  huggingface: {
    url: "https://huggingface.co/api/whoami-v2",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  elevenlabs: {
    url: "https://api.elevenlabs.io/v1/user",
    headers: (key) => ({ "xi-api-key": key }),
  },
  cloudflare: {
    url: "https://api.cloudflare.com/client/v4/user/tokens/verify",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  mixpanel: {
    url: "https://mixpanel.com/api/app/me",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
};
