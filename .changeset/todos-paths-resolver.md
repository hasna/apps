---
"@hasna/todos": patch
---

Switch @hasna/todos local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/todos` default stays the effective data home until the store has actually been migrated to the XDG data home (`todos.db` or `config.json` exists there) or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The global database, config, training, replays, sandbox profiles, cloud-task-id cache, and the install-time postinstall provisioning all resolve through the same effective root; the project-local `.hasna/todos` stores and the file-level `HASNA_TODOS_DB_PATH` / `TODOS_DB_PATH` / `TODOS_SANDBOX_PROFILES_PATH` overrides are unchanged and still win. The dependency is pinned exactly to `@hasna/paths@0.1.0` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).
