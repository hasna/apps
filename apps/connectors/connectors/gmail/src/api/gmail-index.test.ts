import { describe, test, expect } from "bun:test";
import { Gmail } from "./index";

describe("Gmail index wiring", () => {
  test("exposes all API modules on the instance", () => {
    const client = { get: async () => ({}), post: async () => ({}) } as never;
    const gmail = new Gmail(client);

    for (const moduleName of [
      "messages",
      "labels",
      "threads",
      "profile",
      "drafts",
      "filters",
      "attachments",
      "export",
      "bulk",
      "history",
      "settings",
      "watch",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(gmail, moduleName)).toBe(true);
      expect((gmail as unknown as Record<string, unknown>)[moduleName]).toBeTruthy();
    }
  });

  test("fromEnv throws when required env vars are missing", () => {
    const previous = {
      access: process.env.GMAIL_ACCESS_TOKEN,
      refresh: process.env.GMAIL_REFRESH_TOKEN,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
    };

    delete process.env.GMAIL_ACCESS_TOKEN;
    delete process.env.GMAIL_REFRESH_TOKEN;
    delete process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_SECRET;

    try {
      expect(() => Gmail.fromEnv()).toThrow("Missing Gmail env vars");
    } finally {
      if (previous.access !== undefined) process.env.GMAIL_ACCESS_TOKEN = previous.access;
      else delete process.env.GMAIL_ACCESS_TOKEN;
      if (previous.refresh !== undefined) process.env.GMAIL_REFRESH_TOKEN = previous.refresh;
      else delete process.env.GMAIL_REFRESH_TOKEN;
      if (previous.clientId !== undefined) process.env.GMAIL_CLIENT_ID = previous.clientId;
      else delete process.env.GMAIL_CLIENT_ID;
      if (previous.clientSecret !== undefined) process.env.GMAIL_CLIENT_SECRET = previous.clientSecret;
      else delete process.env.GMAIL_CLIENT_SECRET;
    }
  });

  test("fromEnv accepts static access token only", () => {
    const previous = {
      access: process.env.GMAIL_ACCESS_TOKEN,
      refresh: process.env.GMAIL_REFRESH_TOKEN,
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
    };

    process.env.GMAIL_ACCESS_TOKEN = "static-access-token";
    delete process.env.GMAIL_REFRESH_TOKEN;
    delete process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_SECRET;

    try {
      const gmail = Gmail.fromEnv();
      expect(gmail).toBeInstanceOf(Gmail);
    } finally {
      if (previous.access !== undefined) process.env.GMAIL_ACCESS_TOKEN = previous.access;
      else delete process.env.GMAIL_ACCESS_TOKEN;
      if (previous.refresh !== undefined) process.env.GMAIL_REFRESH_TOKEN = previous.refresh;
      else delete process.env.GMAIL_REFRESH_TOKEN;
      if (previous.clientId !== undefined) process.env.GMAIL_CLIENT_ID = previous.clientId;
      else delete process.env.GMAIL_CLIENT_ID;
      if (previous.clientSecret !== undefined) process.env.GMAIL_CLIENT_SECRET = previous.clientSecret;
      else delete process.env.GMAIL_CLIENT_SECRET;
    }
  });
});
