import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { StaticInstallTicketSigningKeyProvider } from "../src/install-policy";
import { ComputersService } from "../src/service";
import { SQLiteStorage } from "../src/storage";

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

interface WorkerResult {
  ok: boolean;
  id?: string;
  message?: string;
  journalMode?: string;
  foreignKeys?: number;
  version?: number;
  fileModes?: number[];
}

async function runWorkers(work: Array<Record<string, string>>): Promise<WorkerResult[]> {
  const workerPath = new URL("./concurrency-worker.ts", import.meta.url).pathname;
  const children = work.map((item) => {
    const encoded = Buffer.from(JSON.stringify(item)).toString("base64url");
    const child = spawn(process.execPath, [workerPath, encoded], { stdio: ["pipe", "pipe", "pipe"] });
    return observeChild(child);
  });
  try {
    await Promise.all(children.map((child) => child.ready));
    for (const child of children) child.process.stdin.end("GO\n");
    const results = await Promise.all(children.map((child) => child.result));
    await Promise.all(children.map((child) => child.exited));
    return results;
  } finally {
    for (const child of children) if (child.process.exitCode === null) child.process.kill("SIGTERM");
  }
}

function observeChild(process: ChildProcessWithoutNullStreams): {
  process: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
  result: Promise<WorkerResult>;
  exited: Promise<void>;
} {
  let stderr = "";
  process.stderr.setEncoding("utf8");
  process.stderr.on("data", (chunk: string) => { stderr += chunk; });
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  let resultResolve!: (result: WorkerResult) => void;
  let resultReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const result = new Promise<WorkerResult>((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
  const lines = createInterface({ input: process.stdout });
  lines.on("line", (line) => {
    if (line === "READY") readyResolve();
    else {
      try { resultResolve(JSON.parse(line) as WorkerResult); }
      catch { resultReject(new Error("Worker returned malformed output")); }
    }
  });
  process.once("error", (error) => { readyReject(error); resultReject(error); });
  const exited = new Promise<void>((resolve, reject) => {
    process.once("exit", (code) => {
      if (code === 0) resolve();
      else {
        const error = new Error(`Worker exited with ${code ?? "signal"}${stderr === "" ? "" : `: ${stderr.trim()}`}`);
        readyReject(error); resultReject(error); reject(error);
      }
    });
  });
  return { process, ready, result, exited };
}

describe("real multi-connection quota concurrency", () => {
  test("100 independent processes allow one distinct child and one duplicate result", async () => {
    const directory = mkdtempSync(join(process.cwd(), ".test-data-concurrency-")); directories.push(directory);
    const database = join(directory, "controller.db");
    const storage = new SQLiteStorage(database); storage.migrate();
    const service = new ComputersService(storage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const admin = { tenantId: "tenant_concurrency", principalId: "principal_admin", scopes: ["computers:admin" as const], authMethod: "bearer" as const };
    const parent = service.createComputer(admin, { slug: "parent", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "concurrency-parent" });
    const allowedOwners = Array.from({ length: 100 }, (_, index) => `principal_child_${String(index).padStart(3, "0")}`);
    const grant = service.createComputerGrant(admin, {
      principalId: "principal_owner", ownerPrincipalId: "principal_owner", parentComputerId: parent.id,
      allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: allowedOwners, allowedRegions: ["local"],
      allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 600, maxBudgetMicros: 1000, limit: 1,
    } as never);
    storage.close();
    const distinct = await runWorkers(Array.from({ length: 100 }, (_, index) => ({
      database, parentComputerId: parent.id, grantId: grant.id, slug: `child-${index}`,
      ownerPrincipalId: allowedOwners[index] ?? "principal_child_missing", idempotencyKey: `concurrent-${String(index).padStart(3, "0")}`,
    })));
    expect(distinct.filter((item) => item.ok)).toHaveLength(1);

    const secondDirectory = mkdtempSync(join(process.cwd(), ".test-data-concurrency-")); directories.push(secondDirectory);
    const secondDatabase = join(secondDirectory, "controller.db");
    const secondStorage = new SQLiteStorage(secondDatabase); secondStorage.migrate();
    const secondService = new ComputersService(secondStorage, { ticketSigningKeyProvider: new StaticInstallTicketSigningKeyProvider(randomBytes(32)) });
    const secondParent = secondService.createComputer(admin, { slug: "parent-two", provider: "local_machine", ownerPrincipalId: "principal_owner", idempotencyKey: "concurrency-parent-two" });
    const secondGrant = secondService.createComputerGrant(admin, {
      principalId: "principal_owner", ownerPrincipalId: "principal_owner", parentComputerId: secondParent.id,
      allowedProviders: ["local_machine"], allowedChildOwnerPrincipalIds: ["principal_duplicate"], allowedRegions: ["local"],
      allowedProfileIds: ["profile_default"], maxStorageGiB: 32, maxUptimeSeconds: 600, maxBudgetMicros: 1000, limit: 1,
    } as never);
    secondStorage.close();
    const duplicateWork = { database: secondDatabase, parentComputerId: secondParent.id, grantId: secondGrant.id, slug: "duplicate", ownerPrincipalId: "principal_duplicate", idempotencyKey: "concurrent-duplicate" };
    const duplicates = await runWorkers(Array.from({ length: 100 }, () => duplicateWork));
    expect(duplicates.every((item) => item.ok)).toBe(true);
    expect(new Set(duplicates.map((item) => item.id)).size).toBe(1);
  }, 60_000);

  test("100 simultaneous connections initialize missing and existing databases for 10 repetitions each", async () => {
    for (const state of ["missing", "existing"] as const) {
      for (let repetition = 0; repetition < 10; repetition += 1) {
        const directory = mkdtempSync(join(process.cwd(), `.test-data-initialize-${state}-`)); directories.push(directory);
        const database = join(directory, "controller.db");
        if (state === "existing") {
          const storage = new SQLiteStorage(database);
          storage.migrate();
          storage.close();
        }
        const results = await runWorkers(Array.from({ length: 100 }, () => ({ mode: "initialize", database })));
        expect(results.filter((result) => !result.ok), `${state} repetition ${repetition + 1}: ${results.filter((result) => !result.ok).map((result) => result.message).join(", ")}`).toEqual([]);
        expect(results.every((result) => result.journalMode === "wal")).toBe(true);
        expect(results.every((result) => result.foreignKeys === 1)).toBe(true);
        expect(results.every((result) => result.version === 1)).toBe(true);
        expect(results.every((result) => (result.fileModes?.length ?? 0) >= 1 && result.fileModes?.every((mode) => mode === 0o600))).toBe(true);
      }
    }
  }, 180_000);
});
