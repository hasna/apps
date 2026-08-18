// MCP tools for @hasna/tenants. Each tool is a thin, truthful wrapper over the
// shipped TenantsClient SDK surface (src/sdk/client.ts) — no domain logic is
// duplicated here, and no credential values are read or printed: the client
// sends the API key in the x-api-key header exactly as the SDK does.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TenantsClient } from "../sdk/client.js";

export interface TenantsMcpToolOptions {
  /** Prebuilt client (test injection). Defaults to a client resolved from
   * HASNA_TENANTS_API_URL / HASNA_TENANTS_API_KEY. */
  client?: TenantsClient;
}

export function resolveTenantsClient(options: TenantsMcpToolOptions = {}): TenantsClient {
  if (options.client) return options.client;
  return new TenantsClient({
    baseUrl: process.env.HASNA_TENANTS_API_URL ?? "http://127.0.0.1:15460",
    apiKey: process.env.HASNA_TENANTS_API_KEY,
  });
}

function jsonText(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function registerTenantsMcpTools(server: McpServer, options: TenantsMcpToolOptions = {}): void {
  const client = resolveTenantsClient(options);

  server.tool(
    "tenants_signup",
    "Create a new user account (and optionally an org/tenant)",
    {
      email: z.string().describe("Account email"),
      name: z.string().optional().describe("Display name"),
      kind: z.enum(["human", "agent"]).optional().describe("Principal kind"),
      org_name: z.string().optional().describe("Organization name for a new tenant"),
      password: z.string().optional().describe("Password (leave empty for OTP/email flows)"),
    },
    async (args) =>
      jsonText(
        await client.signup({
          email: args.email,
          name: args.name,
          kind: args.kind,
          org_name: args.org_name,
          password: args.password,
        }),
      ),
  );

  server.tool(
    "tenants_login",
    "Start a login flow (password or OTP challenge)",
    { email: z.string().describe("Account email"), password: z.string().optional().describe("Password") },
    async (args) => jsonText(await client.login({ email: args.email, password: args.password })),
  );

  server.tool(
    "tenants_verify_otp",
    "Verify an OTP code from a login or signup challenge",
    { email: z.string().describe("Account email"), code: z.string().describe("One-time code") },
    async (args) => jsonText(await client.verifyOtp({ email: args.email, code: args.code })),
  );

  server.tool(
    "tenants_issue_token",
    "Issue a signed access token / API key for an app",
    {
      app: z.string().describe("App name (e.g. tenants, todos)"),
      scopes: z.array(z.string()).optional().describe("Scopes to request"),
      tenant_id: z.string().optional().describe("Tenant scope"),
      ttl_seconds: z.number().optional().describe("Token lifetime in seconds"),
    },
    async (args) =>
      jsonText(
        await client.issueToken({
          app: args.app,
          scopes: args.scopes,
          tenant_id: args.tenant_id,
          ttlSeconds: args.ttl_seconds,
        }),
      ),
  );

  server.tool(
    "tenants_whoami",
    "Resolve the current session principal and its tenant memberships",
    {},
    async () => jsonText(await client.whoami()),
  );

  server.tool(
    "tenants_introspect",
    "Verify a token by key id",
    { kid: z.string().describe("Key id from the token header") },
    async (args) => jsonText(await client.introspect({ kid: args.kid })),
  );

  server.tool("tenants_jwks", "Fetch the JWKS key set for offline token verification", {}, async () => jsonText(await client.getJwks()));
}
