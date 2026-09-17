import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Instructions idempotency migration", () => {
  test("declares the durable principal/operation/key authority and completed response", () => {
    const sql = readFileSync(join(import.meta.dir, "../../migrations/0003_idempotency_receipts.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS instruction_idempotency_receipts");
    expect(sql).toContain("PRIMARY KEY (principal, operation, idempotency_key)");
    expect(sql).toContain("request_sha256");
    expect(sql).toContain("response_status");
    expect(sql).toContain("response_body");
  });
});
