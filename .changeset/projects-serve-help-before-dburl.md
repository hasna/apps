---
"@hasna/projects": patch
---

`projects-serve --help` and `projects-serve --version` now answer (rc=0, stdout) without a configured `HASNA_PROJECTS_DATABASE_URL`. Previously the serve entrypoint resolved the database URL before any argument handling, so help/version could not be answered without a DB URL (binds-before-args class, bug O15-00084). The fail-closed no-URL error for actual server start is unchanged.
