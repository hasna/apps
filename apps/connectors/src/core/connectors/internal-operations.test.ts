import { afterEach, describe, mock, test, expect } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  executeConnectorOperation,
  listConnectorOperations,
  ConnectorOperationNotFoundError,
} from "../index.js";
import { stripeConnector } from "./stripe.js";
import { githubConnector } from "./github.js";
import { gmailConnector } from "./gmail.js";
import { googleDriveConnector } from "./googledrive.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.GMAIL_ACCESS_TOKEN;
  delete process.env.CONNECTORS_GMAIL_RETRY_BASE_MS;
});

describe("internal connector operations", () => {
  test("lists normalized stripe operations", () => {
    const operations = listConnectorOperations(stripeConnector).map((op) => op.name);
    expect(operations).toContain("config");
    expect(operations).toContain("products");
    expect(operations).toContain("customers");
  });

  test("executes stripe config show without network", async () => {
    const result = await executeConnectorOperation(stripeConnector, {
      operation: "config",
      input: { args: ["show"], format: "json" },
    });

    expect(result).toMatchObject({ success: true });
    const payload = JSON.parse((result as { stdout: string }).stdout);
    expect(payload).toHaveProperty("profile");
    expect(payload).toHaveProperty("configDir");
  });

  test("executes github config show without network", async () => {
    const result = await executeConnectorOperation(githubConnector, {
      operation: "config",
      input: { args: ["show"], format: "json" },
    });

    expect(result).toMatchObject({ success: true });
    const payload = JSON.parse((result as { stdout: string }).stdout);
    expect(payload).toHaveProperty("tokenConfigured");
  });

  test("lists google drive profiles without network", async () => {
    const previousDir = process.env.HASNA_GOOGLE_DRIVE_CONNECTOR_DIR;
    const configDir = join(tmpdir(), `connectors-googledrive-${crypto.randomUUID()}`);
    mkdirSync(join(configDir, "profiles", "work"), { recursive: true });
    writeFileSync(join(configDir, "profiles", "personal.json"), "{}");
    process.env.HASNA_GOOGLE_DRIVE_CONNECTOR_DIR = configDir;

    try {
      const operations = listConnectorOperations(googleDriveConnector).map((op) => op.name);
      expect(operations).toContain("files.list");
      expect(operations).toContain("files.download");
      expect(operations).toContain("drives.list");
      expect(operations).toContain("profiles.status");

      const result = await executeConnectorOperation(googleDriveConnector, {
        operation: "profiles.list",
      });

      expect(result).toEqual({ profiles: ["personal", "work"] });
    } finally {
      if (previousDir === undefined) {
        delete process.env.HASNA_GOOGLE_DRIVE_CONNECTOR_DIR;
      } else {
        process.env.HASNA_GOOGLE_DRIVE_CONNECTOR_DIR = previousDir;
      }
    }
  });

  test("reports google drive profile auth status without network", async () => {
    const previousDir = process.env.HASNA_GOOGLE_DRIVE_CONNECTOR_DIR;
    const previousToken = process.env.GOOGLE_ACCESS_TOKEN;
    const configDir = join(tmpdir(), `connectors-googledrive-status-${crypto.randomUUID()}`);
    const validProfileDir = join(configDir, "profiles", "valid");
    const expiredProfileDir = join(configDir, "profiles", "expired");
    mkdirSync(validProfileDir, { recursive: true });
    mkdirSync(expiredProfileDir, { recursive: true });
    writeFileSync(join(configDir, "credentials.json"), JSON.stringify({ clientId: "client", clientSecret: "secret" }));
    writeFileSync(join(validProfileDir, "tokens.json"), JSON.stringify({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 3_600_000,
    }));
    writeFileSync(join(expiredProfileDir, "tokens.json"), JSON.stringify({
      accessToken: "access",
      expiresAt: Date.now() - 60_000,
    }));
    process.env.HASNA_GOOGLE_DRIVE_CONNECTOR_DIR = configDir;
    delete process.env.GOOGLE_ACCESS_TOKEN;

    try {
      const result = await executeConnectorOperation(googleDriveConnector, {
        operation: "profiles.status",
      }) as {
        profiles: Array<{
          profile: string;
          authenticated: boolean;
          expired: boolean;
          authRequired: boolean;
          hasRefreshToken: boolean;
          hasOAuthCredentials: boolean;
        }>;
      };

      expect(result.profiles.map((item) => item.profile)).toEqual(["expired", "valid"]);
      expect(result.profiles.find((item) => item.profile === "valid")).toMatchObject({
        authenticated: true,
        expired: false,
        authRequired: false,
        hasRefreshToken: true,
        hasOAuthCredentials: true,
      });
      expect(result.profiles.find((item) => item.profile === "expired")).toMatchObject({
        authenticated: false,
        expired: true,
        authRequired: true,
        hasRefreshToken: false,
        hasOAuthCredentials: true,
      });
    } finally {
      if (previousDir === undefined) {
        delete process.env.HASNA_GOOGLE_DRIVE_CONNECTOR_DIR;
      } else {
        process.env.HASNA_GOOGLE_DRIVE_CONNECTOR_DIR = previousDir;
      }
      if (previousToken === undefined) {
        delete process.env.GOOGLE_ACCESS_TOKEN;
      } else {
        process.env.GOOGLE_ACCESS_TOKEN = previousToken;
      }
    }
  });

  test("lists gmail profiles and normalized sync operations without network", async () => {
    const previousDir = process.env.HASNA_GMAIL_CONNECTOR_DIR;
    const configDir = join(tmpdir(), `connectors-gmail-${crypto.randomUUID()}`);
    mkdirSync(join(configDir, "profiles", "andreihasnacom"), { recursive: true });
    writeFileSync(join(configDir, "profiles", "maximstaris.json"), "{}");
    process.env.HASNA_GMAIL_CONNECTOR_DIR = configDir;

    try {
      const operations = listConnectorOperations(gmailConnector).map((op) => op.name);
      expect(operations).toContain("profiles.list");
      expect(operations).toContain("messages.list");
      expect(operations).toContain("messages.read");
      expect(operations).toContain("messages.getRaw");
      expect(operations).toContain("attachments.list");
      expect(operations).toContain("attachments.download");
      expect(operations).toContain("labels.list");
      expect(operations).toContain("history.list");

      const result = await executeConnectorOperation(gmailConnector, {
        operation: "profiles.list",
      });

      expect(result).toEqual({ profiles: ["andreihasnacom", "maximstaris"] });
    } finally {
      if (previousDir === undefined) {
        delete process.env.HASNA_GMAIL_CONNECTOR_DIR;
      } else {
        process.env.HASNA_GMAIL_CONNECTOR_DIR = previousDir;
      }
    }
  });

  test("retries transient Gmail quota responses", async () => {
    process.env.GMAIL_ACCESS_TOKEN = "test-token";
    process.env.CONNECTORS_GMAIL_RETRY_BASE_MS = "1";
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 });
      }
      return Response.json({ emailAddress: "me@example.com", messagesTotal: 1, threadsTotal: 1 });
    }) as unknown as typeof fetch;

    const result = await executeConnectorOperation(gmailConnector, {
      operation: "profile.get",
      profile: "default",
    });

    expect(calls).toBe(2);
    expect(result).toMatchObject({ emailAddress: "me@example.com" });
  });

  test("throws for unknown operation", async () => {
    await expect(
      executeConnectorOperation(stripeConnector, {
        operation: "definitely-not-real",
        input: {},
      })
    ).rejects.toBeInstanceOf(ConnectorOperationNotFoundError);
  });
});
