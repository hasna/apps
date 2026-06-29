import { describe, expect, test } from "bun:test";
import { listMcpTools, runMcp } from "../src/mcp/index.ts";

describe("banking-mcp scaffold", () => {
  test("declares initial agent-safe tool names", () => {
    expect(listMcpTools()).toContain("banking_providers_list");
    expect(listMcpTools()).toContain("banking_payment_request");
    expect(listMcpTools()).toContain("banking_card_freeze_request");
  });

  test("help exits successfully", () => {
    expect(runMcp(["--help"])).toBe(0);
  });
});
