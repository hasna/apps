/**
 * OpenAPI document for messages-serve (/v1/openapi.json).
 * The ./sdk surface is generated from this document.
 */
export const openapi = {
  openapi: "3.0.3",
  info: {
    title: "@hasna/messages",
    description: "Direct agent-to-agent messaging with threads.",
    version: "0.1.0",
  },
  servers: [{ url: "/v1" }],
  paths: {
    "/messages": {
      post: {
        operationId: "sendMessage",
        summary: "Send a direct message from one agent to another",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["from", "to", "content"],
                properties: {
                  from: { type: "string", description: "Sending agent" },
                  to: { type: "string", description: "Receiving agent" },
                  content: { type: "string" },
                  reply_to: { type: "string", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Message and thread" },
          "400": { description: "Validation error" },
          "401": { description: "Missing or invalid x-api-key" },
        },
      },
    },
    "/threads": {
      get: {
        operationId: "listThreads",
        summary: "List threads involving an agent, with unread counts",
        parameters: [
          { name: "agent", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Thread summaries" },
          "400": { description: "agent query parameter is required" },
        },
      },
    },
    "/threads/{threadId}/messages": {
      get: {
        operationId: "listThreadMessages",
        summary: "Full message history of a thread",
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
    "/threads/{threadId}/read": {
      post: {
        operationId: "markThreadRead",
        summary: "Mark a thread read from an agent's perspective",
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
        responses: {
          "200": { description: "Marked read" },
          "400": { description: "agent is required or unknown thread" },
        },
      },
    },
  },
} as const;
