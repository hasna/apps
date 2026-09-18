import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "../../../..");
const workflow = readFileSync(join(root, ".github/workflows/emails-current-migration-deploy.yml"), "utf8");
const reusable = readFileSync(join(root, ".github/workflows/emails-search-promotion-execute.yml"), "utf8");
const deploy = readFileSync(join(root, "tooling/deploy/emails-migration/deploy.py"), "utf8");
const gate = readFileSync(join(root, "tooling/deploy/emails-migration/gate.py"), "utf8");
const task = readFileSync(join(root, "tooling/deploy/emails-migration/task_receipt.js"), "utf8");

describe("Emails migration-aware current deployment", () => {
  test("is manual, exact-main, reviewed in three phases, and delegates AWS authority", () => {
    expect(workflow).toContain("name: emails-current-migration-deploy");
    expect(workflow).toContain("options: [reconcile, prepare, execute]");
    expect(workflow).not.toMatch(/^\s+push:/m);
    expect(workflow).toContain("group: emails-search-production");
    expect(workflow).toContain("uses: ./.github/workflows/emails-search-promotion-execute.yml");
    expect(workflow).not.toContain("configure-aws-credentials");
    expect(reusable).toContain("migration_reconcile");
    expect(reusable).toContain("migration_prepare");
    expect(reusable).toContain("migration_execute");
    expect(gate).toContain("EXACT_MAIN_CI_REQUIRED");
    expect(gate).toContain("MIGRATION_PLAN_REVIEW_BINDING");
  });

  test("orders expected drift, registration, reviewed plan, one migration, one service update, and final proofs", () => {
    const reconcile = deploy.indexOf("def reconcile(");
    const prepare = deploy.indexOf("def prepare(");
    const execute = deploy.indexOf("def execute(");
    const finalize = deploy.indexOf("def finalize(");
    expect(reconcile).toBeGreaterThan(0);
    expect(prepare).toBeGreaterThan(reconcile);
    expect(execute).toBeGreaterThan(prepare);
    expect(finalize).toBeGreaterThan(execute);
    expect(deploy).toContain('require(evidence["migrationDefinitionChanged"] is True, "MIGRATION_DEFINITION_DRIFT_EXPECTED")');
    expect(deploy).toContain('"serviceUpdated": False');
    expect(deploy).toContain('"databaseMutated": False');
    expect(deploy).toContain('"automaticRollback": False');
    expect(deploy).not.toContain("def rollback(");
    expect(deploy.match(/"update-service"/g)?.length).toBe(1);
    expect(reusable).toContain("Prove routed migration-aware current server");
    expect(reusable).toContain("Finalize ledger, KMS, task, image and public reconciliation");
    const authority = reusable.indexOf("Assume only the existing Emails producer role");
    const reconcileStep = reusable.indexOf("Reconcile failed image-only deployments");
    const prepareStep = reusable.indexOf("Register candidate without service update");
    const executeStep = reusable.indexOf("Apply reviewed migration once");
    const publicStep = reusable.indexOf("Prove routed migration-aware current server");
    const finalStep = reusable.indexOf("Finalize ledger, KMS, task, image and public reconciliation");
    expect(reconcileStep).toBeGreaterThan(authority);
    expect(prepareStep).toBeGreaterThan(reconcileStep);
    expect(executeStep).toBeGreaterThan(prepareStep);
    expect(publicStep).toBeGreaterThan(executeStep);
    expect(finalStep).toBeGreaterThan(publicStep);
    const readOnlyReconcile = deploy.slice(deploy.indexOf("def reconcile("), deploy.indexOf("def task_script("));
    expect(readOnlyReconcile).not.toMatch(/register-task-definition|run-task|update-service/);
  });

  test("task receipt binds production ledger checksums and applies once", () => {
    expect(task).toContain("SELECT id, checksum FROM schema_migrations ORDER BY id ASC");
    expect(task).toContain("migrationAcceptsChecksum");
    expect(task).toContain("EMAILS_MIGRATION_EXPECTED_LEDGER_SHA256");
    expect(task).toContain("EMAILS_MIGRATION_EXPECTED_PLAN_SHA256");
    expect(task.match(/\.migrate\(\)/g)?.length).toBe(1);
    expect(task).toContain("EMAILS_MIGRATION_RECEIPT:");
    expect(task).toContain("buildProviderRootKms");
    expect(task).not.toMatch(/console\.log\([^\n]*(key|plaintext|ciphertext)/i);
  });
});
