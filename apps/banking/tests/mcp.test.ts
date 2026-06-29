import { describe, expect, test } from "bun:test";
import { listMcpTools, listPlannedMcpTools, runMcp } from "../src/mcp/index.ts";

describe("banking-mcp scaffold", () => {
  test("declares initial agent-safe tool names", () => {
    expect(listMcpTools()).toContain("banking_providers_list");
    expect(listMcpTools()).toContain("banking_payment_request");
    expect(listMcpTools()).toContain("banking_card_freeze_request");
  });

  test("help exits successfully", () => {
    expect(runMcp(["--help"])).toBe(0);
  });

  test("planned tools are labeled as planned", () => {
    expect(listPlannedMcpTools()[0]?.status).toBe("planned");
  });
});
