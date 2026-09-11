---
"@hasna/calendar": patch
---

Keep `bun:sqlite` out of the `calendar` and `calendar-mcp` bundles entirely.
The CLI build emitted its code-split chunks next to the entry (`dist/cli/`), so
the chunk behind the LOCAL-only `db-migrate` command still carried the SQLite
import inside the CLI bundle directory. Chunks now land in `dist/chunks/`;
`dist/cli/index.js` and `dist/mcp/index.js` contain no `bun:sqlite` reference,
and the local chunk is loaded only by `db-migrate` after it has confirmed no
hosted credential or authority resolves (ruling d, hasna/apps#1720).
