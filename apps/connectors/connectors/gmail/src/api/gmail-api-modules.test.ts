import { describe, test, expect, mock } from "bun:test";
import { HistoryApi } from "./history";
import { SettingsApi } from "./settings";
import { WatchApi } from "./watch";
import type { GmailClient } from "./client";

function createMockClient() {
  return {
    get: mock(async () => ({})),
    post: mock(async () => ({})),
    put: mock(async () => ({})),
    delete: mock(async () => ({})),
  } as unknown as GmailClient & {
    get: ReturnType<typeof mock>;
    post: ReturnType<typeof mock>;
    put: ReturnType<typeof mock>;
  };
}

describe("HistoryApi", () => {
  test("list forwards query params to the Gmail history endpoint", async () => {
    const client = createMockClient();
    client.get.mockResolvedValueOnce({ history: [], historyId: "123" });
    const api = new HistoryApi(client);

    await api.list({
      startHistoryId: "100",
      historyTypes: ["messageAdded", "labelAdded"],
      labelId: "INBOX",
      maxResults: 25,
      pageToken: "next-page",
    });

    expect(client.get).toHaveBeenCalledWith("/v1/users/me/history", {
      startHistoryId: "100",
      historyTypes: "messageAdded,labelAdded",
      labelId: "INBOX",
      maxResults: 25,
      pageToken: "next-page",
    });
  });

  test("listAll paginates through history records", async () => {
    const client = createMockClient();
    client.get
      .mockResolvedValueOnce({
        history: [{ id: "1" }, { id: "2" }],
        nextPageToken: "page-2",
        historyId: "200",
      })
      .mockResolvedValueOnce({
        history: [{ id: "3" }],
        historyId: "201",
      });
    const api = new HistoryApi(client);

    const records = [];
    for await (const record of api.listAll({ startHistoryId: "100" })) {
      records.push(record);
    }

    expect(records.map((record) => record.id)).toEqual(["1", "2", "3"]);
    expect(client.get).toHaveBeenCalledTimes(2);
  });
});

describe("SettingsApi", () => {
  test("get passes format query param", async () => {
    const client = createMockClient();
    client.get.mockResolvedValueOnce({ displayName: "Test", emailAddress: "test@example.com" });
    const api = new SettingsApi(client);

    await api.get({ format: "minimal" });

    expect(client.get).toHaveBeenCalledWith("/v1/users/me/settings", { format: "minimal" });
  });

  test("getAutoForwarding reads forwarding settings", async () => {
    const client = createMockClient();
    client.get.mockResolvedValueOnce({
      enabled: false,
      emailAddress: "forward@example.com",
      disposition: "leaveInInbox",
    });
    const api = new SettingsApi(client);

    const forwarding = await api.getAutoForwarding();

    expect(forwarding.enabled).toBe(false);
    expect(client.get).toHaveBeenCalledWith("/v1/users/me/settings/autoForwarding");
  });

  test("updateAutoForwarding sends PUT payload", async () => {
    const client = createMockClient();
    client.put.mockResolvedValueOnce({
      enabled: true,
      emailAddress: "forward@example.com",
      disposition: "archive",
    });
    const api = new SettingsApi(client);

    await api.updateAutoForwarding({
      enabled: true,
      emailAddress: "forward@example.com",
      disposition: "archive",
    });

    expect(client.put).toHaveBeenCalledWith("/v1/users/me/settings/autoForwarding", {
      enabled: true,
      emailAddress: "forward@example.com",
      disposition: "archive",
    });
  });
});

describe("WatchApi", () => {
  test("start posts watch request body", async () => {
    const client = createMockClient();
    client.post.mockResolvedValueOnce({ historyId: "500", expiration: "1710000000000" });
    const api = new WatchApi(client);

    const response = await api.start({
      topicName: "projects/demo/topics/gmail",
      labelIds: ["INBOX"],
      labelFilterAction: "include",
    });

    expect(response.historyId).toBe("500");
    expect(client.post).toHaveBeenCalledWith("/v1/users/me/watch", {
      topicName: "projects/demo/topics/gmail",
      labelIds: ["INBOX"],
      labelFilterAction: "include",
    });
  });

  test("stop posts to the stop endpoint", async () => {
    const client = createMockClient();
    const api = new WatchApi(client);

    await api.stop();

    expect(client.post).toHaveBeenCalledWith("/v1/users/me/stop");
  });
});
