import { afterEach, describe, expect, mock, test } from "bun:test";
import { executeConnectorOperation } from "../connector.js";
import { imessageConnector } from "./imessage.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.IMESSAGE_API_KEY;
  delete process.env.IMESSAGE_BRIDGE_URL;
  delete process.env.IMESSAGE_DEVICE_ID;
});

describe("imessageConnector", () => {
  test("executes normalized conversation:list operations against the bridge", async () => {
    const fetchMock = mock((input: RequestInfo | URL) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            conversations: [
              {
                id: "chat-1",
                participants: ["+15551234567"],
                unreadCount: 2,
                lastMessageText: "see you soon",
              },
            ],
            nextCursor: "cursor-2",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeConnectorOperation(imessageConnector, {
      operation: "conversation:list",
      credentials: {
        bridgeUrl: "https://bridge.example",
        apiKey: "bridge-key",
      },
      input: {
        limit: 25,
        unreadOnly: true,
      },
    });

    expect(result).toEqual({
      items: [
        {
          id: "chat-1",
          participants: ["+15551234567"],
          unreadCount: 2,
          lastMessageText: "see you soon",
        },
      ],
      nextCursor: "cursor-2",
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://bridge.example/conversations");
    expect(url.searchParams.get("limit")).toBe("25");
    expect(url.searchParams.get("unreadOnly")).toBe("true");
  });

  test("executes normalized message:reply operations", async () => {
    process.env.IMESSAGE_BRIDGE_URL = "https://bridge.example";
    process.env.IMESSAGE_DEVICE_ID = "device-main";

    const fetchMock = mock((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            message: {
              id: "reply-1",
              conversationId: "chat-1",
              text: "on it",
              status: "queued",
              direction: "outbound",
              replyToMessageId: "msg-9",
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await executeConnectorOperation(imessageConnector, {
      operation: "message:reply",
      input: {
        conversationId: "chat-1",
        text: "on it",
        replyToMessageId: "msg-9",
      },
    });

    expect(result).toMatchObject({
      id: "reply-1",
      conversationId: "chat-1",
      text: "on it",
      status: "queued",
      direction: "outbound",
      replyToMessageId: "msg-9",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(request.headers).toBeInstanceOf(Headers);
    expect((request.headers as Headers).get("X-Device-Id")).toBe("device-main");
    expect(request.body).toBe(
      JSON.stringify({
        conversationId: "chat-1",
        text: "on it",
        replyToMessageId: "msg-9",
        deviceId: "device-main",
      })
    );
  });
});
