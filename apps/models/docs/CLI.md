# CLI reference

`models` discovers and indexes Hugging Face repositories, plans and downloads
selected files, tracks local installs, and stores model capability metadata.

```text
models [options] [command]
```

Global options:

| Option | Description |
| --- | --- |
| `-V, --version` | Print the package version. |
| `-j, --json` | Emit JSON. Every leaf command also accepts this option. |
| `-h, --help` | Print help. |

Use `models <command> --help` for executable help. Commands that perform an
asynchronous action return exit status `1` on failure. With `--json`, those
failures are printed as `{ "ok": false, "error": "..." }`.

## References and values

Provider refs have the following forms:

```text
hf:owner/repo
hf:owner/repo@revision
hf:dataset:owner/repo@revision
hf:space:owner/repo@revision
```

`huggingface:` is also accepted in place of `hf:`. The provider defaults to
Hugging Face, the entity kind defaults to `model`, and the revision defaults to
`main`. Repository IDs must contain a namespace and name.

Byte values accept an integer or decimal followed by optional `b`, `kb`, `mb`,
`gb`, or `tb` units. Units use powers of 1024. A value without a unit is bytes.
Positive integer options reject zero, decimals, signs, and trailing characters.

File patterns used by `--include` and `--exclude` are repeatable. A pattern can
be an exact path, a basename, a directory prefix ending in `/`, or a `*` glob.
When no include pattern is given, all remote files are selected before excludes
are applied.

## Provider commands

### `models providers list`

Lists supported providers, entity kinds, and provider capabilities. The current
provider is `huggingface`, with model, dataset, and Space support.

Options: `-j, --json`.

### `models providers status`

Reports whether Hugging Face credentials resolve and identifies the source as
`env`, `config`, `secrets`, or `none`. Token values and secret-key names are not
printed.

Options: `-j, --json`.

### `models providers auth [provider]`

Configures a local Hugging Face secret reference. `provider` defaults to
`huggingface`; `hf` is also accepted. Without `--secret-key`, the command only
reports current status.

| Option | Description |
| --- | --- |
| `--secret-key <key>` | Save the key name read through the local `secrets` CLI. |
| `-j, --json` | Emit JSON. |

## Catalog commands

### `models search [query]`

Searches the Hugging Face catalog. Results are not persisted unless `--index`
is set.

| Option | Default | Description |
| --- | --- | --- |
| `--kind <kind>` | `model` | `model`, `dataset`, or `space`. |
| `--task <task>` | | Pipeline/task filter. |
| `--license <license>` | | License tag filter. |
| `--tag <tag>` | | Additional repeatable Hub tag filter. |
| `--limit <n>` | `20` | Positive result limit. |
| `--sort <field>` | `downloads` | `downloads`, `likes`, `lastModified`, `createdAt`, or `trendingScore`. |
| `--direction <direction>` | `desc` | `asc` or `desc`. |
| `--index` | off | Store returned catalog entries in SQLite. |
| `-j, --json` | off | Emit JSON. |

### `models info <ref>`

Fetches revision-scoped metadata for a model, dataset, or Space.

| Option | Default | Description |
| --- | --- | --- |
| `--kind <kind>` | `model` | Default kind when the ref has no kind prefix. |
| `--index` | off | Store the entry in SQLite. |
| `-j, --json` | off | Emit JSON. |

### `models files <ref>`

Requests the recursive remote file tree. If the tree endpoint returns `404`, the
command retries through revision-scoped repository siblings. Other HTTP failures
are returned directly.

| Option | Default | Description |
| --- | --- | --- |
| `--kind <kind>` | `model` | Default kind when the ref has no kind prefix. |
| `--index` | off | Store returned remote file metadata in SQLite. |
| `-j, --json` | off | Emit JSON. |

## Download commands

### `models plan <ref>`

Builds a selected-file download plan without downloading. JSON output contains
`ok`, `status`, `blockedReason`, and `plan`. A plan is blocked when it selects no
files, exceeds the known-byte cap, or contains unknown-size files while a cap is
active.

| Option | Default | Description |
| --- | --- | --- |
| `--kind <kind>` | `model` | Default kind when the ref has no kind prefix. |
| `--include <pattern>` | all files | Include pattern; repeatable. |
| `--exclude <pattern>` | none | Exclude pattern; repeatable. |
| `--max-bytes <bytes>` | `2gb` | Maximum total known bytes. |
| `-j, --json` | off | Emit JSON. |

### `models install <ref>`

Creates the same plan as `models plan`, downloads each selected file, verifies
known file sizes, and records a completed install in SQLite. Files are written
under the configured install root by provider, entity kind, sanitized repo ID,
and revision. Unsafe or symlink-traversing remote paths are rejected.

