import { describe, test, expect } from "bun:test";
import {
  pad,
  formatDate,
  daysUntil,
  domainRowLabel,
  filterLabel,
  stripAnsi,
} from "./format.js";
import type { Domain } from "../../db/domains.js";

describe("tui format helpers", () => {
  test("pad truncates long values", () => {
    expect(pad("hello-world-example.com", 10)).toBe("hello-wor…");
  });

  test("formatDate returns ISO date prefix", () => {
    expect(formatDate("2030-01-01T00:00:00Z")).toBe("2030-01-01");
    expect(formatDate(null)).toBe("—");
  });

  test("daysUntil reports relative expiry", () => {
    const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(daysUntil(future)).toBe("5d");
    expect(daysUntil(null)).toBe("—");
  });

  test("domainRowLabel aligns columns", () => {
    const domain = {
      name: "example.com",
      status: "active",
      expires_at: "2030-01-01T00:00:00Z",
      registrar: "Namecheap",
    } as Domain;
    const row = domainRowLabel(domain);
    expect(row).toContain("example.com");
    expect(row).toContain("active");
    expect(row).toContain("2030-01-01");
    expect(row).toContain("Namecheap");
  });

  test("filterLabel maps filters", () => {
    expect(filterLabel("all")).toBe("All");
    expect(filterLabel("expiring")).toBe("Expiring (30d)");
  });

  test("stripAnsi removes escape codes", () => {
    expect(stripAnsi("\u001B[31mred\u001B[0m")).toBe("red");
  });
});
