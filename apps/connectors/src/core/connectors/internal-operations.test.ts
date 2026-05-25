import { describe, test, expect } from "bun:test";
import {
  executeConnectorOperation,
  listConnectorOperations,
  ConnectorOperationNotFoundError,
} from "../index.js";
import { stripeConnector } from "./stripe.js";
import { githubConnector } from "./github.js";

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

  test("throws for unknown operation", async () => {
    await expect(
      executeConnectorOperation(stripeConnector, {
        operation: "definitely-not-real",
        input: {},
      })
    ).rejects.toBeInstanceOf(ConnectorOperationNotFoundError);
  });
});
