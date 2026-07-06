/**
 * Test endpoint definitions for verifying API credentials.
 * Each entry maps a connector name to its health-check endpoint.
 *
 * Guidelines for choosing test endpoints:
 * - Use the lightest GET endpoint available (e.g., /me, /user, /balance)
 * - Avoid endpoints that mutate data
 * - For POST-only APIs, use the smallest possible request body
 * - OAuth connectors (Google) use Bearer token auth from tokens.json
 */

export interface TestEndpoint {
  url: string;
  method?: string;
  headers: (key: string) => Record<string, string>;
  /** Optional body for POST requests (JSON-serializable) */
  body?: unknown;
  /** Expected successful status codes */
  successCodes?: number[];
}

export const TEST_ENDPOINTS: Record<string, TestEndpoint> = {
  // ── AI & ML ──────────────────────────────────────────────
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
  googlegemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: (key) => ({}),
    // Gemini uses ?key= query param, handled via url rewrite in test command
    // Append key as query param: url + `?key=${key}`
  },
  huggingface: {
    url: "https://huggingface.co/api/whoami-v2",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  stabilityai: {
    url: "https://api.stability.ai/v1/user/account",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  heygen: {
    url: "https://api.heygen.com/v2/user/remaining_quota",
    headers: (key) => ({ "X-Api-Key": key }),
  },
  elevenlabs: {
    url: "https://api.elevenlabs.io/v1/user",
    headers: (key) => ({ "xi-api-key": key }),
  },
  reducto: {
    url: "https://platform.reducto.ai/health",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    successCodes: [200, 204],
  },
  tinker: {
    url: "https://api.tinker.com/v1/models",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  tomtom: {
    // TomTom uses API key as query param
    url: "https://api.tomtom.com/search/2/geocode/test.json",
    headers: () => ({}),
    // Key appended as ?key= query param in the test command
  },

  // ── Developer Tools ──────────────────────────────────────
  github: {
    url: "https://api.github.com/user",
    headers: (key) => ({ Authorization: `Bearer ${key}`, "User-Agent": "connectors-cli" }),
  },
  docker: {
    url: "https://hub.docker.com/v2/user/self",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  sentry: {
    url: "https://sentry.io/api/0/",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  testim: {
    url: "https://api.testim.io/tests",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  cloudflare: {
    url: "https://api.cloudflare.com/client/v4/user/tokens/verify",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  e2b: {
    url: "https://api.e2b.dev/health",
    headers: (key) => ({ "X-API-Key": key }),
    successCodes: [200, 204],
  },
  firecrawl: {
    url: "https://api.firecrawl.dev/v1/crawl",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    // Use a GET to the base crawl endpoint; 401 = bad key, 405/200 = key works
    successCodes: [200, 405],
  },

  // ── Design & Content ─────────────────────────────────────
  figma: {
    url: "https://api.figma.com/v1/me",
    headers: (key) => ({ "X-Figma-Token": key }),
  },
  webflow: {
    url: "https://api.webflow.com/v2/token/introspect",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  icons8: {
    url: "https://api-icons.icons8.com/publicApi/icons?amount=1&term=test",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },

  // ── Communication ────────────────────────────────────────
  gmail: {
    url: "https://gmail.googleapis.com/gmail/v1/users/me/profile",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  discord: {
    url: "https://discord.com/api/v10/users/@me",
    headers: (key) => ({ Authorization: `Bot ${key}` }),
  },
  twilio: {
    // Twilio uses Basic auth with AccountSID:AuthToken
    // The key is expected to be "SID:TOKEN" format
    url: "https://api.twilio.com/2010-04-01/Accounts.json",
    headers: (key) => ({ Authorization: `Basic ${Buffer.from(key).toString("base64")}` }),
  },
  resend: {
    url: "https://api.resend.com/domains",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  zoom: {
    url: "https://api.zoom.us/v2/users/me",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },

  // ── Social Media ─────────────────────────────────────────
  reddit: {
    url: "https://oauth.reddit.com/api/v1/me",
    headers: (key) => ({ Authorization: `Bearer ${key}`, "User-Agent": "connectors-cli/1.0" }),
  },
  meta: {
    url: "https://graph.facebook.com/v19.0/me",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  youtube: {
    url: "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  twitch: {
    url: "https://api.twitch.tv/helix/users",
    headers: (key) => ({
      Authorization: `Bearer ${key}`,
      "Client-Id": process.env.TWITCH_CLIENT_ID || "",
    }),
  },

  // ── Commerce & Finance ───────────────────────────────────
  stripe: {
    url: "https://api.stripe.com/v1/balance",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  shopify: {
    // Shopify Admin API requires the store domain, so we test the GraphQL endpoint
    // The key should be the access token; store-specific URLs are set in env
    url: "https://shopify.dev/admin/api/2024-01/shop.json",
    headers: (key) => ({ "X-Shopify-Access-Token": key }),
    successCodes: [200, 302],
  },
  revolut: {
    url: "https://b2b.revolut.com/api/1.0/accounts",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  mercury: {
    url: "https://api.mercury.com/api/v1/accounts",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  pandadoc: {
    url: "https://api.pandadoc.com/public/v1/documents?count=1",
    headers: (key) => ({ Authorization: `API-Key ${key}` }),
  },

  // ── Google Workspace (OAuth — use access token) ──────────
  google: {
    url: "https://www.googleapis.com/oauth2/v2/userinfo",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  googledrive: {
    url: "https://www.googleapis.com/drive/v3/about?fields=user",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  googledocs: {
    // Google Docs API requires a document ID, so we test via Drive which shares the scope
    url: "https://www.googleapis.com/drive/v3/about?fields=user",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  googlesheets: {
    // Similar to Docs — test via Drive about endpoint which validates the token
    url: "https://www.googleapis.com/drive/v3/about?fields=user",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  googlecalendar: {
    url: "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  googletasks: {
    url: "https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  googlecontacts: {
    url: "https://people.googleapis.com/v1/people/me?personFields=names",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  googlemaps: {
    // Google Maps uses API key as query param, not Bearer token
    url: "https://maps.googleapis.com/maps/api/geocode/json?address=test",
    headers: () => ({}),
    // Key appended as query param in the test command
  },

  // ── Data & Analytics ─────────────────────────────────────
  exa: {
    url: "https://api.exa.ai/search",
    method: "POST",
    headers: (key) => ({ "x-api-key": key, "Content-Type": "application/json" }),
    body: { query: "test", numResults: 1 },
  },
  mixpanel: {
    url: "https://mixpanel.com/api/app/me",
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  openweathermap: {
    // OpenWeatherMap uses API key as query param
    url: "https://api.openweathermap.org/data/2.5/weather?q=London",
    headers: () => ({}),
    // Key appended as &appid= query param in the test command
  },
  "triple-whale": {
    url: "https://api.triplewhale.com/api/v2/users/api-keys/me",
    headers: (key) => ({ "x-api-key": key }),
  },

  // ── Business Tools ───────────────────────────────────────
  notion: {
    url: "https://api.notion.com/v1/users/me",
    headers: (key) => ({ Authorization: `Bearer ${key}`, "Notion-Version": "2022-06-28" }),
  },

  // ── Patents & IP ─────────────────────────────────────────
  uspto: {
    // USPTO public API (no auth required for basic search, but tests connectivity)
    url: "https://developer.uspto.gov/ibd-api/v1/application/publications?searchText=test&start=0&rows=1",
    headers: () => ({}),
    successCodes: [200],
  },
};

/**
 * Connectors intentionally excluded from test endpoints:
 *
 * - midjourney:    No public REST API (Discord bot-based)
 * - hedra:         No public health-check endpoint documented
 * - aws:           Uses SigV4 signing, not simple Bearer/API key
 * - googlecloud:   Uses service account JSON, not simple key
 * - shadcn:        Local/npm registry, no auth needed
 * - wix:           OAuth-only with complex flow, no simple test
 * - maropost:      Account-specific base URL required
 * - x:             OAuth 2.0 with complex auth flow
 * - substack:      No public API
 * - snap:          OAuth-only with complex flow
 * - tiktok:        OAuth-only with complex flow
 * - stripeatlas:   No separate API (part of Stripe)
 * - brandsight:    Custom/internal API
 * - quo:           Custom/internal API
 * - sedo:          Custom/internal API with account-specific URL
 * - xads:          OAuth 2.0 with complex multi-step auth
 */
