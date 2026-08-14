process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createScenario } from "../db/scenarios.js";
import {
  compactLimit,
  compactScenario,
  pageItems,
  paginationHint,
  truncateText,
} from "./compact-output.js";

describe("compact output helpers", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  test("truncates and normalizes long text", () => {
    expect(truncateText("alpha\n\nbeta   gamma", 14)).toBe("alpha beta ...");
    expect(truncateText("short", 80)).toBe("short");
  });

  test("bounds requested limits and pages items", () => {
    const page = pageItems([1, 2, 3, 4, 5], { limit: 999, offset: 2, maxLimit: 2 });

    expect(compactLimit("0", 20, 100)).toBe(20);
    expect(page.items).toEqual([3, 4]);
    expect(page.total).toBe(5);
    expect(page.returned).toBe(2);
    expect(page.truncated).toBe(true);
  });

  test("formats pagination hints with disclosure affordances", () => {
    expect(paginationHint(2, 5, "show <id> or --json")).toBe(
      "Showing 1-2 of 5. Compact output. Use show <id> or --json for full details.",
    );
    expect(paginationHint(20, 100, "show <id> or --json", 80)).toBe(
      "Showing 81-100 of 100. Compact output. Use show <id> or --json for full details.",
    );
  });

  test("summarizes scenarios without dumping large text fields", () => {
    const scenario = createScenario({
      name: `Checkout ${"very ".repeat(30)}long flow`,
      description: "This description should not appear in compact summaries.",
      steps: ["Open cart", "Pay"],
      assertions: ["Receipt is visible"],
      tags: ["checkout", "regression", "critical-path", "stripe", "signed-in", "extra-tag"],
      targetPath: "/checkout/payment/review",
    });

    const compact = compactScenario(scenario);

    expect(compact.name.length).toBeLessThanOrEqual(90);
    expect(compact).not.toHaveProperty("description");
    expect(compact.steps).toBe(2);
    expect(compact.assertions).toBe(1);
    expect(compact.tags).toHaveLength(5);
    expect(compact.tagCount).toBe(6);
  });
});
