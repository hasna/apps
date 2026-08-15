import { describe, expect, test } from "bun:test";
import type { MementosProjectRegistrationReceipt } from "../project-registration/types.js";
import {
  FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION as expected,
  FLEET_RESOURCES_HISTORICAL_RECEIPT,
} from "../project-registration/historical-receipt.js";
import {
  HistoricalReceiptDiagnosticError,
  diagnoseHistoricalProjectRegistrationReceipt,
  type HistoricalReceiptDiagnosticQuery,
} from "./historical-project-registration-receipt.js";

function storedReceipt(
  overrides: Partial<MementosProjectRegistrationReceipt & {
    target_selector: string;
    normalized_call_digest: string;
  }> = {},
): Record<string, unknown> {
  return {
    ...FLEET_RESOURCES_HISTORICAL_RECEIPT,
    target_selector: expected.target_selector,
    normalized_call_digest: "a".repeat(64),
    ...overrides,
  };
}

class DiagnosticQuery implements HistoricalReceiptDiagnosticQuery {
  readonly commands: string[] = [];
  fingerprints = [
    { count: "17", digest: "b".repeat(32) },
    { count: "17", digest: "b".repeat(32) },
  ];
  receipts: Record<string, unknown>[] = [storedReceipt()];

  async query<T = Record<string, unknown>>(
    sql: string,
  ): Promise<{ rows: T[]; rowCount: number }> {
    this.commands.push(sql.trim());
    if (sql.includes("SHOW transaction_read_only")) {
      return { rows: [{ transaction_read_only: "on" } as T], rowCount: 1 };
    }
    if (sql.includes("row_to_json(receipt_row)")) {
      const row = this.fingerprints.shift();
      return { rows: row ? [row as T] : [], rowCount: row ? 1 : 0 };
    }
    if (sql.includes("FROM mementos_project_registration_receipts")) {
      return { rows: this.receipts as T[], rowCount: this.receipts.length };
    }
    return { rows: [], rowCount: 0 };
  }
}

describe("historical project-registration receipt diagnostic", () => {
  test("proves the preserved receipt inside a read-only transaction without changing the table", async () => {
    const query = new DiagnosticQuery();
    const report = await diagnoseHistoricalProjectRegistrationReceipt(query);

    expect(report).toMatchObject({
      status: "PASS",
      transaction_read_only: true,
      exact_receipt_count: 1,
      table_count_before: "17",
      table_count_after: "17",
      table_digest_before: "b".repeat(32),
      table_digest_after: "b".repeat(32),
      receipt_id: expected.receipt_id,
      identity_digest: expected.identity_digest,
      target_digest: expected.target_digest,
      operation_digest: expected.operation_digest,
      idempotency_digest: expected.idempotency_digest,
      result_digest: expected.result_digest,
      receipt_digest: expected.receipt_digest,
      response_digest: expected.response_digest,
    });
    expect(query.commands[0]).toContain("READ ONLY");
    expect(query.commands.at(-1)).toBe("ROLLBACK");
    expect(query.commands.join("\n")).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
  });

  test.each([
    {
      name: "absent",
      mutate(query: DiagnosticQuery) {
        query.receipts = [];
      },
      code: "exact_receipt_count_not_one",
    },
    {
      name: "multiple",
      mutate(query: DiagnosticQuery) {
        query.receipts = [storedReceipt(), storedReceipt({ receipt_id: `mmpr_${"c".repeat(40)}` })];
      },
      code: "exact_receipt_count_not_one",
    },
    {
      name: "different",
      mutate(query: DiagnosticQuery) {
        query.receipts = [storedReceipt({ result_digest: "d".repeat(64) })];
      },
      code: "receipt_content_mismatch",
    },
    {
      name: "table changed",
      mutate(query: DiagnosticQuery) {
        query.fingerprints[1] = { count: "18", digest: "e".repeat(32) };
      },
      code: "table_count_changed",
    },
  ])("fails closed when the receipt is $name", async ({ mutate, code }) => {
    const query = new DiagnosticQuery();
    mutate(query);

    await expect(diagnoseHistoricalProjectRegistrationReceipt(query))
      .rejects.toMatchObject<HistoricalReceiptDiagnosticError>({ code });
    expect(query.commands.at(-1)).toBe("ROLLBACK");
  });
});
