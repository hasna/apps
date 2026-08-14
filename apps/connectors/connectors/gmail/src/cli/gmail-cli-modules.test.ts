import { describe, test, expect } from "bun:test";
import { runConnectorCommand, getConnectorOperations } from "../../../../src/lib/runner.js";

describe("gmail CLI modules", () => {
  test("history command is registered in help output", async () => {
    const ops = await getConnectorOperations("gmail");
    expect(ops.commands).toContain("history");
    expect(ops.commands).toContain("gmail-settings");
    expect(ops.commands).toContain("watch");
  });

  test("history list --help documents start-history-id", async () => {
    const result = await runConnectorCommand("gmail", ["history", "list", "--help"]);
    expect(result.success).toBe(true);
    expect(result.stdout).toContain("start-history-id");
  });

  test("gmail-settings --help documents account settings commands", async () => {
    const result = await runConnectorCommand("gmail", ["gmail-settings", "--help"]);
    expect(result.success).toBe(true);
    expect(result.stdout.toLowerCase()).toContain("settings");
  });

  test("watch --help documents push notification commands", async () => {
    const result = await runConnectorCommand("gmail", ["watch", "--help"]);
    expect(result.success).toBe(true);
    expect(result.stdout.toLowerCase()).toContain("watch");
  });
});
