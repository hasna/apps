/**
 * Headless agent-native boundary definitions for @hasna/todos.
 * OSS stays local-first: CLI/MCP/SDK are primary; the optional local dashboard
 * may mutate via localhost API only — never hosted auth or platform-todos APIs.
 */

export const HEADLESS_BOUNDARY_VERSION = "todos.headless-boundary.v1";

export interface HeadlessBoundaryManifest {
  schema_version: typeof HEADLESS_BOUNDARY_VERSION;
  agent_native: true;
  hosted_auth: false;
  hosted_mutation: false;
  browser_mutations: "local_admin_only";
  primary_surfaces: ["cli", "mcp", "sdk"];
  optional_surfaces: ["local_dashboard"];
  local_api_only: true;
  forbidden_remote_hosts: string[];
  notes: string[];
}

export const FORBIDDEN_HOSTED_HOSTS = [
  "todos.md",
  "www.todos.md",
  "preview.todos.md",
  "pay.hasna.tools",
  "platform-todos",
] as const;

export const FORBIDDEN_WEB_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "hosted todos.md API", pattern: /https?:\/\/(?:www\.)?todos\.md/i },
  { name: "platform-todos package", pattern: /@hasnastudio\/platform-todos|hasnastudio\/platform-todos/i },
  { name: "browser sign-in flow", pattern: /\/sign-?in\b|\/login\b.*(?:oauth|session|auth)/i },
  { name: "Stripe billing UI", pattern: /\bstripe\.(?:com|js)\b|\bcheckout\.sessions?\b/i },
  { name: "hosted OAuth redirect", pattern: /oauth.*redirect.*todos\.md/i },
];

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Returns true when URL targets the local todos serve API (same machine). */
export function isAllowedLocalApiUrl(urlString: string, port = 19427): boolean {
  if (urlString.startsWith("/api/")) return true;
  try {
    const url = new URL(urlString, `http://127.0.0.1:${port}`);
    if (!LOCAL_HOSTS.has(url.hostname)) return false;
    return url.pathname.startsWith("/api/");
  } catch {
    return false;
  }
}

/** Throws if an outbound URL targets a forbidden hosted/platform surface. */
export function assertHeadlessOutboundUrl(urlString: string): void {
  for (const host of FORBIDDEN_HOSTED_HOSTS) {
    if (urlString.toLowerCase().includes(host.toLowerCase())) {
      throw new Error(`Headless boundary violation: outbound URL targets forbidden host "${host}"`);
    }
  }
  for (const rule of FORBIDDEN_WEB_PATTERNS) {
    if (rule.pattern.test(urlString)) {
      throw new Error(`Headless boundary violation: ${rule.name}`);
    }
  }
}

export function scanSourceForForbiddenWebPatterns(label: string, source: string): string[] {
  const matches: string[] = [];
  for (const rule of FORBIDDEN_WEB_PATTERNS) {
    const match = rule.pattern.exec(source);
    if (match) matches.push(`${label}: ${rule.name}: ${match[0]}`);
  }
  return matches;
}

export function getHeadlessBoundaryManifest(): HeadlessBoundaryManifest {
  return {
    schema_version: HEADLESS_BOUNDARY_VERSION,
    agent_native: true,
    hosted_auth: false,
    hosted_mutation: false,
    browser_mutations: "local_admin_only",
    primary_surfaces: ["cli", "mcp", "sdk"],
    optional_surfaces: ["local_dashboard"],
    local_api_only: true,
    forbidden_remote_hosts: [...FORBIDDEN_HOSTED_HOSTS],
    notes: [
      "Use todos CLI or todos-mcp for agent workflows.",
      "todos serve exposes a local-only REST API on 127.0.0.1 — not a hosted SaaS.",
      "Cloud sync via @hasna/cloud is explicit opt-in from CLI/MCP, never from the dashboard.",
    ],
  };
}
