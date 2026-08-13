# State layout

`@hasna/banking` currently owns no persistent user-level state. Installing the
package does not create or modify a home directory. The CLI, MCP entrypoint, and
SDK do not initialize a global store.

If package-global state is added later, its only canonical root is:

```text
~/.hasna/banking
```

The legacy roots `~/.banking` and `~/.open-banking` are not operational read
paths. The package never copies, moves, rewrites, or deletes them. There is no
automatic migration because the current package has no global store and no
known package-owned data at those locations. Files found there must be audited
before manual removal rather than assumed to belong to `@hasna/banking`.

## Project-local paths

No package-owned project-local dotdir is supported. In particular, `.banking`
and `.open-banking` are not runtime paths and are not ignored by this
repository.

The exported SQLite development store is in-memory by default. Callers may pass
an explicit `path` to `createSqliteDevStore`; that path and its lifecycle remain
owned by the caller and are never derived from the current working directory or
a hidden package directory.

The repository-level `.secrets/` and `.connect/` ignore entries are generic
credential and connector hygiene. Banking does not treat either directory as
package state. Live provider credentials come from environment variables or
secret references resolved through the compatible `secrets` CLI.
