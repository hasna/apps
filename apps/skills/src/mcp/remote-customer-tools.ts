import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RemoteSkillsAuthClient } from "../lib/remote-auth.js";
import { getApiUrl } from "../lib/auth-store.js";
import { REMOTE_CUSTOMER_OPERATIONS } from "../lib/remote-customer-operations.js";
import { createRemoteSkillsClient, type RemoteSkillsClient } from "../lib/remote-client.js";
import { mcpError, mcpJson } from "./helpers.js";

export function registerRemoteCustomerTools(server: McpServer) {
  for (const operation of REMOTE_CUSTOMER_OPERATIONS) {
    const inputSchema: Record<string, ReturnType<typeof z.string>> = {};
    if (operation.parameter) inputSchema[operation.parameter] = z.string().min(1);
    server.registerTool(operation.name, {
      title: operation.title,
      description: `${operation.title} on the explicitly configured Skills server. Missing server capabilities return an error. Checkout links require external customer confirmation.`,
      inputSchema,
    }, async (input: Record<string, unknown>) => callRemote(client => operation.invoke(client, operation.parameter ? String(input[operation.parameter]) : "")));
  }
  server.registerTool("list_api_keys", {
    title: "List API Keys", description: "List account API keys using fresh email OTP reauthentication.",
    inputSchema: { email: z.string().email(), code: z.string().regex(/^\d{6}$/) },
  }, async ({ email, code }) => {
    try { return mcpJson(await new RemoteSkillsAuthClient(getApiUrl("List API keys")).listApiKeys(email, code)); }
    catch (error) { return mcpError("KEY_LIST_FAILED", (error as Error).message); }
  });
  server.registerTool("revoke_api_key", {
    title: "Revoke API Key", description: "Revoke an account API key using fresh email OTP reauthentication.",
    inputSchema: { key_id: z.string().min(1), email: z.string().email(), code: z.string().regex(/^\d{6}$/) },
  }, async ({ key_id, email, code }) => {
    try { return mcpJson(await new RemoteSkillsAuthClient(getApiUrl("Revoke API key")).revokeApiKey(email, code, key_id)); }
    catch (error) { return mcpError("KEY_REVOKE_FAILED", (error as Error).message); }
  });
  server.registerTool("create_api_key", {
    title: "Create API Key", description: "Create an API key using fresh email OTP reauthentication; returns its secret once. A stored API key cannot grant this authority.",
    inputSchema: { name: z.string().min(1), email: z.string().email(), code: z.string().regex(/^\d{6}$/), scopes: z.array(z.string()).optional() },
  }, async ({ name, email, code, scopes }) => {
    try { return mcpJson(await new RemoteSkillsAuthClient(getApiUrl("Create API key")).createApiKey(email, code, name, scopes)); }
    catch (error) { return mcpError("KEY_CREATION_FAILED", (error as Error).message); }
  });
  server.registerTool("quote_skill", {
    title: "Quote Remote Skill", description: "Get the configured server's credit quote without submitting a run.",
    inputSchema: { name: z.string(), input: z.record(z.string(), z.unknown()).optional(), args: z.array(z.string()).optional() },
  }, ({ name, input, args }) => callRemote(client => client.quoteRun(name, input, args)));
  server.registerTool("download_run_artifact", {
    title: "Download Verified Run Artifact", description: "Return verified artifact bytes as base64 (at most 1 MiB); use the CLI for larger files.",
    inputSchema: { run_id: z.string(), artifact_id: z.string() },
  }, ({ run_id, artifact_id }) => callRemote(async client => {
    const artifact = await client.getVerifiedRunArtifact(run_id, artifact_id, 1024 * 1024);
    const { bytes, ...metadata } = artifact;
    return { ...metadata, base64: Buffer.from(bytes).toString("base64") };
  }));
}

async function callRemote(action: (client: RemoteSkillsClient) => Promise<unknown>) {
  try {
    const client = await createRemoteSkillsClient();
    if (!client) return mcpError("AUTH_REQUIRED", "Configure a Skills API and sign in with skills auth login");
    return mcpJson(await action(client));
  } catch (error) {
    return mcpError("REMOTE_REQUEST_FAILED", error instanceof Error ? error.message : "Skills server request failed");
  }
}
