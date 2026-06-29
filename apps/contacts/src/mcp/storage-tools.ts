import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { saveLocalFeedback } from "../db/feedback.js";
import { getStorageStatus } from "../db/storage.js";

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
  return {
    service: "contacts",
    mode: "local",
    remote_sync: {
      configured: false,
      reason: "Contacts no longer uses the deprecated shared cloud runtime. Use contacts-owned storage until repo-native remote sync is configured.",
    },
    storage: getStorageStatus(),
  };
}

function unsupportedCloudSync(operation: "push" | "pull") {
  return {
    ok: false,
    operation,
    service: "contacts",
    mode: "local",
    error: "Repo-native contacts remote sync is not configured in this package yet.",
    next: "Use contacts_storage_status to inspect local data.",
  };
}

export function registerContactsStorageTools(server: McpServer): void {
  server.tool(
    "contacts_storage_status",
    "Show contacts-owned local database storage status",
    {},
    async () => {
      try {
        return ok(getStorageStatus());
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
    "Report contacts remote push availability",
    { tables: z.string().optional().describe("Accepted for compatibility; remote sync is not configured") },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(unsupportedCloudSync("push"), null, 2) }],
      isError: true,
    })
  );

  server.tool(
    "contacts_cloud_pull",
    "Report contacts remote pull availability",
    { tables: z.string().optional().describe("Accepted for compatibility; remote sync is not configured") },
    async () => ({
      content: [{ type: "text" as const, text: JSON.stringify(unsupportedCloudSync("pull"), null, 2) }],
      isError: true,
    })
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
