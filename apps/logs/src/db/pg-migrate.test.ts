import { describe, expect, test } from "bun:test";
import { logsCloudMigrations } from "./pg-migrate.ts";
import { PG_MIGRATIONS } from "./pg-migrations.ts";

const HISTORICAL_SCHEMA_CHECKSUM =
  "sha256:cf7a20cf49b76cd13ada3cd00b4df66cbd69a4b1889c84a8946b97b6103e365a";

describe("PostgreSQL migration compatibility", () => {
  test("keeps the already-applied 0001 schema checksum immutable", () => {
    const schema = logsCloudMigrations().find(
      (migration) => migration.id === "0001_logs_pg_schema",
    );

    expect(schema?.checksum).toBe(HISTORICAL_SCHEMA_CHECKSUM);
  });

  test("adds artifact object_key only through the additive migration", () => {
    const artifactCreate = PG_MIGRATIONS.find((sql) =>
      sql.includes("CREATE TABLE IF NOT EXISTS artifacts"),
    );
    const migrations = logsCloudMigrations();
    const objectKeyMigration = migrations.find(
      (migration) => migration.id === "0003_logs_artifact_object_key",
    );

    expect(artifactCreate).toBeDefined();
    expect(artifactCreate).not.toContain("object_key");
    expect(PG_MIGRATIONS.join("\n")).not.toContain(
      "ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS object_key",
    );
    expect(objectKeyMigration?.sql).toBe(
      "ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS object_key TEXT",
    );
  });
});
