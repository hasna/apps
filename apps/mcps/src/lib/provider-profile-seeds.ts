import type { UpsertProviderProfileOptions } from "../types.js";

export const DEFAULT_PROVIDER_PROFILE_SEEDS: UpsertProviderProfileOptions[] = [
  {
    id: "notion",
    displayName: "Notion",
    description: "Connect a Notion workspace so agents can search, read, create, and update workspace content.",
    endpoint: "https://mcp.notion.com/mcp",
    transport: "streamable-http",
    fallbackEndpoints: [
      {
        transport: "sse",
        url: "https://mcp.notion.com/sse",
        notes: "Fallback for clients that do not support Streamable HTTP.",
      },
    ],
    authType: "oauth2",
    authMetadata: {
      oauthVersion: "2.0",
      pkce: true,
      dynamicClientRegistration: true,
      bearerToken: "none",
      notes: "Remote Notion MCP uses OAuth with PKCE. Bearer-token authentication is only appropriate for self-hosted/local fallback deployments.",
    },
    tokenMode: "workspace",
    installFallback: {
      command: "npx",
      args: ["-y", "mcp-remote", "https://mcp.notion.com/sse", "--transport", "sse-only"],
      packageName: "mcp-remote",
      url: "https://mcp.notion.com/sse",
    },
    docsUrl: "https://developers.notion.com/guides/mcp/build-mcp-client",
    safety: {
      requiresApproval: true,
      dataClasses: ["workspace_content", "pages", "databases", "comments"],
      notes: "Connected agents operate with the authorizing user's workspace access. Human confirmation is recommended for write-capable workflows.",
    },
    provenance: {
      source: "curated",
      sourceUrl: "https://developers.notion.com/guides/mcp/build-mcp-client",
      verifiedAt: "2026-05-10",
    },
  },
  {
    id: "linear",
    displayName: "Linear",
    description: "Connect Linear so agents can find, create, and update issues, projects, comments, and related workspace objects.",
    endpoint: "https://mcp.linear.app/mcp",
    transport: "streamable-http",
    authType: "oauth2",
    authMetadata: {
      oauthVersion: "2.1",
      dynamicClientRegistration: true,
      bearerToken: "optional",
      notes: "Linear supports interactive OAuth 2.1 with dynamic client registration and optional Authorization: Bearer tokens for OAuth tokens or API keys.",
    },
    tokenMode: "workspace",
    installFallback: {
      command: "npx",
      args: ["-y", "mcp-remote", "https://mcp.linear.app/mcp"],
      packageName: "mcp-remote",
      url: "https://mcp.linear.app/mcp",
    },
    docsUrl: "https://linear.app/docs/mcp",
    safety: {
      requiresApproval: true,
      dataClasses: ["issues", "projects", "comments", "teams", "users"],
      notes: "Linear tools can create and update workspace objects, so write actions should be policy-gated by the platform.",
    },
    provenance: {
      source: "curated",
      sourceUrl: "https://linear.app/docs/mcp",
      verifiedAt: "2026-05-10",
    },
  },
];
