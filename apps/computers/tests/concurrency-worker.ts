import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

interface Work {
  mode?: "quota" | "initialize";
  database: string;
  slug?: string;
  ownerPrincipalId?: string;
  parentComputerId?: string;
  grantId?: string;
  idempotencyKey?: string;
}

async function waitForStart(): Promise<void> {
  process.stdout.write("READY\n");
  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });
}

function execute(work: Work): Record<string, unknown> {
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
    return { ok: false, message: error instanceof Error ? error.message : "unknown" };
  } finally { storage?.close(); }
}

const encodedWork = process.argv[2];
if (encodedWork === undefined) throw new Error("Missing worker input");
const work = JSON.parse(Buffer.from(encodedWork, "base64url").toString("utf8")) as Work;
await waitForStart();
process.stdout.write(`${JSON.stringify(execute(work))}\n`);
