import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli/index.ts";

describe("banking CLI scaffold", () => {
  test("help exits successfully", () => {
    expect(runCli(["--help"])).toBe(0);
  });

  test("provider list exits successfully", () => {
    expect(runCli(["providers", "list", "--json"])).toBe(0);
  });

  test("payment request envelope exits successfully", () => {
    expect(runCli([
      "payments",
      "request",
      "--provider",
      "mercury",
      "--account",
      "acct_1",
      "--amount",
      "10.00",
      "--currency",
      "USD",
      "--to",
      "Vendor",
      "--json",
    ])).toBe(0);
  });

  test("card request envelope exits successfully even when policy denies execution", () => {
    expect(runCli([
      "cards",
      "request",
      "--provider",
      "mercury",
      "--account",
      "acct_1",
      "--label",
      "Ops",
      "--limit-month",
      "50.00",
      "--currency",
      "USD",
      "--json",
    ])).toBe(0);
  });

  test("admin commands are gated", () => {
    expect(runCli(["admin", "providers", "verify-operation", "--json"])).toBe(3);
  });

  test("unknown command fails closed", () => {
    expect(runCli(["pay", "now"])).toBe(1);
  });

  test("unimplemented provider-backed commands fail closed", () => {
    expect(runCli(["accounts", "list", "--json"])).toBe(2);
  });
});
