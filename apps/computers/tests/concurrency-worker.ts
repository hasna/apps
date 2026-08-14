import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, statSync } from "node:fs";
import { ComputersError, type InstallPolicyRule } from "../src/contracts";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { createProviderPorts } from "../src/providers";
import { ComputersService } from "../src/service";
import { makeId, sha256, SQLiteStorage } from "../src/storage";
import { OperationWorker } from "../src/worker";

interface Work {
  mode?: "quota" | "initialize" | "provider-attempt" | "provider-claim-fence" | "policy-cas" | "lifecycle-start";
  database: string;
  tenantId?: string;
  markerPath?: string;
  computerId?: string;
  slug?: string;
  ownerPrincipalId?: string;
  parentComputerId?: string;
  grantId?: string;
  idempotencyKey?: string;
  policyEffect?: "allow" | "deny";
}

async function waitForStart(): Promise<void> {
  process.stdout.write("READY\n");
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });
}

async function waitForRelease(): Promise<void> {
  process.stdout.write("CHECKED\n");
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });
}

async function execute(work: Work): Promise<Record<string, unknown>> {
  let storage: SQLiteStorage | undefined;
  try {
    storage = new SQLiteStorage(work.database);
    storage.migrate();
    if (work.mode === "initialize") {
      const journal = storage.database.query("PRAGMA journal_mode").get() as { journal_mode: string };
      const foreignKeys = storage.database.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
      const migration = storage.database.query("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number };
      const fileModes = [work.database, `${work.database}-wal`, `${work.database}-shm`]
        .filter((path) => existsSync(path)).map((path) => statSync(path).mode & 0o777);
      return { ok: storage.ready(), journalMode: journal.journal_mode, foreignKeys: foreignKeys.foreign_keys, version: migration.version, fileModes };
    }
    if (work.mode === "provider-attempt") {
      if (work.tenantId === undefined || work.markerPath === undefined) throw new Error("Missing provider-attempt input");
      const provider = {
        kind: "local_machine" as const,
        readiness: async () => ({ provider: "local_machine" as const, configured: true, ready: true, confinementClass: "dedicated_machine" as const, controls: {}, limitations: [] }),
        create: async () => {
          appendFileSync(work.markerPath as string, `${process.pid}\n`, { encoding: "utf8", mode: 0o600 });
          return { kind: "success" as const, resource: { resourceId: "resource_concurrent_attempt" }, result: { lifecycle: "stopped" } };
        },
        start: async () => ({ kind: "definite_failure" as const, code: "unexpected", message: "unexpected" }),
        stop: async () => ({ kind: "definite_failure" as const, code: "unexpected", message: "unexpected" }),
        quarantine: async () => ({ kind: "definite_failure" as const, code: "unexpected", message: "unexpected" }),
        delete: async () => ({ kind: "definite_failure" as const, code: "unexpected", message: "unexpected" }),
        restore: async () => ({ kind: "definite_failure" as const, code: "unexpected", message: "unexpected" }),
        reconcile: async () => ({ kind: "success" as const, resource: { resourceId: "resource_concurrent_attempt" }, result: { lifecycle: "stopped", reconciled: true } }),
      };
      const providers = createProviderPorts();
      providers.local_machine = provider;
      const handled = await new OperationWorker(storage, providers).runTenant(work.tenantId);
      return { ok: true, handled };
    }
    if (work.mode === "provider-claim-fence") {
      if (work.tenantId === undefined || work.computerId === undefined) throw new Error("Missing provider-claim-fence input");
      const operation = storage.listOperations(work.tenantId, work.computerId)
        .find((candidate) => candidate.kind === "create");
      if (operation === undefined) throw new Error("Provider claim operation is missing");
      storage.assertOperationPolicyCurrent(work.tenantId, operation.id);
      await waitForRelease();
      const claim = storage.claimProviderAttempt(operation);
      return { ok: true, mode: claim.mode };
    }
    if (work.mode === "policy-cas") {
      if (work.tenantId === undefined || work.computerId === undefined || work.policyEffect === undefined) {
        throw new Error("Missing policy-cas input");
      }
      const computer = storage.getComputer(work.tenantId, work.computerId);
      if (computer === undefined) throw new Error("Policy Computer is missing");
      const generation = computer.policyGeneration + 1;
      const rules: InstallPolicyRule[] = [{ effect: work.policyEffect }];
      const revision = {
        id: makeId("pol"), tenantId: work.tenantId, computerId: work.computerId, generation,
        digest: sha256({ tenantId: work.tenantId, computerId: work.computerId, generation, rules }),
        rules, createdAt: new Date().toISOString(),
      };
      await waitForRelease();
      const saved = storage.createInstallPolicy(revision, {
        actorPrincipalId: "principal_concurrency", action: "install_policy.revision_created",
        data: { generation, digest: revision.digest }, computerId: work.computerId,
      });
      return { ok: true, id: saved.id, generation: saved.generation, digest: saved.digest };
    }
    if (work.mode === "lifecycle-start") {
      if (work.tenantId === undefined || work.computerId === undefined || work.markerPath === undefined || work.idempotencyKey === undefined) {
        throw new Error("Missing lifecycle-start input");
      }
      appendFileSync(work.markerPath, `${process.pid}\n`, { encoding: "utf8", mode: 0o600 });
      const computer = storage.getComputer(work.tenantId, work.computerId);
      if (computer === undefined) throw new Error("Lifecycle Computer is missing");
      const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
      const operation = service.requestLifecycle({
        tenantId: work.tenantId, principalId: computer.ownerPrincipalId,
        scopes: ["computers:read", "computers:operate"], boundComputerId: computer.id,
        policyGeneration: computer.policyGeneration, authMethod: "bearer",
      }, computer.id, "start", work.idempotencyKey);
      return { ok: true, id: operation.id };
    }
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const computer = service.createComputer({
      tenantId: "tenant_concurrency", principalId: "principal_owner", scopes: ["computers:create"],
      boundComputerId: work.parentComputerId ?? "", policyGeneration: 1, authMethod: "bearer",
    }, {
      slug: work.slug ?? "", provider: "local_machine", ownerPrincipalId: work.ownerPrincipalId ?? "",
      parentComputerId: work.parentComputerId, grantId: work.grantId, region: "local", profileId: "profile_default",
      storageGiB: 16, uptimeSeconds: 300, budgetMicros: 500, idempotencyKey: work.idempotencyKey ?? "",
    } as never);
    return { ok: true, id: computer.id };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "unknown",
      ...(error instanceof ComputersError ? { code: error.code, status: error.status } : {}),
    };
  } finally { storage?.close(); }
}

const encodedWork = process.argv[2];
if (encodedWork === undefined) throw new Error("Missing worker input");
const work = JSON.parse(Buffer.from(encodedWork, "base64url").toString("utf8")) as Work;
await waitForStart();
process.stdout.write(`${JSON.stringify(await execute(work))}\n`);
