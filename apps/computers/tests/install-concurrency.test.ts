import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { AuthorizationContext } from "../src/contracts";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

function applyInWorker(work: Record<string, string>): Promise<{ ok: boolean; id?: string }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./install-concurrency-worker.ts", import.meta.url));
    worker.once("message", (result) => { void worker.terminate(); resolve(result as { ok: boolean; id?: string }); });
    worker.once("error", reject);
    worker.postMessage(work);
  });
}

describe("install ticket transaction concurrency", () => {
  test("same ticket and request across separate connections returns one operation and one audit/outbox effect", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-install-concurrency-")); directories.push(directory);
    const database = join(directory, "controller.db");
    const storage = new SQLiteStorage(database); storage.migrate();
    const admin: AuthorizationContext = { tenantId: "tenant_install_concurrency", principalId: "principal_admin", scopes: ["computers:admin"], authMethod: "bearer" };
    const service = new ComputersService(storage);
    const computer = service.createComputer(admin, { slug: "install-concurrency", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "install-concurrency-create" });
    service.createInstallPolicy(admin, computer.id, [{ effect: "allow", managers: ["bun"] }]);
    const owner: AuthorizationContext = { tenantId: admin.tenantId, principalId: "principal_owner", scopes: ["computers:install"], boundComputerId: computer.id, policyGeneration: 2, authMethod: "bearer" };
    const ticket = service.installPlan(owner, computer.id, {
      manager: "bun", name: "concurrent-package", version: "1.0.0", digest: `sha256:${"a".repeat(64)}`,
      registry: "https://registry.example.invalid/", dependencyClosure: [], allowLifecycleScripts: false,
    }).ticket ?? "";
    storage.close();
    const work = { database, computerId: computer.id, ticket, idempotencyKey: "install-concurrent-apply" };
    const results = await Promise.all(Array.from({ length: 20 }, () => applyInWorker(work)));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    const verify = new SQLiteStorage(database);
    try {
      expect((verify.database.query("SELECT COUNT(*) AS count FROM operations WHERE kind = 'install'").get() as { count: number }).count).toBe(1);
      expect((verify.database.query("SELECT COUNT(*) AS count FROM audit_events WHERE action = 'install.apply_requested'").get() as { count: number }).count).toBe(1);
      expect((verify.database.query(`SELECT COUNT(*) AS count FROM outbox_events o JOIN audit_events a
        ON json_extract(o.payload_json, '$.auditEventId') = a.id WHERE a.action = 'install.apply_requested'`).get() as { count: number }).count).toBe(1);
      expect((verify.database.query("SELECT COUNT(*) AS count FROM outbox_events").get() as { count: number }).count).toBe((verify.database.query("SELECT COUNT(*) AS count FROM audit_events").get() as { count: number }).count);
    } finally { verify.close(); }
  }, 30_000);
});
