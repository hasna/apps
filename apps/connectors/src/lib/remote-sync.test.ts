import { describe, expect, test } from "bun:test";
import { assertSyncSucceeded } from "./remote-sync.js";

describe("remote sync result handling", () => {
  test("throws when any table failed so sync metadata is not recorded", () => {
    expect(() => assertSyncSucceeded([
      { table: "agents", rowsRead: 1, rowsWritten: 0, rowsSkipped: 0, errors: ["preflight failed"] },
      { table: "connector_jobs", rowsRead: 0, rowsWritten: 0, rowsSkipped: 0, errors: [] },
    ])).toThrow("Remote storage sync aborted: agents: preflight failed");
  });

  test("accepts all-success results", () => {
    expect(() => assertSyncSucceeded([
      { table: "agents", rowsRead: 1, rowsWritten: 1, rowsSkipped: 0, errors: [] },
    ])).not.toThrow();
  });
});
