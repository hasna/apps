import { defineMigration, type Migration } from "../generated/storage-kit/migrations.js";
import { pgSchemaStatements } from "./schema.js";

// Ordered, forward-only logical migrations for the cloud (Postgres) backend,
// applied through the vendored kit's MigrationLedger. Never rewrite an applied
// migration — add a new one.
export function cloudMigrations(): Migration[] {
  return [defineMigration("0001_init", pgSchemaStatements().join(";\n\n") + ";")];
}
