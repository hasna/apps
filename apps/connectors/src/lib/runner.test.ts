import { afterEach, describe, mock, test, expect } from "bun:test";
import {
  getConnectorCliPath,
  getConnectorOperations,
  runConnectorCommand,
  getConnectorCommandHelp,
  getConnectorsWithCli,
  hasConnectorCommandSurface,
  buildEnvWithCredentials,
} from "./runner";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.GITHUB_TOKEN;
  delete process.env.IMESSAGE_API_KEY;
  delete process.env.IMESSAGE_BRIDGE_URL;
  delete process.env.IMESSAGE_DEVICE_ID;
  delete process.env.STRIPE_API_KEY;
  delete process.env.STRIPE_ACCOUNT_ID;
  delete process.env.STRIPE_API_SECRET;
});

describe("Runner", () => {
  describe("getConnectorCliPath", () => {
    test("returns path for connector with CLI", () => {
      const path = getConnectorCliPath("stripe");
      expect(path).not.toBeNull();
      expect(path).toContain("connect-stripe/src/cli/index.ts");
    });

    test("returns null for non-existent connector", () => {
      const path = getConnectorCliPath("zzzznonexistent");
      expect(path).toBeNull();
    });

    test("sanitizes unsafe characters", () => {
      const path = getConnectorCliPath("../../../etc/passwd");
      expect(path).toBeNull();
    });
  });

  describe("getConnectorsWithCli", () => {
    test("returns list of connectors with CLIs", () => {
      const connectors = getConnectorsWithCli();
      expect(connectors.length).toBeGreaterThanOrEqual(62);
      expect(connectors).toContain("stripe");
      expect(connectors).toContain("gmail");
      expect(connectors).toContain("anthropic");
    });
  });

  describe("getConnectorOperations", () => {
    test("returns operations for stripe", async () => {
      const ops = await getConnectorOperations("stripe");
      expect(ops.hasCli).toBe(true);
      expect(ops.commands.length).toBeGreaterThan(0);
      expect(ops.commands).toContain("products");
      expect(ops.commands).toContain("customers");
    });

    test("returns operations for gmail", async () => {
      const ops = await getConnectorOperations("gmail");
      expect(ops.hasCli).toBe(true);
      expect(ops.commands).toContain("messages");
    });

    test("returns hasCli=false for non-existent connector", async () => {
      const ops = await getConnectorOperations("zzzznonexistent");
      expect(ops.hasCli).toBe(false);
      expect(ops.commands).toEqual([]);
    });

    test("returns internal command surface for github", async () => {
      const ops = await getConnectorOperations("github");
      expect(ops.hasCli).toBe(true);
      expect(ops.commands).toContain("repo");
      expect(ops.commands).toContain("user");
      expect(ops.commands).toContain("config");
    });

    test("returns internal command surface for stripe", async () => {
      const ops = await getConnectorOperations("stripe");
      expect(ops.hasCli).toBe(true);
      expect(ops.commands).toContain("profile");
      expect(ops.commands).toContain("config");
      expect(ops.commands).toContain("products");
    });

    test("returns internal command surface for imessage", async () => {
      const ops = await getConnectorOperations("imessage");
      expect(ops.hasCli).toBe(true);
      expect(ops.commands).toContain("profile");
      expect(ops.commands).toContain("conversation");
      expect(ops.commands).toContain("message");
    });
  });

  describe("runConnectorCommand", () => {
    test("runs anthropic models command", async () => {
      const result = await runConnectorCommand("anthropic", ["models"]);
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("claude");
    });

    test("returns error for non-existent connector", async () => {
      const result = await runConnectorCommand("zzzznonexistent", ["test"]);
      expect(result.success).toBe(false);
    });

    test("runs --help command", async () => {
      const result = await runConnectorCommand("stripe", ["--help"]);
      expect(result.success).toBe(true);
      expect(result.stdout).toContain("Stripe");
    });

    test("runs github internal runtime for user info", async () => {
      process.env.GITHUB_TOKEN = "ghp_test_token";
      const fetchMock = mock((input: RequestInfo | URL) =>
        Promise.resolve(
          new Response(JSON.stringify({ login: "octocat", id: 1 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
      );
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await runConnectorCommand("github", [
        "user",
        "info",
        "octocat",
        "--format",
        "json",
      ]);

      expect(result.success).toBe(true);
      expect(JSON.parse(result.stdout)).toEqual({ login: "octocat", id: 1 });
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "https://api.github.com/users/octocat"
      );
    });

    test("runs stripe internal runtime for config show", async () => {
      const result = await runConnectorCommand("stripe", [
        "config",
        "show",
        "--format",
        "json",
      ]);

      expect(result.success).toBe(true);
      const data = JSON.parse(result.stdout);
      expect(data.profile).toBeDefined();
      expect(data.configDir).toContain(".hasna/connectors/connect-stripe");
    });

    test("runs imessage internal runtime for message send", async () => {
      process.env.IMESSAGE_BRIDGE_URL = "https://bridge.example";
      process.env.IMESSAGE_API_KEY = "bridge-key";
      process.env.IMESSAGE_DEVICE_ID = "device-main";

      const fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              message: {
                id: "msg-1",
                conversationId: "chat-1",
                text: "hello world",
                to: "+15551234567",
                status: "queued",
                direction: "outbound",
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

      const result = await runConnectorCommand("imessage", [
        "message",
        "send",
        "--to",
        "+15551234567",
        "--text",
        "hello world",
        "--format",
        "json",
      ]);

      expect(result.success).toBe(true);
      expect(JSON.parse(result.stdout)).toMatchObject({
        id: "msg-1",
        conversationId: "chat-1",
        text: "hello world",
        to: "+15551234567",
        status: "queued",
      });

      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
        "https://bridge.example/messages/send"
      );

      const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
      expect(request.method).toBe("POST");
      expect(request.headers).toBeInstanceOf(Headers);
      expect((request.headers as Headers).get("X-Device-Id")).toBe("device-main");
    });
  });

  describe("getConnectorCommandHelp", () => {
    test("returns help for stripe products", async () => {
      const help = await getConnectorCommandHelp("stripe", "products");
      expect(help).toContain("list");
      expect(help).toContain("create");
    });

    test("returns internal help for github user", async () => {
      const help = await getConnectorCommandHelp("github", "user");
      expect(help).toContain("User information");
      expect(help).toContain("info [username]");
    });

    test("returns internal help for stripe products", async () => {
      const help = await getConnectorCommandHelp("stripe", "products");
      expect(help).toContain("Manage products");
      expect(help).toContain("get <id>");
    });

    test("returns internal help for imessage message", async () => {
      const help = await getConnectorCommandHelp("imessage", "message");
      expect(help).toContain("List, send, and reply to messages");
      expect(help).toContain("send --to <handle> --text <text>");
    });
  });

  describe("hasConnectorCommandSurface", () => {
    test("returns true for internal github runtime", () => {
      expect(hasConnectorCommandSurface("github")).toBe(true);
    });

    test("returns true for internal stripe runtime", () => {
      expect(hasConnectorCommandSurface("stripe")).toBe(true);
    });

    test("returns true for internal imessage runtime", () => {
      expect(hasConnectorCommandSurface("imessage")).toBe(true);
    });

    test("returns false for unknown connector", () => {
      expect(hasConnectorCommandSurface("zzzznonexistent")).toBe(false);
    });
  });

  describe("buildEnvWithCredentials", () => {
    test("maps HASNAXYZ_{NAME}_LIVE_API_KEY to {NAME}_API_KEY", () => {
      const env = buildEnvWithCredentials("exa", {
        HASNAXYZ_EXA_LIVE_API_KEY: "test-key-123",
      });
      expect(env.EXA_API_KEY).toBe("test-key-123");
    });

    test("maps HASNA_{NAME}_LIVE_API_KEY to {NAME}_API_KEY", () => {
      const env = buildEnvWithCredentials("exa", {
        HASNA_EXA_LIVE_API_KEY: "test-key-456",
      });
      expect(env.EXA_API_KEY).toBe("test-key-456");
    });

    test("maps {NAME}_LIVE_API_KEY to {NAME}_API_KEY", () => {
      const env = buildEnvWithCredentials("stripe", {
        STRIPE_LIVE_API_KEY: "sk_live_xxx",
      });
      expect(env.STRIPE_API_KEY).toBe("sk_live_xxx");
    });

    test("maps {NAME}_KEY to {NAME}_API_KEY", () => {
      const env = buildEnvWithCredentials("exa", {
        EXA_KEY: "key-from-short",
      });
      expect(env.EXA_API_KEY).toBe("key-from-short");
    });

    test("maps {NAME}_TOKEN to {NAME}_API_KEY", () => {
      const env = buildEnvWithCredentials("exa", {
        EXA_TOKEN: "token-value",
      });
      expect(env.EXA_API_KEY).toBe("token-value");
    });

    test("does not override existing canonical env var", () => {
      const env = buildEnvWithCredentials("exa", {
        EXA_API_KEY: "already-set",
        HASNAXYZ_EXA_LIVE_API_KEY: "should-not-override",
      });
      expect(env.EXA_API_KEY).toBe("already-set");
    });

    test("HASNAXYZ_ has higher priority than HASNA_", () => {
      const env = buildEnvWithCredentials("exa", {
        HASNAXYZ_EXA_LIVE_API_KEY: "from-hasnaxyz",
        HASNA_EXA_LIVE_API_KEY: "from-hasna",
      });
      expect(env.EXA_API_KEY).toBe("from-hasnaxyz");
    });

    test("HASNA_ has higher priority than {NAME}_LIVE_API_KEY", () => {
      const env = buildEnvWithCredentials("stripe", {
        HASNA_STRIPE_LIVE_API_KEY: "from-hasna",
        STRIPE_LIVE_API_KEY: "from-live",
      });
      expect(env.STRIPE_API_KEY).toBe("from-hasna");
    });

    test("handles override connectors like stabilityai", () => {
      const env = buildEnvWithCredentials("stabilityai", {
        HASNAXYZ_STABILITY_LIVE_API_KEY: "stability-key",
      });
      expect(env.STABILITY_API_KEY).toBe("stability-key");
    });

    test("handles googlemaps override", () => {
      const env = buildEnvWithCredentials("googlemaps", {
        HASNAXYZ_GOOGLE_MAPS_LIVE_API_KEY: "maps-key",
      });
      expect(env.GOOGLE_MAPS_API_KEY).toBe("maps-key");
    });

    test("returns env unchanged when no alternatives found", () => {
      const baseEnv = { PATH: "/usr/bin", HOME: "/home/user" };
      const env = buildEnvWithCredentials("exa", baseEnv);
      expect(env.EXA_API_KEY).toBeUndefined();
      expect(env.PATH).toBe("/usr/bin");
    });

    test("does not mutate the input env object", () => {
      const baseEnv = { HASNAXYZ_EXA_LIVE_API_KEY: "test" };
      buildEnvWithCredentials("exa", baseEnv);
      expect((baseEnv as any).EXA_API_KEY).toBeUndefined();
    });

    test("handles hyphenated connector names", () => {
      const env = buildEnvWithCredentials("open-ai", {
        OPEN_AI_KEY: "oai-key",
      });
      expect(env.OPEN_AI_API_KEY).toBe("oai-key");
    });
  });
});

describe("runConnectorCommand error path", () => {
  test("returns failure when connector binary not found (stderr path)", async () => {
    // Use a connector that doesn't exist — should fail gracefully
    const result = await runConnectorCommand("zznonexistent", ["--help"], 5000);
    // Should not throw — returns { stdout, stderr, exitCode, success }
    expect(result).toHaveProperty("stdout");
    expect(result).toHaveProperty("stderr");
    expect(result).toHaveProperty("exitCode");
    expect(result).toHaveProperty("success");
    expect(result.success).toBe(false);
  });
});
