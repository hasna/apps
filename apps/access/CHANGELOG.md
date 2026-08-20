# @hasna/access

## 0.1.4

### Patch Changes

- 4d6e8c2: fix(access): `access-serve --help`/`--version` answer before binding (the serve entry previously ignored both flags and bound the port unconditionally, hanging instead of answering help; binds-before-args class, BUG row 2920eed6). The plain serve path is unchanged.

## 0.1.3

### Patch Changes

- 70e4dd8: First release from the hasna/apps monorepo. The package was imported from hasna/access with history preserved (import commit 4582814); there are no functional changes since 0.1.1 — the delta is the import itself plus the monorepo workspace wiring. This patch establishes version ownership under the monorepo.
