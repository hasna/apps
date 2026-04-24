import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import { ConnectorsClient } from "./index";

// ── Mock fetch ──────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown) {
  return mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    )
  );
}

let client: ConnectorsClient;

beforeEach(() => {
  client = new ConnectorsClient({ serverUrl: "http://localhost:9876" });
});

afterEach(() => {
  global.fetch = originalFetch;
});

const originalFetch = global.fetch;

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ConnectorsClient", () => {
  describe("constructor", () => {
    it("uses default serverUrl when none provided", () => {
      const c = new ConnectorsClient();
      // If no server, the request should still hit localhost:9876
      expect(c).toBeDefined();
    });

    it("strips trailing slash from serverUrl", async () => {
      const fetchMock = mockFetch(200, []);
      global.fetch = fetchMock;
      const c = new ConnectorsClient({ serverUrl: "http://localhost:9876/" });
      await c.list();
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/connectors");
    });
  });

  describe("list()", () => {
    it("calls GET /api/connectors", async () => {
      const fetchMock = mockFetch(200, [{ name: "github", category: "dev", installed: true }]);
      global.fetch = fetchMock;
      const result = await client.list();
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/connectors");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("github");
    });

    it("adds compact=true query param when compact option is set", async () => {
      const fetchMock = mockFetch(200, [{ name: "github", category: "dev", installed: true }]);
      global.fetch = fetchMock;
      await client.list({ compact: true });
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("compact=true");
    });

    it("adds fields query param when fields option is set", async () => {
      const fetchMock = mockFetch(200, [{ name: "github" }]);
      global.fetch = fetchMock;
      await client.list({ fields: "name,category" });
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("fields=name%2Ccategory");
    });
  });

  describe("get()", () => {
    it("calls GET /api/connectors/:name", async () => {
      const connector = { name: "github", displayName: "GitHub", description: "...", category: "dev", installed: true, auth: null };
      const fetchMock = mockFetch(200, connector);
      global.fetch = fetchMock;
      const result = await client.get("github");
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/connectors/github");
      expect(result.name).toBe("github");
    });

    it("throws when connector not found (404)", async () => {
      const fetchMock = mockFetch(404, { error: "Connector 'unknown' not found" });
      global.fetch = fetchMock;
      await expect(client.get("unknown")).rejects.toThrow("Connector 'unknown' not found");
    });
  });

  describe("listOperations()", () => {
    it("calls GET /api/connectors/:name/operations", async () => {
      const fetchMock = mockFetch(200, {
        connector: "github",
        displayName: "GitHub",
        auth: { type: "bearer", configured: false },
        commands: ["repo", "user"],
        operations: [
          {
            name: "repo",
            aliases: [],
            usage: "repo",
            summary: "Repository operations",
            source: "internal",
          },
          {
            name: "user",
            aliases: [],
            usage: "user",
            summary: "User operations",
            source: "internal",
          },
        ],
        helpText: "Usage: connect-github ...",
      });
      global.fetch = fetchMock;
      const result = await client.listOperations("github");
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/connectors/github/operations");
      expect(result.commands).toContain("repo");
      expect(result.auth?.type).toBe("bearer");
      expect(result.operations[0]).toMatchObject({
        name: "repo",
        source: "internal",
      });
    });
  });

  describe("getOperationHelp()", () => {
    it("calls GET /api/connectors/:name/operations/:command", async () => {
      const fetchMock = mockFetch(200, {
        connector: "github",
        displayName: "GitHub",
        command: "user",
        help: "Usage: connect-github user [options] [command]",
      });
      global.fetch = fetchMock;
      const result = await client.getOperationHelp("github", "user");
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "http://localhost:9876/api/connectors/github/operations/user"
      );
      expect(result.help).toContain("connect-github user");
    });
  });

  describe("runOperation()", () => {
    it("calls POST /api/connectors/:name/operations/run", async () => {
      const fetchMock = mockFetch(200, {
        connector: "github",
        displayName: "GitHub",
        success: true,
        output: "{\"profile\":\"default\"}",
      });
      global.fetch = fetchMock;
      const result = await client.runOperation("github", ["config", "show"], {
        format: "json",
        timeout: 5000,
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "http://localhost:9876/api/connectors/github/operations/run"
      );
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        args: ["config", "show"],
        format: "json",
        timeout: 5000,
      });
      expect(result.success).toBe(true);
    });
  });

  describe("install()", () => {
    it("calls POST /api/connectors/:name/install", async () => {
      const fetchMock = mockFetch(200, { success: true, name: "github" });
      global.fetch = fetchMock;
      const result = await client.install("github");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/connectors/github/install");
      expect(init.method).toBe("POST");
      expect(result.success).toBe(true);
    });
  });

  describe("uninstall()", () => {
    it("calls POST /api/connectors/:name/uninstall", async () => {
      const fetchMock = mockFetch(200, { success: true, name: "github" });
      global.fetch = fetchMock;
      const result = await client.uninstall("github");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/connectors/github/uninstall");
      expect(init.method).toBe("POST");
      expect(result.success).toBe(true);
    });
  });

  describe("setKey()", () => {
    it("calls POST /api/connectors/:name/key with key in body", async () => {
      const fetchMock = mockFetch(200, { success: true });
      global.fetch = fetchMock;
      const result = await client.setKey("github", "ghp_secret");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/connectors/github/key");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ key: "ghp_secret" });
      expect(result.success).toBe(true);
    });

    it("includes field in body when provided", async () => {
      const fetchMock = mockFetch(200, { success: true });
      global.fetch = fetchMock;
      await client.setKey("stripe", "sk_test_xxx", "secret_key");
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(JSON.parse(init.body as string)).toEqual({ key: "sk_test_xxx", field: "secret_key" });
    });
  });

  describe("refresh()", () => {
    it("calls POST /api/connectors/:name/refresh", async () => {
      const fetchMock = mockFetch(200, { success: true, expiresAt: 1700000000000 });
      global.fetch = fetchMock;
      const result = await client.refresh("google");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/connectors/google/refresh");
      expect(init.method).toBe("POST");
      expect(result.success).toBe(true);
      expect(result.expiresAt).toBe(1700000000000);
    });
  });

  describe("getProfiles()", () => {
    it("calls GET /api/connectors/:name/profiles", async () => {
      const profilesResp = { current: "default", profiles: [{ id: "default" }, { id: "work" }] };
      const fetchMock = mockFetch(200, profilesResp);
      global.fetch = fetchMock;
      const result = await client.getProfiles("github");
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/connectors/github/profiles");
      expect(result.current).toBe("default");
      expect(result.profiles).toHaveLength(2);
    });
  });

  describe("switchProfile()", () => {
    it("calls POST /api/connectors/:name/profiles/switch", async () => {
      const fetchMock = mockFetch(200, { success: true, profile: "work" });
      global.fetch = fetchMock;
      const result = await client.switchProfile("github", "work");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/connectors/github/profiles/switch");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ profile: "work" });
      expect(result.profile).toBe("work");
    });
  });

  describe("getActivity()", () => {
    it("calls GET /api/activity", async () => {
      const entries = [
        { action: "installed", connector: "github", timestamp: 1700000000000 },
        { action: "key_saved", connector: "stripe", timestamp: 1700000001000 },
      ];
      const fetchMock = mockFetch(200, entries);
      global.fetch = fetchMock;
      const result = await client.getActivity();
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/activity");
      expect(result).toHaveLength(2);
    });

    it("truncates results when limit is provided", async () => {
      const entries = Array.from({ length: 10 }, (_, i) => ({
        action: "installed",
        connector: `connector-${i}`,
        timestamp: Date.now(),
      }));
      const fetchMock = mockFetch(200, entries);
      global.fetch = fetchMock;
      const result = await client.getActivity(3);
      expect(result).toHaveLength(3);
    });
  });

  describe("update()", () => {
    it("calls POST /api/update", async () => {
      const fetchMock = mockFetch(200, { results: [], count: 0, total: 0 });
      global.fetch = fetchMock;
      const result = await client.update();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/update");
      expect(init.method).toBe("POST");
      expect(result.count).toBe(0);
    });
  });

  describe("error handling", () => {
    it("throws error with message from API error response", async () => {
      const fetchMock = mockFetch(500, { error: "Internal server error" });
      global.fetch = fetchMock;
      await expect(client.install("github")).rejects.toThrow("Internal server error");
    });

    it("throws generic error when no error message in response", async () => {
      const fetchMock = mockFetch(500, {});
      global.fetch = fetchMock;
      await expect(client.install("github")).rejects.toThrow("Request failed with status 500");
    });
  });
});
