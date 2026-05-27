import { describe, it, expect, beforeEach, mock, afterEach } from "bun:test";
import {
  ConnectorsClient,
  HostedConnectorsClient,
  HostedConnectorsError,
  LocalConnectorsClient,
  normalizeConnectorSlug,
} from "./index";

// ── Mock fetch ──────────────────────────────────────────────────────────────

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  return mock(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
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

  describe("getManifest()", () => {
    it("calls GET /api/connectors/manifest", async () => {
      const fetchMock = mockFetch(200, {
        version: 1,
        packageName: "@hasna/connectors",
        packageVersion: "1.3.26",
        generatedAt: "2026-05-26T00:00:00.000Z",
        categories: [],
        connectorCount: 1,
        connectors: [{ id: "github", name: "github", aliases: ["github", "connect-github"] }],
      });
      global.fetch = fetchMock;
      const result = await client.getManifest();
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://localhost:9876/api/connectors/manifest");
      expect(result.connectors[0].id).toBe("github");
    });

    it("adds manifest query params when provided", async () => {
      const fetchMock = mockFetch(200, {
        version: 1,
        packageName: "@hasna/connectors",
        packageVersion: "1.3.26",
        generatedAt: "2026-05-26T00:00:00.000Z",
        categories: [],
        connectorCount: 1,
        connectors: [],
      });
      global.fetch = fetchMock;
      await client.getManifest({ includeOperations: true, connectorNames: ["github", "stripe"] });
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("includeOperations=true");
      expect(url).toContain("connectors=github%2Cstripe");
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

  describe("runStructuredOperation()", () => {
    it("calls POST /api/connectors/:name/operations/run with structured body", async () => {
      const fetchMock = mockFetch(200, {
        connector: "github",
        displayName: "GitHub",
        operation: "user.info",
        stdout: "{\"login\":\"octocat\"}",
        stderr: "",
        exitCode: 0,
        success: true,
        data: { login: "octocat" },
      });
      global.fetch = fetchMock;
      const result = await client.runStructuredOperation<{ login: string }>("github", {
        operation: "user.info",
        input: { username: "octocat" },
        profile: "work",
        timeout: 5000,
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        "http://localhost:9876/api/connectors/github/operations/run"
      );
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        operation: "user.info",
        input: { username: "octocat" },
        profile: "work",
        timeout: 5000,
      });
      expect(result.data?.login).toBe("octocat");
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

describe("SDK client split", () => {
  it("keeps ConnectorsClient as the local connectors-serve client", async () => {
    const fetchMock = mockFetch(200, []);
    global.fetch = fetchMock;
    const client = new ConnectorsClient({ serverUrl: "http://localhost:9876" });
    const local = new LocalConnectorsClient({ serverUrl: "http://localhost:9876" });

    await client.list();
    await local.list();

    expect(client).toBeInstanceOf(LocalConnectorsClient);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://localhost:9876/api/connectors",
      "http://localhost:9876/api/connectors",
    ]);
  });

  it("normalizes hosted and local connector slug inputs", () => {
    expect(normalizeConnectorSlug(" GitHub ")).toBe("github");
    expect(normalizeConnectorSlug("connect-github")).toBe("github");
    expect(normalizeConnectorSlug("@hasna/connect-github")).toBe("github");
    expect(normalizeConnectorSlug("google-drive")).toBe("google-drive");
    expect(() => normalizeConnectorSlug("connect-")).toThrow("connector slug is required");
    expect(() => normalizeConnectorSlug("github/repo")).toThrow("invalid connector slug");
  });
});

describe("HostedConnectorsClient", () => {
  it("requires apiUrl and strips trailing slashes", async () => {
    expect(() => new HostedConnectorsClient({ apiUrl: "" })).toThrow("apiUrl is required");

    const fetchMock = mockFetch(200, []);
    const hosted = new HostedConnectorsClient({
      apiUrl: "https://connectors.example/",
      apiKey: "pcs_key_test",
      fetchImpl: fetchMock,
    });

    await hosted.listConnectors();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://connectors.example/api/v1/connectors");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer pcs_key_test");
  });

  it("maps hosted discovery, OAuth, account, run, approval, billing, and policy methods", async () => {
    const seen: Array<{ path: string; method: string }> = [];
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = mock(async (input: string | URL | Request, init?: RequestInit) => {
      if (typeof init?.body === "string") {
        bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      seen.push({
        path: String(input).replace("https://connectors.example/api/v1", ""),
        method: init?.method ?? "GET",
      });
      return Response.json({ ok: true });
    });
    const hosted = new HostedConnectorsClient({
      apiUrl: "https://connectors.example",
      apiKey: "pcs_key_test",
      fetchImpl: fetchMock,
    });

    await hosted.whoami();
    await hosted.getContract();
    await hosted.listConnectors({ search: "github" });
    await hosted.getConnector("connect-github");
    await hosted.getConnectorDocs("@hasna/connect-github");
    await hosted.getConnectorOperations("connect-github");
    await hosted.getConnectorAuthUrl("connect-github", {
      redirectUrl: "https://app.example/callback",
      returnUrl: "https://app.example/connected",
      profileName: "prod",
      scopes: ["repo", "read:user"],
    });
    await hosted.listAccounts();
    await hosted.getAccountConnectionStatus();
    await hosted.connectAccount({ connectorSlug: "connect-github", credentials: {} });
    await hosted.listAccountProfiles("account-id");
    await hosted.revokeAccountProfile("account-id", "default");
    await hosted.revokeAccount("account-id");
    await hosted.checkAccountCredentials("account-id", "default");
    await hosted.listRuns();
    await hosted.submitRun({
      connectorSlug: "connect-github",
      operationName: "repos",
      accountId: "account-id",
      profileName: "default",
      input: { visibility: "private" },
      estimatedCredits: 2,
      idempotencyKey: "run-1",
    });
    await hosted.getRun("run-id");
    await hosted.getRunStatus("run-id");
    await hosted.listRunLogs("run-id");
    await hosted.listRunArtifacts("run-id");
    await hosted.listApprovals();
    await hosted.requestApproval({
      actionType: "connector.run",
      resourceType: "connector_operation",
      resourceId: "connect-github:repos",
      requestPayload: { connectorSlug: "connect-github" },
    });
    await hosted.decideApproval("approval-id", "approve");
    await hosted.getBillingStatus();
    await hosted.createBillingCustomer({ email: "billing@example.com" });
    await hosted.createCheckoutSession({
      priceId: "price_123",
      successUrl: "https://app.example/success",
      cancelUrl: "https://app.example/cancel",
      creditPackCredits: 100,
      idempotencyKey: "checkout",
    });
    await hosted.createBillingPortalSession({ returnUrl: "https://app.example/billing", idempotencyKey: "portal" });
    await hosted.addBillingCredits({ amountCredits: 10, idempotencyKey: "credits" });
    await hosted.listBillingTransactions();
    await hosted.listBillingInvoices();
    await hosted.getUsage();
    await hosted.getQuotas();
    await hosted.getPolicy();
    await hosted.updatePolicy({
      connectorAllowlist: ["connect-github"],
      operationDenylist: ["connect-github:repos"],
    });
    await hosted.listAuditTimeline();
    await hosted.listTenantMappings();
    await hosted.upsertTenantMapping("platform-skills", "org_123", { displayName: "Acme Skills" });

    expect(seen).toEqual([
      { path: "/auth/whoami", method: "GET" },
      { path: "/contract", method: "GET" },
      { path: "/connectors?search=github", method: "GET" },
      { path: "/connectors/github", method: "GET" },
      { path: "/connectors/github/docs", method: "GET" },
      { path: "/connectors/github/operations", method: "GET" },
      { path: "/connectors/github/auth-url?redirectUrl=https%3A%2F%2Fapp.example%2Fcallback&returnUrl=https%3A%2F%2Fapp.example%2Fconnected&profileName=prod&scopes=repo%2Cread%3Auser", method: "GET" },
      { path: "/accounts", method: "GET" },
      { path: "/accounts/status", method: "GET" },
      { path: "/accounts", method: "POST" },
      { path: "/accounts/account-id/profiles", method: "GET" },
      { path: "/accounts/account-id/profiles/default", method: "DELETE" },
      { path: "/accounts/account-id", method: "DELETE" },
      { path: "/accounts/account-id/profiles/default/credential-check", method: "GET" },
      { path: "/runs", method: "GET" },
      { path: "/runs", method: "POST" },
      { path: "/runs/run-id", method: "GET" },
      { path: "/runs/run-id/status", method: "GET" },
      { path: "/runs/run-id/logs", method: "GET" },
      { path: "/runs/run-id/artifacts", method: "GET" },
      { path: "/approvals", method: "GET" },
      { path: "/approvals", method: "POST" },
      { path: "/approvals/approval-id/approve", method: "POST" },
      { path: "/billing/status", method: "GET" },
      { path: "/billing/customers", method: "POST" },
      { path: "/billing/checkout", method: "POST" },
      { path: "/billing/portal", method: "POST" },
      { path: "/billing/credits", method: "POST" },
      { path: "/billing/transactions", method: "GET" },
      { path: "/billing/invoices", method: "GET" },
      { path: "/usage", method: "GET" },
      { path: "/quotas", method: "GET" },
      { path: "/policy", method: "GET" },
      { path: "/policy", method: "PUT" },
      { path: "/audit-timeline", method: "GET" },
      { path: "/tenant-mappings", method: "GET" },
      { path: "/tenant-mappings/platform-skills/org_123", method: "PUT" },
    ]);
    expect(bodies).toContainEqual(expect.objectContaining({ connectorSlug: "github" }));
    expect(bodies).toContainEqual(expect.objectContaining({
      connectorAllowlist: ["github"],
      operationDenylist: ["github:repos"],
    }));
  });

  it("throws hosted errors with status, code, payload, and request id", async () => {
    const hosted = new HostedConnectorsClient({
      apiUrl: "https://connectors.example",
      apiKey: "pcs_key_test",
      fetchImpl: mockFetch(403, { error: "denied", code: "OPERATION_DENIED" }, { "x-request-id": "req_123" }),
    });

    try {
      await hosted.submitRun({ connectorSlug: "github", operationName: "repos" });
      throw new Error("expected hosted error");
    } catch (error) {
      expect(error).toBeInstanceOf(HostedConnectorsError);
      expect((error as HostedConnectorsError).status).toBe(403);
      expect((error as HostedConnectorsError).code).toBe("OPERATION_DENIED");
      expect((error as HostedConnectorsError).requestId).toBe("req_123");
      expect((error as HostedConnectorsError).payload).toEqual({ error: "denied", code: "OPERATION_DENIED" });
    }
  });
});
