import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RemoteSkillsAuthClient } from "../lib/remote-auth.js";
import { getApiUrl } from "../lib/auth-store.js";
import { REMOTE_CUSTOMER_OPERATIONS } from "../lib/remote-customer-operations.js";
import { createRemoteSkillsClient, RemoteCapabilityUnavailableError, RemoteWorkspaceMemberError, type RemoteSkillsClient } from "../lib/remote-client.js";
import { mcpError, mcpJson } from "./helpers.js";

export function registerRemoteCustomerTools(server: McpServer) {
  const memberRole = z.enum(["owner", "admin", "member", "viewer"]);
  const memberInput = { membershipId: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
    expectedRole: memberRole, email: z.string().email(), code: z.string().regex(/^\d{6}$/) };
  server.registerTool("set_workspace_member_role", {
    title: "Set Current Workspace Member Role",
    description: "Change exactly this membership incarnation with its observed expectedRole and fresh verification. The server enforces owner/admin policy. No automatic refresh or retry; saved credentials stay unchanged.",
    inputSchema: z.object({ ...memberInput, role: memberRole }).strict(),
  }, async ({ membershipId, role, expectedRole, email, code }) => {
    try { return mcpJson(await new RemoteSkillsAuthClient(getApiUrl("Set workspace member role")).setWorkspaceMemberRole(email, code, membershipId, { role, expectedRole })); }
    catch (error) { return memberError(error); }
  });
  server.registerTool("remove_workspace_member", {
    title: "Remove Current Workspace Member",
    description: "Remove exactly this membership incarnation using its observed expectedRole and fresh verification. Self-removal is unavailable. A retry cannot remove a later replacement membership; saved credentials stay unchanged.",
    inputSchema: z.object(memberInput).strict(),
  }, async ({ membershipId, expectedRole, email, code }) => {
    try { return mcpJson(await new RemoteSkillsAuthClient(getApiUrl("Remove workspace member")).removeWorkspaceMember(email, code, membershipId, { expectedRole })); }
    catch (error) { return memberError(error); }
  });
  server.registerTool("list_workspace_members", {
    title: "List Current Workspace Members",
    description: "Read one roster page on the selected Skills server using fresh owner/admin email verification. Saved credentials are unchanged. This does not invite, change or switch members/workspaces.",
    inputSchema: z.object({ email: z.string().email(), code: z.string().regex(/^\d{6}$/),
      limit: z.number().int().min(1).max(100).optional(), cursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/).optional() }).strict(),
  }, async ({ email, code, limit, cursor }) => {
    try {
      return mcpJson(await new RemoteSkillsAuthClient(getApiUrl("List workspace members")).listWorkspaceMembers(email, code, { limit, cursor }));
    } catch {
      return mcpError("WORKSPACE_MEMBERS_FAILED", "Unable to list workspace members. Check the selected server, owner/admin permissions, pagination and fresh verification code.");
    }
  });
  for (const kind of ["profile", "workspace"] as const) {
    server.registerTool(kind === "profile" ? "update_account_profile" : "update_workspace_name", {
      title: kind === "profile" ? "Update Account Display Name" : "Update Workspace Name",
      description: "Update only the name on the explicitly selected Skills server using fresh email OTP. Workspace changes require an owner/admin. Saved credentials are unchanged.",
      inputSchema: z.object({ name: z.string().min(1), email: z.string().email(), code: z.string().regex(/^\d{6}$/) }).strict(),
    }, async ({ name, email, code }) => {
      try {
        const client = new RemoteSkillsAuthClient(getApiUrl("Update customer name"));
        return mcpJson(kind === "profile" ? await client.updateProfile(email, code, { displayName: name })
          : await client.updateCurrentWorkspace(email, code, { name }));
      } catch {
        return mcpError("NAME_UPDATE_FAILED", "Unable to update the name. Check the selected server, name, permissions and fresh verification code.");
      }
    });
  }
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

function memberError(error: unknown) {
  return error instanceof RemoteWorkspaceMemberError ? mcpError(error.code, error.message)
    : mcpError("WORKSPACE_MEMBER_FAILED", "Unable to manage workspace member. Check the selected server and fresh verification, then refresh the roster before another action.");
}

async function callRemote(action: (client: RemoteSkillsClient) => Promise<unknown>) {
  try {
    const client = await createRemoteSkillsClient();
    if (!client) return mcpError("AUTH_REQUIRED", "Configure a Skills API and sign in with skills auth login");
    return mcpJson(await action(client));
  } catch (error) {
    if (error instanceof RemoteCapabilityUnavailableError) {
      return { ...mcpJson({ code: error.code, message: error.message, status: error.status }), isError: true };
    }
    return mcpError("REMOTE_REQUEST_FAILED", error instanceof Error ? error.message : "Skills server request failed");
  }
}
