import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { saveLocalFeedback } from "../db/feedback.js";
import { getStorageStatus } from "../db/storage.js";
import {
  CONTACTS_REMOTE_ENV,
  CONTACTS_REMOTE_TABLES,
  getRemoteDatabaseUrl,
  getRemoteStatus,
  pullRemote,
  pushRemote,
  syncRemote,
} from "../db/remote-sync.js";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

function cloudStatus() {
  const remote = getRemoteStatus();
  return {
    service: "contacts",
    mode: "local-first",
    remote_sync: {
      configured: Boolean(getRemoteDatabaseUrl()),
      env: CONTACTS_REMOTE_ENV,
      default_tables: remote.default_tables,
      sensitive_tables: remote.sensitive_tables,
      tables: CONTACTS_REMOTE_TABLES,
      sync: remote.sync,
      reason: getRemoteDatabaseUrl()
        ? "Contacts uses repo-owned PostgreSQL sync; the deprecated shared cloud runtime is not used."
        : "Set a contacts-owned PostgreSQL URL to enable sync; the deprecated shared cloud runtime is not used.",
    },
    storage: getStorageStatus(),
  };
}

function parseTables(tables?: string): string[] | undefined {
  if (!tables) return undefined;
  return tables.split(",").map((table) => table.trim()).filter(Boolean);
}

export function registerContactsStorageTools(server: McpServer): void {
  server.tool(
    "contacts_storage_status",
    "Show contacts-owned local database storage status",
    {},
    async () => {
      try {
        return ok({ mode: "local-first", local: getStorageStatus(), remote: getRemoteStatus() });
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "contacts_storage_push",
    "Push local contacts data to contacts-owned PostgreSQL storage",
    { tables: z.string().optional().describe("Comma-separated table names") },
    async ({ tables }) => {
      try {
        return ok(await pushRemote({ tables: parseTables(tables) }));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "contacts_storage_pull",
    "Pull contacts data from contacts-owned PostgreSQL storage",
    { tables: z.string().optional().describe("Comma-separated table names") },
    async ({ tables }) => {
      try {
        return ok(await pullRemote({ tables: parseTables(tables) }));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "contacts_storage_sync",
    "Bidirectional contacts sync: pull then push",
    { tables: z.string().optional().describe("Comma-separated table names") },
    async ({ tables }) => {
      try {
        return ok(await syncRemote({ tables: parseTables(tables) }));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "contacts_cloud_status",
    "Compatibility status for contacts-owned storage and remote sync availability",
    {},
    async () => {
      try {
        return ok(cloudStatus());
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "contacts_cloud_push",
    "Compatibility alias for contacts_storage_push",
    { tables: z.string().optional().describe("Comma-separated table names") },
    async ({ tables }) => {
      try {
        return ok(await pushRemote({ tables: parseTables(tables) }));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "contacts_cloud_pull",
    "Compatibility alias for contacts_storage_pull",
    { tables: z.string().optional().describe("Comma-separated table names") },
    async ({ tables }) => {
      try {
        return ok(await pullRemote({ tables: parseTables(tables) }));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "contacts_cloud_sync",
    "Compatibility alias for contacts_storage_sync",
    { tables: z.string().optional().describe("Comma-separated table names") },
    async ({ tables }) => {
      try {
        return ok(await syncRemote({ tables: parseTables(tables) }));
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "contacts_cloud_feedback",
    "Save contacts feedback locally",
    {
      message: z.string().describe("Feedback message"),
      email: z.string().optional().describe("Contact email"),
    },
    async ({ message, email }) => {
      try {
        return ok(saveLocalFeedback({ message, email, category: "general" }));
      } catch (error) {
        return err(error);
      }
    }
  );
}
