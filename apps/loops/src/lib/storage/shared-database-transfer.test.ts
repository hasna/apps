import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { AppliedStorageMigration } from "./contract.js";
import {
  assertExactLedger,
  buildPgServiceFile,
  expectedLedgerRows,
  pgDumpCommand,
  pgRestoreCommand,
  runSharedToDedicatedTransfer,
  SHARED_TRANSFER_FIXED_COMMAND,
  SHARED_TRANSFER_SOURCE_DSN_ENV,
  SHARED_TRANSFER_SOURCE_DATABASE,
  SHARED_TRANSFER_TABLES,
  SHARED_TRANSFER_TARGET_DSN_ENV,
  SHARED_TRANSFER_TARGET_DATABASE,
  type CommandRunner,
} from "./shared-database-transfer.js";

const sourceDsn = "postgresql://source:source-secret@shared-rds.internal:5432/apps?sslmode=verify-full";
const targetDsn = "postgresql://target:target-secret@dedicated-rds.internal:5432/loops?sslmode=verify-full";

function ledgerRows(through: string): AppliedStorageMigration[] {
  return expectedLedgerRows(through).map((row) => ({ ...row, appliedAt: "2026-07-16T00:00:00.000Z" }));
}

describe("shared database transfer", () => {
  test("builds a private pg service file so DSNs do not appear in pg command argv", () => {
    const service = buildPgServiceFile(sourceDsn, targetDsn);
    expect(service).toContain("[openloops_transfer_source]");
    expect(service).toContain("dbname=apps");
    expect(service).toContain("password=source-secret");
    expect(service).toContain("[openloops_transfer_target]");
    expect(service).toContain("dbname=loops");
    expect(service).toContain("password=target-secret");

    const dump = pgDumpCommand("/tmp/private/openloops-allowlist.dump");
    const restore = pgRestoreCommand("/tmp/private/openloops-allowlist.dump");
    expect(dump).toContain("--dbname=service=openloops_transfer_source");
    expect(restore).toContain("--dbname=service=openloops_transfer_target");
    expect(dump.join(" ")).not.toContain("source-secret");
    expect(restore.join(" ")).not.toContain("target-secret");
  });

  test("pins the logical dump to the OpenLoops allowlist and never snapshots the shared cluster", () => {
    const command = pgDumpCommand("/tmp/private/openloops-allowlist.dump");
    expect(command).toContain("--format=custom");
    expect(command).toContain("--data-only");
    expect(command).toContain("--no-owner");
    expect(command).toContain("--no-privileges");
    for (const table of SHARED_TRANSFER_TABLES) {
      expect(command).toContain(`--table=public.${table.name}`);
    }
    expect(command.join(" ")).not.toContain("snapshot");
    expect(command.join(" ")).not.toContain("restore-db");
  });

  test("rejects missing ledger rows, checksum drift, and unexpected target migrations", () => {
    expect(() => assertExactLedger(ledgerRows("0007_work_item_gate_deaths"), "0007_work_item_gate_deaths", "target"))
      .not.toThrow();
    expect(() => assertExactLedger(ledgerRows("0006_work_item_machine_id"), "0007_work_item_gate_deaths", "target"))
      .toThrow("missing 0007_work_item_gate_deaths");
    expect(() => assertExactLedger(
      ledgerRows("0007_work_item_gate_deaths").map((row) =>
        row.id === "0004_work_item_route_scope" ? { ...row, checksum: "sha256:wrong" } : row),
      "0007_work_item_gate_deaths",
      "target",
    )).toThrow("checksum mismatch");
    expect(() => assertExactLedger(ledgerRows("0008_tenant_prepare"), "0007_work_item_gate_deaths", "target"))
      .toThrow("unexpected rows: 0008_tenant_prepare");
  });

  test("runs fixed PG16 logical transfer steps with filtered api_keys and cleans the archive", async () => {
    const commands: Array<{ command: readonly string[]; input?: string; env?: Record<string, string> }> = [];
    let serviceFilePath = "";
    const runner: CommandRunner = async (command, opts = {}) => {
      commands.push({ command, input: opts.input, env: opts.env });
      if (opts.env?.PGSERVICEFILE) serviceFilePath = opts.env.PGSERVICEFILE;
      if (command[1] === "--version") return { exitCode: 0, stdout: `${command[0]} (PostgreSQL) 16.9\n`, stderr: "" };
      if (command[0] === "pg_dump") {
        const fileArg = command.find((part) => part.startsWith("--file="));
        expect(fileArg).toBeDefined();
        writeFileSync(fileArg!.slice("--file=".length), "allowlisted archive");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (command[0] === "pg_restore") return { exitCode: 0, stdout: "", stderr: "" };
      const sql = command[command.length - 1]!;
      if (sql.includes("pg_class")) return { exitCode: 0, stdout: "[]\n", stderr: "" };
      if (sql.includes("FROM public.open_loops_schema_migrations")) {
        return { exitCode: 0, stdout: `${JSON.stringify(ledgerRows("0010_tenant_enforce"))}\n`, stderr: "" };
      }
      if (sql.includes("active_count")) return { exitCode: 0, stdout: "[]\n", stderr: "" };
      if (sql.includes("COUNT(*)::text AS row_count")) {
        return {
          exitCode: 0,
          stdout: `${JSON.stringify([
            ...SHARED_TRANSFER_TABLES.map((table) => ({ table_name: table.name, row_count: "1" })),
            { table_name: "api_keys", row_count: "1" },
          ])}\n`,
          stderr: "",
        };
      }
      if (sql.includes("row_to_json(row_data)")) return { exitCode: 0, stdout: "{\"id\":\"row\"}\n", stderr: "" };
      if (sql.includes("FROM public.api_keys WHERE app = 'loops' ORDER BY kid")) {
        return { exitCode: 0, stdout: "kid-1,loops,,{},hash,2026-07-16 00:00:00+00,,,,,,2026-07-16 00:00:00+00\n", stderr: "" };
      }
      if (sql.includes("COPY public.api_keys")) {
        expect(opts.input).toContain("kid-1,loops");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      if (sql.includes("app <> 'loops'")) return { exitCode: 0, stdout: "0\n", stderr: "" };
      if (sql.includes("orphan_count")) return { exitCode: 0, stdout: "[]\n", stderr: "" };
      throw new Error(`unexpected command: ${command.join(" ")}`);
    };
    const migratedThrough: string[] = [];
    const evidence = await runSharedToDedicatedTransfer({
      env: {
        PATH: "/usr/bin",
        [SHARED_TRANSFER_SOURCE_DSN_ENV]: sourceDsn,
        [SHARED_TRANSFER_TARGET_DSN_ENV]: targetDsn,
      },
      runner,
      migrateTargetThrough: async (_dsn, through) => {
        migratedThrough.push(through);
        return ledgerRows(through);
      },
      now: () => new Date("2026-07-16T12:00:00.000Z"),
    });

    expect(migratedThrough).toEqual(["0007_work_item_gate_deaths", "0008_tenant_prepare"]);
    expect(evidence.command).toEqual(SHARED_TRANSFER_FIXED_COMMAND);
    expect(evidence.source.database).toBe(SHARED_TRANSFER_SOURCE_DATABASE);
    expect(evidence.target.database).toBe(SHARED_TRANSFER_TARGET_DATABASE);
    expect(evidence.archive.cleaned).toBe(true);
    expect(existsSync(join(serviceFilePath, ".."))).toBe(false);
    expect(evidence.apiKeys.copiedRows).toBe(1);
    expect(evidence.apiKeys.nonLoopRowsOnTarget).toBe(0);
    expect(evidence.unexpectedTargetObjects).toEqual([]);
    expect(commands.some(({ command }) => command[0] === "pg_dump")).toBe(true);
    expect(commands.some(({ command }) => command[0] === "pg_restore")).toBe(true);
    expect(commands.flatMap(({ command }) => command).join(" ")).not.toContain("source-secret");
    expect(commands.flatMap(({ command }) => command).join(" ")).not.toContain("target-secret");
  });

  test("fails closed unless DSNs identify source apps and target loops databases", async () => {
    await expect(runSharedToDedicatedTransfer({
      env: {
        [SHARED_TRANSFER_SOURCE_DSN_ENV]: "postgresql://source@host/not_apps",
        [SHARED_TRANSFER_TARGET_DSN_ENV]: targetDsn,
      },
      runner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      migrateTargetThrough: async () => [],
    })).rejects.toThrow("database apps");
    await expect(runSharedToDedicatedTransfer({
      env: {
        [SHARED_TRANSFER_SOURCE_DSN_ENV]: sourceDsn,
        [SHARED_TRANSFER_TARGET_DSN_ENV]: "postgresql://target@host/not_loops",
      },
      runner: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      migrateTargetThrough: async () => [],
    })).rejects.toThrow("database loops");
  });
});
