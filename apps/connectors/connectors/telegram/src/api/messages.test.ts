import { afterEach, describe, expect, mock, test } from "bun:test";
import { Telegram } from "./index";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Telegram messages API", () => {
  test("sends raw exclamation marks unless MarkdownV2 parse mode is requested", async () => {
    const fetchMock = mock(async (
      _input: string | URL | Request,
      _init?: RequestInit
    ) =>
      Response.json({
        ok: true,
        result: {
          message_id: 123,
          date: 1,
          chat: { id: -5116827222, type: "group" },
          text: "Hi! test",
        },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const telegram = new Telegram({ botToken: "123:test" });
    await telegram.messages.sendMessage({
      chatId: -5116827222,
      text: "Hi! test",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      chat_id: -5116827222,
      text: "Hi! test",
    });
    expect(JSON.parse(String(request.body))).not.toHaveProperty("parse_mode");
  });

  test("preserves raw text when HTML parse mode is explicit", async () => {
    const fetchMock = mock(async (
      _input: string | URL | Request,
      _init?: RequestInit
    ) =>
      Response.json({
        ok: true,
        result: {
          message_id: 124,
          date: 1,
          chat: { id: -5116827222, type: "group" },
          text: "Hi! <b>test</b>",
        },
      })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const telegram = new Telegram({ botToken: "123:test" });
    await telegram.messages.sendMessage({
      chatId: -5116827222,
      text: "Hi! <b>test</b>",
      parseMode: "HTML",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      chat_id: -5116827222,
      text: "Hi! <b>test</b>",
      parse_mode: "HTML",
    });
  });
});
