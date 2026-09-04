import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrations } from "../db/schema.js";
import {
  createLocalTodosProjectRegistrationAuthority,
  deriveTodosProjectRegistrationIdempotencyKey,
  digestProjectRegistrationValue,
} from "../project-registration/index.js";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

const roots: string[] = [];

setDefaultTimeout(30_000);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function runCli(
  root: string,
  dbPath: string,
  requestPath: string,
  remote?: { apiUrl: string; apiKey: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const home = join(root, "home");
  mkdirSync(home, { recursive: true });
  const process = Bun.spawn([
    "bun",
    "run",
    "src/cli/index.tsx",
    "--json",
    "project-registration",
    "receipt-lookup",
    requestPath,
  ], {
    cwd: join(import.meta.dir, "../.."),
    env: localRoutingTestEnv({
      HOME: home,
      HASNA_TODOS_DB_PATH: dbPath,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_API_URL: remote?.apiUrl,
      HASNA_TODOS_API_KEY: remote?.apiKey,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("project-registration receipt lookup CLI", () => {
  test("retrieves an exact historical receipt without weakening the current package identity", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-project-registration-cli-"));
    roots.push(root);
    const dbPath = join(root, "todos.db");
    const requestPath = join(root, "lookup.json");
    const db = new Database(dbPath);
    runMigrations(db);
    const historicalPackageVersion = "1.0.0-rc.3";
    const historicalCorpusId =
      "todos:adfd95c7-ee8b-52cb-ae47-4ae65dae3313:postgresql";
    const historical = createLocalTodosProjectRegistrationAuthority(db, {
      packageVersion: historicalPackageVersion,
      authorityId: "todos",
      tenantId: "sqlite",
      corpusId: historicalCorpusId,
      now: () => "2026-08-07T10:00:00.000Z",
    });
    const desired = {
      source_project_id: "wks_cli_historical01",
      source_project_slug: "cli-historical-receipt",
      name: "CLI historical receipt",
    };
    const operationId = "cli-historical-receipt-registration-0001";
    const stepId = "todos_project";
    const targetSelector = desired.source_project_id;
    const requestDigest = digestProjectRegistrationValue(desired);
    const preconditionDigest = digestProjectRegistrationValue({
      target_selector: targetSelector,
      expected: "absent",
    });
    const idempotencyKey = deriveTodosProjectRegistrationIdempotencyKey({
      operation_id: operationId,
      step_id: stepId,
      direction: "forward",
      target_selector: targetSelector,
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
    });
    const receipt = await historical.create({
      operation_id: operationId,
      step_id: stepId,
      resource_kind: "project",
      direction: "forward",
      authority_route: "todos.project-registration.v1",
      package_version: historicalPackageVersion,
      authority_id: "todos",
      tenant_id: "sqlite",
      corpus_id: historicalCorpusId,
      target_selector: targetSelector,
      idempotency_key: idempotencyKey,
      request_digest: requestDigest,
      precondition_digest: preconditionDigest,
      project_id: targetSelector,
      project_slug: desired.source_project_slug,
      project_name: desired.name,
      desired,
      target: null,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    });
    db.close();

    const lookup = {
      operation_id: operationId,
      step_id: stepId,
      resource_kind: "project",
      direction: "forward",
      authority: "todos",
      authority_route: "todos.project-registration.v1",
      package_version: historicalPackageVersion,
      authority_id: "todos",
      tenant_id: "sqlite",
      corpus_id: historicalCorpusId,
      target_selector: targetSelector,
      idempotency_key: idempotencyKey,
      target_id: receipt.target_id,
      max_items: 1,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    };
    writeFileSync(requestPath, JSON.stringify(lookup));

    const success = await runCli(root, dbPath, requestPath);
    expect(success.exitCode).toBe(0);
    // Explicit-opt-in local runs no longer emit the legacy todos-local-fallback notice (removed by the fail-closed ruling, hasna/apps#1613): a stderr that still carries it means a stale binary or a regression.
    expect(success.stderr).not.toContain('"event":"todos-local-fallback"');
    expect(JSON.parse(success.stdout)).toMatchObject({
      receipt: {
        receipt_id: receipt.receipt_id,
        route: "todos.project-registration.v1",
        package_version: historicalPackageVersion,
      },
      response_control: { complete: true, truncated: false },
    });

    writeFileSync(requestPath, JSON.stringify({
      ...lookup,
      corpus_id: "todos:sqlite",
    }));
    const currentCorpus = await runCli(root, dbPath, requestPath);
    expect(currentCorpus.exitCode).toBe(1);
    expect(currentCorpus.stderr).toContain("no exact terminal receipt matched");

    writeFileSync(requestPath, JSON.stringify({
      ...lookup,
      package_version: "1.0.0-rc.7",
    }));
    const wrongVersion = await runCli(root, dbPath, requestPath);
    expect(wrongVersion.exitCode).toBe(1);
    expect(wrongVersion.stderr).toContain("no exact terminal receipt matched");
    expect(JSON.parse(wrongVersion.stdout)).toMatchObject({
      error: expect.stringContaining("no exact terminal receipt matched"),
    });
  });

  test("routes the CLI lookup through the authenticated HTTP authority without local fallback", async () => {
    const root = mkdtempSync(join(tmpdir(), "todos-project-registration-cli-http-"));
    roots.push(root);
    const requestPath = join(root, "lookup.json");
    const lookup = {
      operation_id: "cli-http-historical-receipt-registration-0001",
      step_id: "todos_project",
      resource_kind: "project",
      direction: "forward",
      authority: "todos",
      authority_route: "todos.project-registration.v1",
      package_version: "1.0.0-rc.3",
      authority_id: "todos-http-test",
      tenant_id: "tenant-http-test",
      corpus_id: "corpus-http-test",
      target_selector: "wks_cli_http_historical01",
      idempotency_key: `prk_${"7".repeat(48)}`,
      target_id: "77777777-7777-4777-8777-777777777777",
      max_items: 1,
      response_byte_limit: 65_536,
      time_budget_ms: 5_000,
    } as const;
    writeFileSync(requestPath, JSON.stringify(lookup));
    let receivedPath = "";
    let receivedBody: unknown;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        receivedPath = new URL(request.url).pathname;
        receivedBody = await request.json();
        return Response.json({
          receipt: {
            receipt_id: "tpr_7777777777777777777777777777777777777777",
            authority: "todos",
            route: lookup.authority_route,
            package_version: lookup.package_version,
            authority_id: lookup.authority_id,
            tenant_id: lookup.tenant_id,
            corpus_id: lookup.corpus_id,
            operation_id: lookup.operation_id,
            step_id: lookup.step_id,
            resource_kind: lookup.resource_kind,
            direction: lookup.direction,
            idempotency_key: lookup.idempotency_key,
            request_digest: "8".repeat(64),
            precondition_digest: "9".repeat(64),
            outcome: "accepted",
            reason: null,
            target_id: lookup.target_id,
            result_revision: "2026-08-07T10:00:00.000Z",
            result_digest: "a".repeat(64),
            duplicate_of_receipt_id: null,
            accepted_receipt_id: null,
            created_by_operation: true,
            created_at: "2026-08-07T10:00:00.000Z",
          },
          response_control: {
            response_byte_limit: lookup.response_byte_limit,
            time_budget_ms: lookup.time_budget_ms,
            response_bytes: 1_024,
            elapsed_ms: 1,
            complete: true,
            truncated: false,
          },
        });
      },
    });
    try {
      const result = await runCli(
        root,
        join(root, "unused-local.db"),
        requestPath,
        { apiUrl: `http://127.0.0.1:${server.port}`, apiKey: "fixture-api-key" },
      );
      expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({
        exitCode: 0,
        stderr: "",
      });
      expect(receivedPath).toBe("/v1/project-registration/receipts/lookup");
      expect(receivedBody).toEqual(lookup);
      expect(JSON.parse(result.stdout)).toMatchObject({
        receipt: {
          route: lookup.authority_route,
          package_version: lookup.package_version,
          target_id: lookup.target_id,
        },
        response_control: { complete: true, truncated: false },
      });
    } finally {
      server.stop(true);
    }
  });
});
