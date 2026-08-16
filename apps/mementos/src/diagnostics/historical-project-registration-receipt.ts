import { pathToFileURL } from "node:url";
import pg, { type PoolClient } from "pg";
import {
  canonicalMementosProjectRegistrationJson,
  digestMementosProjectRegistrationValue,
} from "../project-registration/authority.js";
import {
  FLEET_RESOURCES_HISTORICAL_PROJECT_REGISTRATION as expected,
  FLEET_RESOURCES_HISTORICAL_RECEIPT,
  FLEET_RESOURCES_HISTORICAL_RESPONSE_CONTROL,
} from "../project-registration/historical-receipt.js";
import type { MementosProjectRegistrationReceipt } from "../project-registration/types.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface HistoricalReceiptDiagnosticQuery {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

interface StoredHistoricalReceipt extends MementosProjectRegistrationReceipt {
  target_selector: string;
  normalized_call_digest: string;
}

interface TableFingerprint {
  count: string;
  digest: string;
}

export interface HistoricalReceiptDiagnosticReport {
  schema: "mementos.historical-project-registration-receipt-diagnostic.v1";
  status: "PASS";
  transaction_read_only: true;
  exact_receipt_count: 1;
  table_count_before: string;
  table_count_after: string;
  table_digest_before: string;
  table_digest_after: string;
  table_count_unchanged: true;
  table_digest_unchanged: true;
  authority_id: string;
  tenant_id: string;
  corpus_id: string;
  operation_id: string;
  step_id: string;
  target_selector: string;
  target_id: string;
  receipt_id: string;
  identity_digest: string;
  target_digest: string;
  operation_digest: string;
  idempotency_digest: string;
  result_digest: string;
  receipt_digest: string;
  response_digest: string;
}

export class HistoricalReceiptDiagnosticError extends Error {
  constructor(readonly code: string) {
    super(`historical receipt diagnostic failed: ${code}`);
    this.name = "HistoricalReceiptDiagnosticError";
  }
}

const TABLE_FINGERPRINT_SQL = `
  SELECT
    COUNT(*)::text AS count,
    md5(COALESCE(
      string_agg(
        md5(row_to_json(receipt_row)::text),
        '' ORDER BY receipt_row.receipt_id
      ),
      ''
    )) AS digest
  FROM mementos_project_registration_receipts AS receipt_row
`;

const EXACT_RECEIPT_SQL = `
  SELECT
    receipt_id, authority, route, package_version, authority_id, tenant_id,
    corpus_id, operation_id, step_id, resource_kind, direction,
    target_selector, idempotency_key, request_digest, precondition_digest,
    normalized_call_digest, outcome, reason, target_id, result_revision,
    result_digest, duplicate_of_receipt_id, accepted_receipt_id,
    created_by_operation, created_at
  FROM mementos_project_registration_receipts
  WHERE authority_id = $1
    AND tenant_id = $2
    AND corpus_id = $3
    AND operation_id = $4
    AND step_id = $5
    AND resource_kind = $6
    AND direction = $7
    AND target_selector = $8
    AND idempotency_key = $9
    AND target_id = $10
  ORDER BY created_at ASC, receipt_id ASC
  LIMIT 2
`;

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function storedReceipt(row: Record<string, unknown>): StoredHistoricalReceipt {
  return {
    ...row,
    authority: "mementos",
    resource_kind: "project",
    direction: String(row["direction"]) as "forward" | "inverse",
    outcome: String(row["outcome"]) as StoredHistoricalReceipt["outcome"],
    created_by_operation:
      row["created_by_operation"] === true || Number(row["created_by_operation"]) === 1,
    created_at: timestamp(row["created_at"]),
  } as StoredHistoricalReceipt;
}

function publicReceipt(row: StoredHistoricalReceipt): MementosProjectRegistrationReceipt {
  const {
    target_selector: _targetSelector,
    normalized_call_digest: _normalizedCallDigest,
    ...receipt
  } = row;
  return receipt;
}

function assertEqual(actual: unknown, wanted: unknown, code: string): void {
  if (actual !== wanted) throw new HistoricalReceiptDiagnosticError(code);
}

function assertDigest(actual: string, wanted: string, code: string): void {
  if (!SHA256_PATTERN.test(actual) || actual !== wanted) {
    throw new HistoricalReceiptDiagnosticError(code);
  }
}

async function tableFingerprint(
  query: HistoricalReceiptDiagnosticQuery,
): Promise<TableFingerprint> {
  const result = await query.query<TableFingerprint>(TABLE_FINGERPRINT_SQL);
  if (result.rows.length !== 1) {
    throw new HistoricalReceiptDiagnosticError("table_fingerprint_unavailable");
  }
  const fingerprint = result.rows[0]!;
  if (!/^\d+$/.test(fingerprint.count) || !/^[0-9a-f]{32}$/.test(fingerprint.digest)) {
    throw new HistoricalReceiptDiagnosticError("table_fingerprint_invalid");
  }
  return fingerprint;
}

