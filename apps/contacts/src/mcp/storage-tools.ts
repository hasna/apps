import { createRequire } from "node:module";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getStore } from "../store/index.js";
import { resolveClientTransport } from "../cloud/http-storage.js";

// Storage/cloud MCP tools.
//
// The forbidden client-side Postgres-DSN sync tools (contacts_storage_push /
// _pull / _sync and their cloud_* aliases) have been removed: clients NEVER hold
// the raw RDS DSN. Cloud reads/writes flow through the ApiStore (HTTPS /v1 +
// bearer key). These tools are read-only transport/status plus feedback, and
// they route EVERYTHING through the single Store — no tool touches the db/*
// layer or raw SQLite directly.

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

/** Client-flip transport status WITHOUT exposing any secret value. */
function transportStatus() {
  const resolution = resolveClientTransport("contacts");
  return {
    transport: resolution.transport,
    mode: resolution.mode,
    mode_source: resolution.modeSource,
    api_base_url: resolution.baseUrl,
    api_key_present: resolution.apiKeyPresent,
    misconfigured: resolution.misconfigured,
    warning: resolution.warning,
  };
}

export function registerContactsStorageTools(server: McpServer): void {
  server.tool(
    "contacts_storage_status",
    "Show contacts storage transport (local vs cloud-http) and local database status",
    {},
    async () => {
      try {
        return ok({ transport: transportStatus(), local: await getStore().storageStatus() });
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "contacts_cloud_status",
    "Show contacts cloud (self_hosted) transport status",
    {},
    async () => {
      try {
        return ok({ service: "contacts", transport: transportStatus(), storage: await getStore().storageStatus() });
      } catch (error) {
        return err(error);
      }
    }
  );

  server.tool(
    "contacts_cloud_feedback",
    "Save contacts feedback through the active storage (local db, or the /v1 API in self_hosted mode)",
    {
      message: z.string().describe("Feedback message"),
      email: z.string().optional().describe("Contact email"),
    },
    async ({ message, email }) => {
      try {
        const store = getStore();
        await store.saveFeedback(message, email ?? null, "general", pkg.version);
        return ok({ saved: true, mode: store.mode });
      } catch (error) {
        return err(error);
      }
    }
  );
}
