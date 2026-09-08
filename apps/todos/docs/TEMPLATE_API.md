# Shared template commands

Stateful template CLI commands use the authenticated Todos API and saved account credentials. `templates` list/add/update/delete/use, preview, export, import, history, and initialization (including plural aliases) reject local database selectors before command imports. IDs may be unambiguous ID prefixes; names do not silently select a template.

`template-library` list/show/write uses bundled definitions only and requires neither credentials nor a database. Explicitly requested JSON files remain local artifacts.

The API stores template/checklist creation atomically. Revision-checked updates save the previous template and its full checklist before updating, in one transaction. History reports missing versions explicitly for older PostgreSQL rows whose prior updates did not record snapshots. Missing historical content is never reconstructed. Template deletion removes the reusable template/checklist, preserves already-created tasks, and retains new historical records for future migration/export support.

Initialization uses the server-owned library. The bundled source currently contains 13 definitions, including distinct definitions with duplicate names. First initialization preserves all definitions. Later or concurrent initialization skips definitions whose name already existed; receipts identify all matching skipped IDs rather than choosing one. It does not overwrite existing templates.

Applying a template preserves variable, condition, include and dependency behavior. Included templates and variables are preflighted, then existing task/dependency API writes execute once. If a later write fails, the CLI reports confirmed created task IDs, confirmed dependencies, and any ambiguous pending operation with a nonzero exit. It does not delete successful tasks or retry the application automatically.

## Migration follow-up required

The current generic `TodosStorageSnapshot` has templates and checklist rows but no `template_versions` field. Historical SQLite version rows, and the new PostgreSQL historical rows, are therefore not yet covered by snapshot/export/import. A separate versioned, lossless transfer change is required before any database retirement. The generic snapshot importer also does not yet share the template parent lock for checklist writes; atomic history capture against that separate writer is not established by this command transition. The transfer follow-up must fence those writes and preserve exact snapshot text, including orphan history, before claiming complete migration. This command transition performs no migration or deletion of user databases and does not claim all Todos CLI/MCP surfaces are converted.