| Option | Default | Description |
| --- | --- | --- |
| `--kind <kind>` | `model` | Default kind when the ref has no kind prefix. |
| `--include <pattern>` | all files | Include pattern; repeatable. |
| `--exclude <pattern>` | none | Exclude pattern; repeatable. |
| `--max-bytes <bytes>` | `2gb` | Maximum total known bytes. |
| `--dry-run` | off | Return the plan without downloading or recording an install. |
| `-j, --json` | off | Emit JSON. |

Downloads are sequential and use temporary files followed by an atomic rename.
The current implementation does not resume partial downloads.

## Index commands

### `models index hf [query]`

Searches Hugging Face and persists all returned entries.

| Option | Default | Description |
| --- | --- | --- |
| `--kind <kind>` | `model` | `model`, `dataset`, or `space`. |
| `--task <task>` | | Pipeline/task filter. |
| `--license <license>` | | License tag filter. |
| `--tag <tag>` | | Additional repeatable Hub tag filter. |
| `--limit <n>` | `100` | Positive result limit. |
| `--sort <field>` | `downloads` | Same choices as `models search`. |
| `--direction <direction>` | `desc` | `asc` or `desc`. |
| `--with-files` | off | Also fetch and store each result's `main` revision file list. |
| `--include-results` | off | Include every indexed entry in JSON, not only the preview. |
| `-j, --json` | off | Emit JSON. |

JSON always includes counts, store statistics, and up to 20 preview entries.

### `models index best`

Indexes the most-downloaded Hugging Face models.

| Option | Default | Description |
| --- | --- | --- |
| `--limit <n>` | `250` | Positive result limit. |
| `--task <task>` | | Pipeline/task filter. |
| `--with-files` | off | Also fetch and store each result's `main` revision file list. |
| `-j, --json` | off | Emit JSON. |

## Local store commands

### `models list`

Lists recorded installs, newest first.

| Option | Default | Description |
| --- | --- | --- |
| `--catalog` | off | Show indexed catalog entries ranked by downloads and likes instead. |
| `--limit <n>` | `20` | Catalog result limit; ignored for install listings. |
| `-j, --json` | off | Emit JSON. |

### `models where <id-or-repo>`

Prints a recorded install path. Lookup accepts an install ID, bare repo ID, or
canonical provider ref. A ref with `@revision` matches that revision; a ref
without one returns the newest matching install.

Options: `-j, --json`.

### `models remove <id-or-repo>`

Previews removal by default. `--apply` deletes install metadata. Local files are
deleted only when both `--apply` and `--files` are supplied.

| Option | Description |
| --- | --- |
| `--apply` | Apply the metadata removal. |
| `--files` | Also remove the install directory when applying. |
| `-j, --json` | Emit JSON. |

## Capability commands

### `models capabilities seed-fixtures`

Validates and stores the five checked-in golden model capability fixtures.

Options: `-j, --json`.

### `models capabilities list`

Lists stored capability records, newest first.

| Option | Default | Description |
| --- | --- | --- |
| `--provider <provider>` | | Exact provider filter. |
| `--health <status>` | | Exact provider-health filter. |
| `--limit <n>` | `50` | Result limit, clamped internally to `1..500`. |
| `-j, --json` | off | Emit JSON. |

### `models capabilities get <model-or-alias>`

Resolves the latest matching record by model ID, `provider:model`,
`provider/model`, or a stored alias.

Options: `-j, --json`.

## Dataset commands

Dataset commands force the Hugging Face `dataset` entity kind. Dataset refs may
use `hf:dataset:owner/repo`, but an unprefixed `owner/repo` is also treated as a
dataset in this command group.

### `models datasets search [query]`

Uses the same task, license, tag, limit, sort, direction, index, and JSON options
as `models search`, except there is no `--kind` option and results are always
datasets. The default limit is `20`.

### `models datasets info <ref>`

Fetches revision-scoped dataset metadata. Options: `--index` and `-j, --json`.

### `models datasets files <ref>`

Lists dataset files. Options: `--index` and `-j, --json`.

### `models datasets install <ref>`

Plans or installs selected dataset files. Options are repeatable
`--include <pattern>`, repeatable `--exclude <pattern>`, `--max-bytes <bytes>`
with a `2gb` default, `--dry-run`, and `-j, --json`.

## Utility commands

### `models doctor`

Initializes/opens the local store and reports the data directory, SQLite path,
Hugging Face auth availability, and catalog/install/capability counts. Missing
auth is a warning and does not make the report fail.

Options: `-j, --json`.

### `models manual`

Prints one or more examples for every current leaf command. JSON output includes
the package name, version, and command array.

Options: `-j, --json`.

### `models goals`

Prints the packaged `docs/GOALS.md` implementation goal chain. JSON output also
includes the resolved path and byte count.

Options: `-j, --json`.
