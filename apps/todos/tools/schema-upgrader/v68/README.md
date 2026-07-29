# Detached SQLite v68 upgrader

This directory is a temporary cutover artifact for historical local SQLite
stores. It is deliberately absent from `package.json` scripts, bins, exports,
the published `files` list, and every production static or dynamic import.

Run it only with all todos processes stopped:

```bash
bun tools/schema-upgrader/v68/upgrade.ts --database /absolute/path/to/todos.db
```

The upgrader refuses non-contiguous or unknown migration histories, takes an
exclusive offline lock, creates and verifies a logical SQLite backup, upgrades
a working copy, verifies its exact schema hash and integrity, and only then
cuts it over. Its evidence JSON records per-table counts and hashes, durable
checkpoints, backup proof, and recovery paths.

Retirement trigger: delete this entire directory in the first release after the
v68 cutover support window closes. There is intentionally no runtime fallback;
stores that miss the window remain `upgrade-required` until an operator uses an
archived, version-pinned copy of this tool.