export async function diagnoseHistoricalProjectRegistrationReceipt(
  query: HistoricalReceiptDiagnosticQuery,
): Promise<HistoricalReceiptDiagnosticReport> {
  await query.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const readOnly = await query.query<{ transaction_read_only: string }>(
      "SHOW transaction_read_only",
    );
    assertEqual(
      readOnly.rows[0]?.transaction_read_only,
      "on",
      "transaction_not_read_only",
    );

    const before = await tableFingerprint(query);
    const exact = await query.query(EXACT_RECEIPT_SQL, [
      expected.authority_id,
      expected.tenant_id,
      expected.corpus_id,
      expected.operation_id,
      expected.step_id,
      expected.resource_kind,
      expected.direction,
      expected.target_selector,
      expected.idempotency_key,
      expected.target_id,
    ]);
    assertEqual(exact.rows.length, 1, "exact_receipt_count_not_one");

    const stored = storedReceipt(exact.rows[0]!);
    if (!SHA256_PATTERN.test(stored.normalized_call_digest)) {
      throw new HistoricalReceiptDiagnosticError("normalized_call_digest_invalid");
    }
    assertEqual(stored.target_selector, expected.target_selector, "target_selector_mismatch");

    const receipt = publicReceipt(stored);
    assertEqual(
      canonicalMementosProjectRegistrationJson(receipt),
      canonicalMementosProjectRegistrationJson(FLEET_RESOURCES_HISTORICAL_RECEIPT),
      "receipt_content_mismatch",
    );

    const identityDigest = digestMementosProjectRegistrationValue({
      authority_id: receipt.authority_id,
      tenant_id: receipt.tenant_id,
      corpus_id: receipt.corpus_id,
    });
    const targetDigest = digestMementosProjectRegistrationValue({
      authority_id: receipt.authority_id,
      tenant_id: receipt.tenant_id,
      corpus_id: receipt.corpus_id,
      target_selector: stored.target_selector,
      target_id: receipt.target_id,
    });
    const operationDigest = digestMementosProjectRegistrationValue({
      operation_id: receipt.operation_id,
      step_id: receipt.step_id,
      direction: receipt.direction,
    });
    const idempotencyDigest = digestMementosProjectRegistrationValue({
      idempotency_key: receipt.idempotency_key,
    });
    const receiptDigest = digestMementosProjectRegistrationValue(receipt);
    const responseDigest = digestMementosProjectRegistrationValue({
      receipt,
      response_control: FLEET_RESOURCES_HISTORICAL_RESPONSE_CONTROL,
    });

    assertDigest(identityDigest, expected.identity_digest, "identity_digest_mismatch");
    assertDigest(targetDigest, expected.target_digest, "target_digest_mismatch");
    assertDigest(operationDigest, expected.operation_digest, "operation_digest_mismatch");
    assertDigest(
      idempotencyDigest,
      expected.idempotency_digest,
      "idempotency_digest_mismatch",
    );
    assertDigest(receipt.result_digest!, expected.result_digest, "result_digest_mismatch");
    assertDigest(receiptDigest, expected.receipt_digest, "receipt_digest_mismatch");
    assertDigest(responseDigest, expected.response_digest, "response_digest_mismatch");

    const after = await tableFingerprint(query);
    assertEqual(after.count, before.count, "table_count_changed");
    assertEqual(after.digest, before.digest, "table_digest_changed");

    return {
      schema: "mementos.historical-project-registration-receipt-diagnostic.v1",
      status: "PASS",
      transaction_read_only: true,
      exact_receipt_count: 1,
      table_count_before: before.count,
      table_count_after: after.count,
      table_digest_before: before.digest,
      table_digest_after: after.digest,
      table_count_unchanged: true,
      table_digest_unchanged: true,
      authority_id: receipt.authority_id,
      tenant_id: receipt.tenant_id,
      corpus_id: receipt.corpus_id,
      operation_id: receipt.operation_id,
      step_id: receipt.step_id,
      target_selector: stored.target_selector,
      target_id: receipt.target_id!,
      receipt_id: receipt.receipt_id,
      identity_digest: identityDigest,
      target_digest: targetDigest,
      operation_digest: operationDigest,
      idempotency_digest: idempotencyDigest,
      result_digest: receipt.result_digest!,
      receipt_digest: receiptDigest,
      response_digest: responseDigest,
    };
  } finally {
    await query.query("ROLLBACK");
  }
}

async function main(): Promise<void> {
  const connectionString =
    process.env["HASNA_MEMENTOS_DATABASE_URL"]?.trim()
    || process.env["DATABASE_URL"]?.trim();
  if (!connectionString) {
    throw new HistoricalReceiptDiagnosticError("database_url_unavailable");
  }

  const parsed = new URL(connectionString);
  const sslMode = parsed.searchParams.get("sslmode")?.trim().toLowerCase();
  const sslEnabled = ["require", "verify-ca", "verify-full"].includes(sslMode ?? "")
    || ["1", "true", "yes", "on"].includes(
      parsed.searchParams.get("ssl")?.trim().toLowerCase() ?? "",
    );
  parsed.searchParams.delete("ssl");
  parsed.searchParams.delete("sslmode");
  const pool = new pg.Pool({
    connectionString: parsed.toString(),
    ssl: sslEnabled
      ? { rejectUnauthorized: sslMode === "verify-ca" || sslMode === "verify-full" }
      : undefined,
    max: 1,
  });
  const client: PoolClient = await pool.connect();
  try {
    const report = await diagnoseHistoricalProjectRegistrationReceipt({
      async query<T>(sql: string, values?: unknown[]) {
        const result = await client.query(sql, values);
        return {
          rows: result.rows as T[],
          rowCount: result.rowCount,
        };
      },
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
const invokedByBunEval = import.meta.url.endsWith("/%5Beval%5D");
if (import.meta.url === invokedPath || invokedByBunEval) {
  main().catch((error) => {
    const code = error instanceof HistoricalReceiptDiagnosticError
      ? error.code
      : "unexpected_failure";
    process.stderr.write(`historical receipt diagnostic failed: ${code}\n`);
    process.exitCode = 1;
  });
}
