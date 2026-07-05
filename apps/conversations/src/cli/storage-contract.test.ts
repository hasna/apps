import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const retiredCloudCommand = ["program.command(\"", "cloud", "\""].join("");
const retiredCloudExport = ["register", "Cloud", "Commands"].join("");

describe("conversations storage CLI contract", () => {
  it("reports canonical RDS metadata in status output without printing a URL", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "src/cli/index.tsx", "storage", "status", "--json"],
      cwd: join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        HASNA_CONVERSATIONS_DB_PATH: ":memory:",
        CONVERSATIONS_DB_PATH: ":memory:",
        HASNA_CONVERSATIONS_STORAGE_MODE: "local",
        NO_COLOR: "1",
      },
    });

    expect(result.exitCode).toBe(0);
    const stdout = new TextDecoder().decode(result.stdout);
    const info = JSON.parse(stdout) as {
      canonical: {
        cluster: string;
        database: string;
        runtimeSecretPath: string;
        env: string;
        fallbackEnv: string;
      };
      configured: boolean;
      table_groups: {
        cloudRuntime: string[];
        localOnly: string[];
      };
      message_uuid_duplicates: Array<{ uuid: string; count: number }>;
    };

    expect(info.canonical).toEqual({
      cluster: "hasna-xyz-infra-apps-prod-postgres",
      database: "conversations",
      runtimeSecretPath: "hasna/xyz/opensource/conversations/prod/rds",
      env: "HASNA_CONVERSATIONS_DATABASE_URL",
      fallbackEnv: "CONVERSATIONS_DATABASE_URL",
    });
    expect(info.configured).toBe(false);
    expect(info.table_groups.cloudRuntime).toContain("messages");
    expect(info.table_groups.cloudRuntime).toContain("message_read_receipts");
    expect(info.table_groups.localOnly).toContain("messages_fts");
    expect(info.message_uuid_duplicates).toEqual([]);
    expect(stdout).not.toContain("postgres://");
  });

  it("reports storage readiness without printing a URL", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "src/cli/index.tsx", "storage", "readiness", "--json"],
      cwd: join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        HASNA_CONVERSATIONS_DB_PATH: ":memory:",
        CONVERSATIONS_DB_PATH: ":memory:",
        HASNA_CONVERSATIONS_STORAGE_MODE: "local",
        NO_COLOR: "1",
      },
    });

    expect(result.exitCode).toBe(0);
    const stdout = new TextDecoder().decode(result.stdout);
    const info = JSON.parse(stdout) as {
      runtimePaths: Array<{ surface: string; status: string }>;
      privacyAndMigrationGates: string[];
    };

    expect(info.runtimePaths.find((path) => path.surface === "attachments")?.status).toBe("local_only");
    expect(info.privacyAndMigrationGates.join(" ")).toContain("Never print database URLs");
    expect(stdout).not.toContain("postgres://");
  });

  it("shows storage command in help without a cloud alias", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "src/cli/index.tsx", "--help"],
      cwd: join(import.meta.dir, "../.."),
      env: {
        ...process.env,
        HASNA_CONVERSATIONS_DB_PATH: ":memory:",
        CONVERSATIONS_DB_PATH: ":memory:",
        NO_COLOR: "1",
      },
    });

    const stdout = new TextDecoder().decode(result.stdout);
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain("storage");
    expect(stdout).not.toContain("cloud");
  });

  it("registers storage commands without retired cloud aliases", () => {
    const source = readFileSync(join(import.meta.dir, "storage.ts"), "utf8");

    expect(source).toContain("registerStorageCommands");
    expect(source).toContain('program.command("storage")');
    expect(source).toContain('storage.command("readiness")');
    expect(source).not.toContain(retiredCloudCommand);
    expect(source).not.toContain(retiredCloudExport);
  });
});
