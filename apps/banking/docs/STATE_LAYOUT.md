# State layout

`@hasna/banking` owns exactly one persistent user-level artifact: the SQLite
development store, which defaults to a file at the canonical root below and is
created on first use. Installing the package does not modify a home directory.
The CLI, MCP entrypoint, and SDK do not initialize the store unless a command
or caller creates it (the CLI and MCP entrypoint do not open it today).

The package's only canonical data root is:

```text
~/.hasna/banking
```

The legacy roots `~/.banking` and `~/.open-banking` (the retired `open-`-prefixed name) are not operational read
paths. The package never copies, moves, rewrites, or deletes them. There is no
automatic migration because the current package has no global store and no
known package-owned data at those locations. Files found there must be audited
before manual removal rather than assumed to belong to `@hasna/banking`.

## Project-local paths

No package-owned project-local dotdir is supported. In particular, `.banking`
and `.open-banking` are not runtime paths and are not ignored by this
repository.

The exported SQLite development store defaults to a file-backed database at
`~/.hasna/banking/banking.db` beneath the canonical root above, created on
first use with mode `0700`. `HASNA_BANKING_HOME` overrides the root, and an
explicit `path` passed to `createSqliteDevStore` wins over both; pass
`":memory:"` for an in-memory store. A caller-supplied path and its lifecycle
remain owned by the caller and are never derived from the current working
directory or a hidden package directory.

The repository-level `.secrets/` and `.connect/` ignore entries are generic
credential and connector hygiene. Banking does not treat either directory as
package state. Live provider credentials come from environment variables or
secret references resolved through the compatible `secrets` CLI.
