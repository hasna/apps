import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { getDatabase } from "../db/database.js"
import { getStorageStatus, parseStorageTables, pullStorageChanges, pushStorageChanges, syncStorageChanges } from "../db/storage-sync.js"

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] }
}

function err(error: unknown) {
  return {
    content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  }
}

export function registerPromptsStorageTools(server: McpServer): void {
  server.registerTool(
    "prompts_storage_status",
    {
      description: "Show prompts local database and remote storage sync status.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(getStorageStatus())
      } catch (error) {
        return err(error)
      }
    }
  )

  server.registerTool(
    "prompts_storage_push",
    {
      description: "Push local prompts data to remote PostgreSQL storage.",
      inputSchema: { tables: z.string().optional().describe("Comma-separated table names") },
    },
    async ({ tables }) => {
      try {
        return ok(await pushStorageChanges(parseStorageTables(tables)))
      } catch (error) {
        return err(error)
      }
    }
  )

  server.registerTool(
    "prompts_storage_pull",
    {
      description: "Pull remote PostgreSQL storage data into the local database.",
      inputSchema: { tables: z.string().optional().describe("Comma-separated table names") },
    },
    async ({ tables }) => {
      try {
        return ok(await pullStorageChanges(parseStorageTables(tables)))
      } catch (error) {
        return err(error)
      }
    }
  )

  server.registerTool(
    "prompts_storage_sync",
    {
      description: "Push local changes, then pull remote changes.",
      inputSchema: { tables: z.string().optional().describe("Comma-separated table names") },
    },
    async ({ tables }) => {
      try {
        return ok(await syncStorageChanges(parseStorageTables(tables)))
      } catch (error) {
        return err(error)
      }
    }
  )

  server.registerTool(
    "prompts_storage_feedback",
    {
      description: "Save feedback for prompts.",
      inputSchema: {
        message: z.string(),
        email: z.string().optional(),
        category: z.enum(["bug", "feature", "general"]).optional(),
      },
    },
    async ({ message, email, category }) => {
      try {
        const db = getDatabase()
        db.run(
          "INSERT INTO feedback (message, email, category, version) VALUES (?, ?, ?, ?)",
          [message, email || null, category || "general", "prompts"]
        )
        return ok({ saved: true })
      } catch (error) {
        return err(error)
      }
    }
  )
}
