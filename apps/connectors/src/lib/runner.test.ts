import { describe, test, expect } from "bun:test";
import {
  getConnectorCliPath,
  getConnectorOperations,
  runConnectorCommand,
  getConnectorCommandHelp,
  getConnectorsWithCli,
} from "./runner";

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
      expect(connectors.length).toBe(62);
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
  });

  describe("getConnectorCommandHelp", () => {
    test("returns help for stripe products", async () => {
      const help = await getConnectorCommandHelp("stripe", "products");
      expect(help).toContain("list");
      expect(help).toContain("create");
    });
  });
});
