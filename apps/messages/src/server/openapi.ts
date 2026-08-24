/**
 * OpenAPI document for messages-serve (/v1/openapi.json).
 * The ./sdk surface is described by this document.
 */
export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "@hasna/messages",
    description:
      "Direct agent-to-agent messaging with threads: send, thread, unread, close/reopen, per-recipient delivery state (stored | delivered | read). messages owns DMs + DM-threads only; channels are conversations' domain.",
    version: "0.1.0",
  },
  servers: [{ url: "/v1" }],
  paths: {
    "/auth/register": {
      post: {
        operationId: "registerAgent",
        summary: "Register (or return) an agent identity",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  display_name: { type: "string", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "The agent identity" },
          "400": { description: "name is required" },
        },
      },
    },
    "/agents": {
      get: {
        operationId: "listAgents",
        summary: "List registered agent identities",
        responses: { "200": { description: "Agents" } },
      },
    },
    "/messages": {
      post: {
        operationId: "sendMessage",
        summary: "Send a direct message (creates/continues a thread; recipient delivery state starts 'stored')",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["from", "to", "content"],
                properties: {
                  from: { type: "string" },
                  to: { type: "string" },
                  content: { type: "string" },
                  reply_to: { type: "string", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Message, thread and per-recipient deliveries" },
          "400": { description: "Validation error" },
          "401": { description: "Missing or invalid x-api-key" },
        },
      },
    },
    "/messages/receive": {
      get: {
        operationId: "receiveMessages",
        summary: "Drain the agent's inbox: stored -> delivered, returns the delivered messages",
        parameters: [
          { name: "agent", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Delivered messages" },
          "400": { description: "agent query parameter is required" },
        },
      },
    },
    "/messages/delivery": {
      get: {
        operationId: "deliveryStatus",
        summary: "Per-message per-recipient delivery state for a thread",
        parameters: [
          { name: "thread", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Delivery reports" },
          "400": { description: "thread query parameter is required" },
        },
      },
    },
    "/threads": {
      get: {
        operationId: "listThreads",
        summary: "List threads involving an agent, with unread counts",
        parameters: [
          { name: "agent", in: "query", required: true, schema: { type: "string" } },
          { name: "open_only", in: "query", required: false, schema: { type: "string", enum: ["0", "1"] } },
        ],
        responses: {
          "200": { description: "Thread summaries" },
          "400": { description: "agent query parameter is required" },
        },
      },
    },
    "/unread": {
      get: {
        operationId: "unreadThreads",
        summary: "Threads with unread messages for an agent (and the total)",
        parameters: [
          { name: "agent", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Unread threads + total" },
          "400": { description: "agent query parameter is required" },
        },
      },
    },
    "/threads/{threadId}": {
      get: {
        operationId: "expandThread",
        summary: "Expand a thread: messages with the requesting agent's delivery state (does NOT mark read)",
        parameters: [
          { name: "threadId", in: "path", required: true, schema: { type: "string" } },
          { name: "agent", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Thread, messages, unread count" },
          "400": { description: "Unknown thread or missing agent" },
        },
      },
    },
    "/threads/{threadId}/messages": {
      get: {
        operationId: "listThreadMessages",
        summary: "Full message history of a thread, oldest first",
        parameters: [
          { name: "threadId", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
        responses: {
          "200": { description: "Messages, oldest first" },
          "400": { description: "Unknown thread" },
        },
      },
    },
    "/threads/{threadId}/unread": {
      get: {
        operationId: "threadUnread",
        summary: "Unread count of a thread for an agent",
        parameters: [
          { name: "threadId", in: "path", required: true, schema: { type: "string" } },
          { name: "agent", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Unread count" } },
      },
    },
    "/threads/{threadId}/read": {
      post: {
        operationId: "markThreadRead",
        summary: "Mark a thread read from an agent's perspective (stored/delivered -> read)",
        parameters: [
          { name: "threadId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["agent"],
                properties: { agent: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "Marked read" } },
      },
    },
    "/threads/{threadId}/close": {
      post: {
        operationId: "closeThread",
        summary: "Close a thread from an agent's perspective",
        parameters: [
          { name: "threadId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["agent"],
                properties: { agent: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "The thread" } },
      },
    },
    "/threads/{threadId}/reopen": {
      post: {
        operationId: "reopenThread",
        summary: "Reopen a thread from an agent's perspective",
        parameters: [
          { name: "threadId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["agent"],
                properties: { agent: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "The thread" } },
      },
    },
    "/messages/{messageId}/read": {
      post: {
        operationId: "markMessageRead",
        summary: "Mark a single message read from an agent's perspective",
        parameters: [
          { name: "messageId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["agent"],
                properties: { agent: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "Marked read" } },
      },
    },
  },
} as const;
