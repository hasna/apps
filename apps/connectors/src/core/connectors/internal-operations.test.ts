import { describe, test, expect } from "bun:test";
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

  test("throws for unknown operation", async () => {
    await expect(
      executeConnectorOperation(stripeConnector, {
        operation: "definitely-not-real",
        input: {},
      })
    ).rejects.toBeInstanceOf(ConnectorOperationNotFoundError);
  });
});
