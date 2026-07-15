import { parentPort } from "node:worker_threads";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

interface Work { database: string; computerId: string; ticket: string; idempotencyKey: string; }

parentPort?.on("message", (work: Work) => {
  const storage = new SQLiteStorage(work.database);
  try {
    const service = new ComputersService(storage);
    const operation = service.installApply({
      tenantId: "tenant_install_concurrency", principalId: "principal_owner", scopes: ["computers:install"],
      boundComputerId: work.computerId, policyGeneration: 2, authMethod: "bearer",
    }, work.computerId, work.ticket, work.idempotencyKey);
    parentPort?.postMessage({ ok: true, id: operation.id });
  } catch {
    parentPort?.postMessage({ ok: false });
  } finally { storage.close(); }
});
