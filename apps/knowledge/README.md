# knowledge

> Agent-friendly local knowledge CLI/MCP with JSON output, project workspaces, durable artifacts, and safe destructive actions.

[![npm version](https://img.shields.io/npm/v/@hasna/knowledge)](https://npm.im/@hasna/knowledge)
[![license](https://img.shields.io/npm/l/@hasna/knowledge)](LICENSE)
[![build](https://img.shields.io/github/actions/workflow/status/hasna/knowledge/ci.yml)](.github/workflows/ci.yml)

`knowledge` is evolving from a flat note store into a local-first knowledge
engine for AI agents. It stores simple knowledge items today, creates a Hasna
project workspace under `.hasna/knowledge`, initializes a versioned
`knowledge.db`, writes generated wiki artifacts, and exposes a stdio MCP server.

CLI and MCP workspace operations share a `KnowledgeService` facade for config,
safety policy, artifact storage, DB/wiki setup, source ingestion, source
resolution, and outbox consumption. That keeps local project mode and future
remote/S3-backed wrappers on the same service contracts.

## Install

```bash
# Bun
bun add -g @hasna/knowledge

# npm
npm install -g @hasna/knowledge
```

Or run directly:

```bash
bun x @hasna/knowledge add "My Note" "Some content"
```

## Shared Event Webhooks

`knowledge` exposes the shared `@hasna/events` commands so knowledge events can
trigger deterministic or agentic automation without custom glue scripts. To
route knowledge events into an OpenLoops worker/verifier template, register a
command webhook:

```bash
knowledge webhooks add loops \
  --id openloops-knowledge-events \
  --transport command \
  --source knowledge \
  --type "*" \
  --arg=events \
  --arg=handle \
  --arg=generic \
  --arg=--provider \
  --arg=codewith \
  --arg=--auth-profile \
  --arg=account005 \
  --arg=--permission-mode \
  --arg=bypass \
  --arg=--sandbox \
  --arg=danger-full-access \
  --timeout-ms 900000 \
  --json
```

`@hasna/events` sends the event envelope on stdin and in `HASNA_EVENT_JSON`.
OpenLoops can then create a deduped one-shot workflow for the event. Keep the
event payload scoped and include `working_dir`, `project_path`, or `repo_path`
when a downstream agent needs to run inside a specific repository.

## SDK

Apps can install the package and use the public SDK without shelling out to the
CLI or importing internal source files:

```ts
import { createKnowledgeClient } from '@hasna/knowledge';

const knowledge = createKnowledgeClient({
  scope: 'project',
  cwd: process.cwd(),
});

await knowledge.setup({ mode: 'hosted', canonicalExample: true });
await knowledge.ingest.source('file:///absolute/path/to/handbook.md', 'knowledge_index');

const results = await knowledge.search({
  query: 'company wiki policy',
  semantic: true,
  limit: 5,
});

const answer = await knowledge.ask('How do we cite handbook policy?', {
  semantic: true,
  limit: 5,
});

const sync = knowledge.sync.status();
```

The stable package surface is the top-level `@hasna/knowledge` export:
`createKnowledgeClient`, `createKnowledgeSdk`, service/result types, workspace
helpers, source-ref helpers, storage contracts, search/retrieval types,
provider helpers, and remote contract types. CLI and MCP entrypoints remain
available as package bins.

Database storage sync helpers are also available from
`@hasna/knowledge/storage` for SaaS wrappers and deployment tooling.
The top-level SDK also exposes `knowledge.sync.status()`,
`knowledge.sync.snapshot()`, `knowledge.sync.conflicts()`, and
`knowledge.sync.machines()` for app-native sync inspection.

The SDK uses the same `.hasna/knowledge` project workspace as the CLI. In
local mode it writes the SQLite catalog and generated artifacts under that path.
In hosted/canonical mode it can point generated artifacts at S3 while keeping
raw source ownership outside knowledge. Source files remain referenced via
`open-files://`, `file://`, `s3://`, or web refs; knowledge stores derived
chunks, citations, indexes, run logs, and generated wiki artifacts.

## Quick Start

```bash
# Add a note
knowledge add "Rust ownership" "Every value has exactly one owner"

# List all notes
knowledge list

# List with search
knowledge list --search ownership

# List notes tagged "rust"
knowledge list --tag rust

# Compact status/search output is the default; use --verbose or --json for details
knowledge sync status --scope project
knowledge search "company wiki policy" --scope project

# Inspect every local knowledge layer with full machine-readable output
knowledge inventory --scope project --json

# Get a note
knowledge get --id <id>

# Update a note
knowledge update --id <id> --title "Rust ownership model"

# Delete a note (requires --yes)
knowledge delete --id <id> --yes

# Export all notes as JSONL
knowledge export --format jsonl

# Show resolved workspace paths compactly, or use --json for all paths/config
knowledge paths --scope project
knowledge paths --scope project --json

# Inspect local/S3 artifact storage and source ownership
knowledge storage status --scope project --json

# Inspect optional machine topology for future sync
knowledge machines topology --scope project --json
knowledge machines preflight linux-node-a --workspace /workspace/open-knowledge --scope project --json

# Inspect and record knowledge-aware sync ledger state
knowledge sync status --scope project
knowledge sync doctor --machine linux-node-a --scope project --json
knowledge sync snapshot --scope project --no-tailscale --json
knowledge sync conflicts --scope project --json
knowledge sync dry-run --peer-workspace /path/to/peer/repo --scope project --json
knowledge sync push --peer-workspace /path/to/peer/repo --scope project --json
knowledge sync dry-run --machine linux-node-a --peer-workspace /workspace/open-knowledge --scope project --json

# Configure optional hosted mode and inspect remote contracts
knowledge setup --mode hosted --api-url https://knowledge.md --scope project --json
knowledge auth whoami --scope project --json
knowledge remote contracts --scope project --json

# Initialize the project SQLite catalog
knowledge db init --scope project

# Inspect the local knowledge.db catalog status (mode + sync history)
knowledge db storage status --scope project --json

# Initialize scalable wiki/schema/index/log artifacts
knowledge wiki init --scope project

# Compile cited wiki pages, file approved answers, and lint wiki health
knowledge wiki compile "handbook policy" --title "Handbook Policy" --scope project --json
knowledge wiki file-answer "How do we cite policy?" --content "Use cited source context." --approve-write --scope project --json
knowledge wiki lint --scope project --json

# Ingest an open-files source manifest into the project SQLite catalog
knowledge ingest manifest ./open-files-manifest.jsonl --scope project --json

# Ingest one read-only source ref directly
knowledge ingest source file:///absolute/path/to/handbook.md --purpose knowledge_index --scope project --json

# Consume open-files change events and invalidate stale source chunks
knowledge reindex outbox ./open-files-outbox.jsonl --scope project --json

# Inspect and refresh the embedding queue after source changes
knowledge reindex status --scope project --json
knowledge reindex enqueue --scope project --json
knowledge reindex embeddings --scope project --fake --json

# Resolve indexed source text and citation evidence through the read-only source boundary
knowledge source resolve open-files://file/f_123/revision/rev_456 --scope project --json

# Inspect local safety policy and approvals
knowledge safety status --scope project --json

# Inspect AI SDK provider credentials and model aliases
knowledge providers status --scope project --json
knowledge providers models --scope project --json

# Embed indexed chunks and run semantic search
knowledge embeddings index --scope project --model openai:text-embedding-3-small --json
knowledge embeddings search "company wiki policy" --scope project --json

# Hybrid search over source chunks, generated wiki pages, indexes, and optional vectors
knowledge search "company wiki policy" --scope project
knowledge search "company wiki policy" --scope project --semantic --json
knowledge search "company wiki policy" --scope project --context --json

# Agent/loop-safe bounded context packs
knowledge context pack "company wiki policy" --max-tokens 1200 --max-items 6 --scope project --json
knowledge proposals context --from loops --topic "release proposal" --since 7d --dedupe --max-tokens 1200 --scope project --json

# Build a citation answer/context draft for a prompt
knowledge ask "How do we cite handbook policy?" --scope project --json
knowledge "How do we cite handbook policy?" --scope project --json

# Provider-native web search, safety-gated for real network access
HASNA_KNOWLEDGE_WEB_SEARCH=1 knowledge web search "latest AI SDK web search" --provider openai --json
```

## Output Disclosure

Human terminal output is compact by default so CLIs stay usable in agent
contexts. List, status, search, sync, machine, and export commands show capped
rows, truncated text, totals, and the next detail command instead of dumping
full objects. Use `--verbose` for full pretty-printed terminal details, or
`--json` for stable machine-readable contracts. Commands that intentionally
export records require an explicit machine-readable mode such as
`knowledge export --json` or `knowledge export --format jsonl`.

## Guides

- [Company wiki workflow](docs/examples/company-wiki-workflow.md): an end-to-end
  local workflow for open-files manifests, search, prompt runs, cited wiki
  pages, linting, reindexing, MCP, and optional hosted/S3 mode.
- [App project wiki standard](docs/examples/app-project-wiki-standard.md):
  SDK/CLI workflow for scoped app notes, source refs, and guarded global writes.
- [JSON to SQLite migration](docs/migration/json-to-sqlite.md): how legacy
  JSON notes coexist with the `.hasna/knowledge` workspace and the
  versioned SQLite catalog.
- [AI-native architecture](docs/architecture/ai-native-knowledge-base.md):
  source boundaries, wiki model, search model, provider registry, and non-goals.
- [Hybrid semantic search](docs/architecture/hybrid-semantic-search.md):
  keyword/vector/search-context contracts and hosted index options.
- [Machine sync schema](docs/architecture/machine-sync-schema.md):
  optional open-machines topology, sync ledgers, conflict records, and
  local/S3/hosted sync boundaries.
- [Hosted wrapper responsibilities](docs/architecture/hosted-wrapper-responsibilities.md):
  what a future SaaS layer owns outside the OSS package.

Only the public guides linked above are included in the npm package. Internal
evidence, topology notes, and secret-bootstrap runbooks must stay out of the
package docs allowlist; run `npm run release:pack:check` before publishing to
validate the packed contents.

## Commands

### add
```bash
knowledge add <title> <content> [--url <url>] [-t <tag>]...
```
Add a new knowledge item.

`-t/--tag` is repeatable and also accepts a comma-separated list, so these are
equivalent and both store three tags:

```bash
knowledge add "Title" "Body" -t convention -t naming -t channels
knowledge add "Title" "Body" -t "convention,naming,channels"
```

Tags are deduped case-insensitively, and the `[INFO] Item added` line reports the
stored tag count so a partial write cannot pass unnoticed.

A `-t` whose value is missing, empty, or only separators (`-t`, `-t ""`, `-t " , "`)
**exits 1**. It previously exited 0 and silently stored nothing, so this is a
deliberate exit-code change: dropping a tag the caller asked for is the defect, and
an empty `-t "$VAR"` expansion should fail where the caller can see it. Commas are
handled the opposite way — they split rather than error — because a comma-joined
value is unambiguous and recoverable, whereas an empty value carries no intent.

### list
```bash
knowledge list|ls [options]
```
List compatibility JSON-store items with pagination, search, and tag filtering.
Use `knowledge inventory` or `knowledge search` when an agent needs the
SQLite catalog, source chunks, generated wiki pages, artifacts, runs, sync
state, or keyword retrieval across active compatibility notes too.

| Flag | Description |
|------|-------------|
| `-p, --page <n>` | Page number (default: 1) |
| `-l, --limit <n>` | Items per page (default: 20) |
| `-s, --search <text>` | Filter by title or content |
| `-t, --tag <tag>` | Filter by tag; repeatable/comma-separated, an item must match **all** of them |
| `--sort created\|title` | Sort field (default: created) |
| `--desc` | Sort descending |
| `--archived` | Return archived items *only*; **wins** over `--include-archived` if both are passed |
| `--include-archived` | Return live **and** archived items (default: live only) |
| `--verbose` | Print the full paginated item objects |
| `--json` | Print the stable machine-readable list response |

Each `-t` value matches an item when the item's stored tags contain the **whole value**
*or* all of its **comma-split names** — a union. This is deliberately **not** the rule
[`untag`](#untag) uses: `untag` is **exclusive**, matching the whole value first and
falling back to the split names *only* when no stored tag equals the whole value.

Both rules are right for their own command. `untag` writes, so it must take one shape per
`-t` **value** — that is exactly what makes its documented "re-run to clear the split
names" behaviour true. The exclusivity is per raw `-t` value, **not** per run: repeating `-t`
on `untag` still accumulates, so `untag -t "a,b,c" -t a -t b -t c` removes four tags from an
item carrying both shapes in a single run. (Repeating `-t` on `list` narrows instead — see
the `-t` row above.) `list` only reads, so matching both shapes destroys
nothing, while matching only one would hide items from the very query used to find them.
Items written before the multi-tag parse fix can carry a single literal `"a,b,c"` tag, which
none of the split names equals, so a split-only filter never matches the damaged item — and
what it returns *instead* depends on the rest of the corpus, silently either way. With
nothing else matching it answers `total: 0` at exit 0, an empty result for an item that is
demonstrably there. If some **other** item carries the three names separately, it answers
with *that* item at `total: 1` and exit 0 — a different item from the one asked for, and
nothing in the output says the answer changed. Which of the two you get is a property of the
corpus, not of the query, so neither can be relied on as a signal. The union therefore finds
both shapes in one query:

```bash
# returns items tagged with the literal "a,b,c" AND items tagged a + b + c separately
knowledge list -t "a,b,c" --json
```

Prefer `--json` when you are looking for glued tags: the table renders `["a,b,c"]` and
`["a","b","c"]` as `[a,b,c]` and `[a, b, c]`, which differ only by two spaces.

`list` excludes **archived** items by default, so the query above will not surface a glued
tag that sits on an archived item. Add `--include-archived` to sweep live and archived
items together, or `--archived` for archived items only — use the former when auditing the
corpus for tag damage rather than reading live knowledge.

If **both** are passed, `--archived` wins and the result is archived items *only* — the
narrower flag, not the wider one, regardless of the order they appear in. So
`--archived --include-archived` is not a way to widen the sweep; drop `--archived` for that.

### inventory
```bash
knowledge inventory [--scope local|global|project] [--limit <n>] [--include-archived] [--verbose] [--json]
```
Show a capped, unified local inventory across the compatibility JSON item
store, the SQLite catalog, indexed source refs, source/wiki chunks, generated
wiki pages, knowledge indexes, artifact manifest rows, prompt runs, vector
index status, reindex queue, machine sync rows, conflicts, and safety/audit
decisions. This is the command to answer "what knowledge exists here?" without
dumping every raw chunk body.

### get
```bash
knowledge get --id <id>
```
Retrieve a single item by ID.

### update
```bash
knowledge update|edit --id <id> [options]
```
Update an existing item.

| Flag | Description |
|------|-------------|
| `--title <title>` | New title |
| `--content <content>` | New content |
| `--url <url>` | New source URL |
| `-t, --tag <tag>` | Add tag(s); repeatable/comma-separated. Tags are appended, never replaced |

When `-t` is passed, the result reports how many tags were actually added — `added` in
JSON and `Updated <id> (added 2 tags)` in `message`. Appending a tag that is already
present is idempotent, so this stays exit 0 (unlike `untag`, where removing nothing is an
error), but a bare `Updated <id>` could not distinguish 2 added from 0 and reported the
count nowhere at all.

### archive / restore
```bash
knowledge archive --id <id>
knowledge restore --id <id>
```
Archive hides an item from default `list` output without deleting it.

### upsert
```bash
knowledge upsert [title] [content] [--id <id>] [--title <title>] [--content <content>] [-t <tag>]...
```
Create or update an item by ID. `-t` appends tags and reports an `added` count the same
way [`update`](#update) does, on the create path as well as the update path — so a caller
never has to branch on `created` to know whether `added` is meaningful.

### untag
```bash
knowledge untag --id <id> -t <tag>...
```
Remove tag(s) from an item. `-t/--tag` is repeatable and accepts a
comma-separated list, so several tags can be removed in one call.

Each `-t` value is matched **whole first, and only split on commas if no stored tag
equals it**. Items written before the multi-tag parse fix was landed can carry a
single literal `"a,b,c"` tag, which none of the split names would match — so a
split-only `untag` would remove nothing while still exiting 0. One command therefore
covers both shapes:

```bash
# stored tags ["a,b,c"]     -> removes the one literal tag  (whole-value match)
# stored tags ["a","b","c"] -> removes all three            (falls back to splitting)
knowledge untag --id <id> -t "a,b,c"
```

When an item somehow carries both shapes, the whole-value match wins and the literal
tag is removed first; re-run to clear the split names. That exclusivity is the point: one
shape per `-t` **value** is what makes re-running meaningful, so a *single* `-t` deliberately
does **not** match both shapes at once. [`list -t`](#list) does — a union — because a filter
has nothing to remove and suppressing a shape would hide items. Do not "unify" the two rules.

The exclusivity is scoped to one `-t` value, **not** to the whole run. Repeated `-t` still
accumulates, so on an item carrying both shapes:

```bash
# each line run against this same starting state, not as a sequence:
#   stored tags ["a,b,c","a","b","c"]
knowledge untag --id <id> -t "a,b,c"                 # removed: 1  (whole value only)
knowledge untag --id <id> -t "a,b,c" -t a            # removed: 2
knowledge untag --id <id> -t "a,b,c" -t a -t b -t c  # removed: 4  (both shapes, one run)
```

Naming the split names explicitly is a caller's way of asking for both shapes at once. What
the `-t`-level exclusivity guarantees is narrower and is the part the re-run contract rests
on: one `-t "a,b,c"` clears the glued tag and leaves the split names, so re-running the same
command is meaningful (`removed: 1`, then `removed: 3`, then exit 1).

Removing nothing **exits 1**. `removed: 0` at exit 0 with a `Removed tag from <id>`
message is the same class of defect as the original bug — a success signal that
cannot distinguish 1 removed from 0 — so an absent tag is an error, as a missing
`--id` already is. When some requested tags matched and others did not, the call
succeeds and the unmatched names are reported both in `message` (`Removed 1 tag from
<id> (not found: "nope")`) and in `not_found`. `message` carries them because without
`--json` or `--verbose` that is the only line printed, so a `not_found`-only report is
invisible to exactly the callers most likely to be reading it.

Tag names are quoted on **both** paths — the stored tags in the failure message, and the
unmatched names in the partial-miss success line:

```
Error: No matching tag on k_x: "iapp" not in ["iapp,integrations,architecture"]
Removed 1 tag from k_y (not found: "p", "q")
```

On the **failure** path the quoting resolves a real collision: stored tags can contain
commas, so unquoted, a single glued `"a,b,c"` tag renders identically to three separate
ones and the message appears to deny a tag that is plainly listed.

On the **partial-miss** path the justification is different, and it is *not* the comma
case. A `not_found` entry can never contain a comma: a comma-bearing value only enters the
removal set through the whole-value branch, which requires the stored tags to already
contain it — so it is found by definition — and every other entry comes from splitting on
commas. One missing tag literally named `p, q` is therefore **unreachable**, and because
every entry is comma-free the raw `", "` join is *injective*: `["p","q"]` prints `p, q` and
`["p q"]` prints `p q`, which are different strings. A plain space is a **legibility**
problem, not an ambiguity.

The reachable case that does make quoting load-bearing is **whitespace the parser does not
strip**. `trim()` only removes the ends, so a tab or newline inside a name survives:

```
-t $'p\nq'  ->  not_found: ["p\nq"]
  quoted:    Removed 1 tag from k_x (not found: "p\nq")     <- one line
  unquoted:  Removed 1 tag from k_x (not found: p
             q)                                             <- message split in two
```

Joined raw, that name breaks the single-line message and the tail reads as separate output.
`JSON.stringify` escapes it. Quoting also keeps the two messages symmetric, so a reader does
not have to work out which of the two lines happens to be collision-proof.

### delete
```bash
knowledge delete|rm --id <id> --yes
```
Delete an item. Requires `--yes` to confirm.

### export
```bash
knowledge export [--json|--format json|--format jsonl]
```
Default terminal output is a compact export preview. Use `--json` or
`--format json` for a JSON object, or `--format jsonl` for newline-delimited
records.

### paths
```bash
knowledge paths [--scope global|project|local] [--verbose] [--json]
```
Show compact resolved app paths by default. Use `--verbose` or `--json` for
every path and the loaded config.

### storage
```bash
knowledge storage status [--scope project] [--json]
knowledge storage validate [--scope project] [--json]
knowledge storage repair-artifact-keys [--approve-write --approved-by <name>] [--scope project] [--json]
knowledge storage migrate-legacy-path [--approve-write --approved-by <name>] [--scope project] [--json]
knowledge storage merge-legacy-path [--approve-write --approved-by <name>] [--scope project] [--json]
```
Show the storage contract for local or S3-backed generated artifacts. Local mode
uses `.hasna/knowledge` for config, SQLite, indexes, wiki artifacts, logs,
runs, and exports. S3 mode stores generated artifacts under the configured
knowledge bucket/prefix while `open-files` remains the source of truth for raw
source bytes. The command also reports artifact classes, allowed source ref
schemes, and warnings for non-scalable or unsafe config.

Fleet setup evidence follows the same boundary. `storage status --json`
includes `private_fleet_boundary`, which names `open-machines` as the manifest
authority, `open-files` as the source-ref authority, and `open-secrets` as the
secret-ref authority. `knowledge` may store source refs, redacted setup
decisions, runbook summaries, citations, and evidence hashes; it must not store
private manifests, hostnames, serial numbers, sudo passwords, VNC passwords,
SSH private keys, GitHub App private keys, or secret values.

`storage repair-artifact-keys` previews legacy `storage_objects` rows where the
portable artifact key accidentally includes the configured S3 prefix. It only
updates metadata after `--approve-write --approved-by <name>` and records an
audit event; it does not move S3 objects or copy raw source bytes.

`storage migrate-legacy-path` is the explicit path migration for older
app-folder workspaces. It dry-runs by default, reports JSON item counts, SQLite
integrity, artifact counts and hashes, and only moves data after
`--approve-write --approved-by <name>`. The write path creates a backup,
renames the workspace into `.hasna/knowledge`, verifies the backup and moved
tree match, and leaves only a diagnostic tombstone at the old location.

`storage merge-legacy-path` is the explicit recovery path when the canonical
`.hasna/knowledge` workspace already contains data. It dry-runs by default,
reports current, legacy, duplicate, stranded, conflict, expected, and final item
counts, refuses conflicting duplicate IDs or `short_id` collisions, snapshots
the legacy workspace first, and then appends non-conflicting legacy JSON items
to the canonical JSON store after `--approve-write --approved-by <name>`. The
merge command locks both JSON stores; stop other knowledge writers first when
you need the whole legacy workspace snapshot to be coherent across SQLite,
artifact, run, and wiki files too.

For example production, the canonical generated-artifact bucket is
`example-knowledge-prod` in `us-east-1` with prefix
`.hasna/knowledge/`. `storage status --json` exposes this under
`canonical_example` even when local storage is active. The canonical
metadata-only secret paths are:

```text
example/knowledge/prod/env
example/knowledge/prod/aws
example/knowledge/prod/s3
```

`knowledge` does not load `cloud.env` or any other env file from
`.hasna/knowledge`. Cloud runtime secrets must be resolved by the approved
secret authority or injected through runtime environment variables such as
`HASNA_KNOWLEDGE_DATABASE_URL`; `storage validate` fails if `cloud.env`,
pre-cloud DB/JSON backups, or `migration-exports/` are present in the Knowledge
workspace. DB URL rotation is intentionally a blocker for the package unless a
secret authority owner approves live mutation and separate evidence shows the
URL propagated to backups, exports, sync bundles, reports, or copied artifacts.

The future hosted database path, if provisioned, is
`example/knowledge/prod/rds`.

### machines
```bash
knowledge machines topology [--no-tailscale] [--scope project] [--json]
knowledge machines preflight [machine] [--workspace <repo>] [--scope project] [--json]
```
Inspect the read-only machine topology that future knowledge sync will use.
Machine integration goes through the optional `KnowledgeMachinesAdapter`
boundary. In default `auto` mode, `knowledge` tries the lightweight
`@hasna/machines/consumer` SDK, then the installed `machines --json` CLI, then
local machine identity and optional Tailscale status probing. The explicit
adapter modes are `sdk`, `cli`, and `disabled`; `@hasna/machines` is never a
hard runtime dependency. This command does not sync data; it only exposes
machine ids, hostnames, route hints, workspace context, and adapter status.
If the optional consumer SDK declares a newer contract than `knowledge`
understands, `knowledge` refuses the SDK result and reports
`unsupported_contract_version:<n>` while falling back to raw/local behavior.

`machines preflight` checks command availability, `@hasna/knowledge` CLI
version parity, optional `@hasna/machines` availability, and the target repo
workspace/package metadata before any machine sync is attempted. When
`@hasna/machines` is installed, `knowledge` delegates to its compatibility SDK
or CLI contract; otherwise it uses a local/SSH fallback. Remote sync JSON
includes adapter diagnostics for route and workspace resolution so CLI, SDK,
and MCP callers can see whether the result came from SDK, CLI, argument
override, registry fallback, or disabled fallback.

The installed adapter smoke harness verifies the same boundary outside unit
test fakes:

```bash
bun run smoke:machines-adapter -- --json
```

It builds isolated temp apps for project-local SDK resolution, global
`machines` CLI-only fallback, unsupported future SDK contracts, and
no-SDK/no-CLI fallback.

The machine release smoke turns the manual linux-node-b/linux-node-a sync runbook into a
repeatable evidence command:

```bash
bun run smoke:machine-sync-release -- --knowledge-version 0.2.63 --machines-version latest --json --keep-temp
```

It installs the requested package versions on linux-node-b and linux-node-a, runs the
adapter smoke and machines consumer conformance on both machines when
available, creates isolated project workspaces, runs `sync doctor`, dry-run,
push, generated artifact manifest checks, forced conflicts in both directions,
fake AI conflict proposals, approval-gated resolutions, and a final
bidirectional dry-run that must converge with zero conflicts. It also repeats
the sync/conflict path from an isolated installed-package runner where
`@hasna/machines` and the `machines` CLI are hidden locally, proving knowledge
can still operate through raw SSH plus `--peer-workspace`. A second hidden
runner scenario first learns a knowledge-owned registry fallback, then omits
`--peer-workspace` and requires `source=registry` for route and workspace
resolution. Use `--evidence-json <path>` or `--evidence-md <path>` to save a
compact release artifact for todos.

### sync
```bash
knowledge sync status [--scope project] [--json]
knowledge sync doctor|readiness [--machine <ssh-alias>] [--peer-workspace <repo-or-knowledge-home>] [--tables sources,chunks] [--scope project] [--json]
knowledge sync snapshot [--no-tailscale] [--machine <id>] [--scope project] [--json]
knowledge sync machines [--scope project] [--json]
knowledge sync conflicts [status] [--limit <n>] [--scope project] [--json]
knowledge sync conflicts propose <id> [--mode deterministic|ai] [--model <alias|provider:model>] [--fake] [--scope project] [--json]
knowledge sync dry-run --peer-workspace <repo-or-knowledge-home> [--tables sources,chunks] [--scope project] [--json]
knowledge sync pull --peer-workspace <repo-or-knowledge-home> [--tables sources,chunks] [--scope project] [--json]
knowledge sync push --peer-workspace <repo-or-knowledge-home> [--tables sources,chunks] [--scope project] [--json]
knowledge sync sync --peer-workspace <repo-or-knowledge-home> [--tables sources,chunks] [--scope project] [--json]
knowledge sync dry-run --machine <ssh-alias> --peer-workspace <remote-repo> [--scope project] [--json]
knowledge sync export [--tables sources,chunks] [--no-artifact-content] [--scope project] --json
knowledge sync import [--dry-run] [--scope project] [--json] < bundle.json
```
Inspect and record the knowledge-aware sync ledger in `knowledge.db`.
`sync status` is read-only and reports registered machines, latest snapshot,
change counts, conflict counts, and durable table counts. `sync snapshot`
refreshes the machine registry from optional topology discovery and records a
content hash over table counts and generated artifact hashes. Conflict rows are
inspectable before any future merge/approval flow writes durable changes.
Non-dry remote sync also persists route/workspace resolver evidence into
`knowledge_machines`; later remote sync can use that knowledge-owned registry
row when the optional open-machines SDK/CLI is unavailable. Read-only commands
such as `sync status`, `sync doctor`, and `sync dry-run` do not write registry
evidence.
When newer `@hasna/machines` consumers provide resolver cacheability metadata,
knowledge preserves `observed_at`, `expires_at`, cacheable/stale status,
source authority, and reasons in sync JSON and registry fallback evidence.

`sync doctor` is the read-only preflight for machine sync. It reports the
local SQLite schema and table counts, storage contract validation, table
generated artifact manifest readiness from `storage_objects`, table clocks,
open conflicts, `open-files://` source-ref boundary status, optional route
confidence, optional workspace path sources, and any open-machines workspace
diagnostics or repair hints. The artifact manifest check is read-only: it
validates hashes, sizes, portable artifact keys, S3/local URI prefix parity,
artifact modified-time metadata where available, provenance artifact-key
parity, and raw-payload sentinels without downloading artifacts or raw source
bytes.
When open-machines reports inferred or untrusted workspace metadata, the JSON
includes actionable `machines workspace repair ...` commands before sync is
attempted.

`sync conflicts propose <id>` is approval-gated. The default deterministic
mode builds a merge prompt from conflict metadata. `--mode ai` runs the same
read-only evidence gathering path through the AI SDK provider abstraction,
returning a structured proposed patch, citations, confidence, provider/model,
usage, and read-only tool trail. `--fake` produces deterministic local output
without provider credentials. Neither mode resolves or writes durable changes;
`sync conflicts resolve` still requires `--approve-write --approved-by <name>`.

`sync dry-run`, `pull`, `push`, and `sync` operate against another local repo
root or `.hasna/knowledge` path. They compare rows by table primary key,
copy generated artifacts recorded in `storage_objects`, normalize local
artifact URIs per machine, and record conflicts instead of overwriting
divergent rows. They move derived catalog rows and generated artifacts only;
raw `open-files` bytes are not copied into knowledge.

When `--machine <ssh-alias>` is supplied, peer sync uses `ssh` plus the
remote `knowledge sync export/import` commands. The remote machine must have a
compatible published `knowledge` CLI on PATH, and `--peer-workspace` should be
the remote repo root or remote `.hasna/knowledge` path.

`knowledge sync` owns knowledge semantics and conflict visibility for
peer/machine catalog transfer. It is distinct from `db storage status`, which is
a read-only local catalog inspector. (The legacy `db storage sync`/`push`/`pull`
Postgres-DSN commands were removed; cross-machine sharing uses the cloud API
flip — `HASNA_KNOWLEDGE_API_URL` + `HASNA_KNOWLEDGE_API_KEY` — instead.)

### setup / auth / remote
```bash
knowledge setup --mode local [--scope project] [--json]
knowledge setup --mode hosted [--api-url https://knowledge.md] [--scope project] [--json]
knowledge setup --mode hosted --canonical-example [--scope project] [--json]
knowledge auth login --api-key <key> [--email you@example.com] [--org <slug>] [--scope project] [--json]
knowledge auth whoami [--scope project] [--json]
knowledge auth logout [--scope project] [--json]
knowledge remote status [--scope project] [--json]
knowledge remote contracts [--scope project] [--json]
```
Hosted mode mirrors the `open-skills` open-core pattern: the OSS package stays
local-first, while `hosted.api_url`, `KNOWLEDGE_API_URL`, and
`KNOWLEDGE_API_KEY` define an optional remote client boundary. Credentials are
stored locally in `~/.hasna/knowledge/auth.json` or supplied by env vars.
`remote contracts` prints the typed registry/search/ask/build/sync/status/logs
and artifact API contract that a future SaaS wrapper can implement.

### db
```bash
knowledge db init [--scope project]
knowledge db stats [--scope project]
knowledge inventory [--scope project] [--json]
knowledge db storage status [--scope project] [--json]
```
Initialize or inspect the versioned SQLite catalog at
`.hasna/knowledge/knowledge.db`.

`db storage status` reports the local catalog: the resolved storage mode, the
durable table list, and local sync history. It is read-only. The legacy
`push`/`pull`/`sync` Postgres commands and the client `HASNA_KNOWLEDGE_DATABASE_URL`
DSN were removed — a raw database DSN is never distributed to clients. To share
knowledge across machines, use the cloud API flip instead: set
`HASNA_KNOWLEDGE_API_URL` + `HASNA_KNOWLEDGE_API_KEY` so every read/write routes
through the self-hosted HTTP API. The optional mode env vars are
`HASNA_KNOWLEDGE_STORAGE_MODE` / `KNOWLEDGE_STORAGE_MODE` (`local` or `cloud`).
The durable table list excludes local derived FTS indexes such as `chunks_fts`.

### wiki
```bash
knowledge wiki init [--scope project]
knowledge wiki compile [query|source-ref...] [--title <title>] [--limit <n>] [--scope project] [--json]
knowledge wiki file-answer <prompt> --content <answer> [--approve-write] [--scope project] [--json]
knowledge wiki lint [--scope project] [--json]
```
Create starter generated-knowledge artifacts through the artifact store:
`schemas/v1.md`, `indexes/root.md`, `wiki/README.md`, and a dated JSONL log
partition.

`wiki compile` turns existing source chunks into a cited Markdown page under
`wiki/generated/`, updates `knowledge_indexes`, records citations and a concept
backlink, and appends a JSONL log partition. `wiki file-answer` keeps answer
filing as a dry run unless `--approve-write` is supplied, then writes a cited
answer note under `wiki/answers/`. `wiki lint` checks generated pages for
missing citations, stale citations, duplicate titles, orphan pages, unresolved
source refs, contradiction markers, and new article candidates.

### app-wiki
```bash
knowledge app-wiki init [--scope project] [--json]
knowledge app-wiki source add <source-ref> [--purpose knowledge_index] [--scope project] [--json]
knowledge app-wiki note add --title <title> --content <text> [--source-ref <uri>] [--tag <tag>] [--scope project] [--json]
knowledge app-wiki search <query> [--scope project] [--json]
knowledge app-wiki query <query> [--scope project] [--json]
```
Use `app-wiki` for app/project wiki notes that must be created through the
Knowledge CLI/SDK/MCP path. Project scope writes only under
`.hasna/knowledge`; global app-wiki writes require `--scope global
--allow-global`. Do not create loose Markdown under home, `.hasna`, or
`.husna`.

### source
```bash
knowledge source resolve <source-ref> [--purpose knowledge_answer|knowledge_index] [--limit <n>] [--scope project] [--json]
```
Resolve an indexed source through the read-only open-files boundary. The result
returns source metadata, permissions, the selected revision, derived chunk text,
and citation evidence. It does not expose raw file bytes or storage credentials;
raw source retrieval remains owned by `open-files`.

### ingest
```bash
knowledge ingest manifest <file|s3://bucket/key> [--scope project] [--json]
knowledge ingest source <source-ref> [--purpose knowledge_index] [--scope project] [--json]
```
Import an open-files JSON or JSONL source manifest into `knowledge.db`. This
upserts sources and source revisions, stores hash/MIME/status/permission
metadata, and chunks embedded extracted text when the manifest includes it.

`ingest source` accepts `open-files://`, `file://`, `s3://`, and `https://`
refs. It reads source content through a read-only boundary, redacts known
secrets before storage, records hashes/revisions, and stores only derived chunks
and citation spans. Web and S3 reads remain opt-in through the safety policy.
For `open-files://` refs, the source must already be present in the local
knowledge catalog through a manifest or extracted-text ref until the open-files
resolver API lands.

### reindex
```bash
knowledge reindex status [--model openai:text-embedding-3-small] [--scope project] [--json]
knowledge reindex enqueue [--model openai:text-embedding-3-small] [--scope project] [--json]
knowledge reindex embeddings [--full] [--limit <n>] [--model openai:text-embedding-3-small] [--scope project] [--json]
knowledge reindex outbox <file|s3://bucket/key> [--scope project] [--json]
```
Inspect and operate index refresh work. `reindex status` reports missing
embedding rows, stale revisions, queued jobs, and vector counts. `reindex
enqueue` adds missing source chunks to `reindex_queue` idempotently. `reindex
embeddings` records an `embedding-refresh` run, indexes missing chunks, and
marks completed queue rows; `--full` first clears `chunk_embeddings` and
`vector_index_entries` so the current source catalog is rebuilt from scratch.

`reindex outbox` consumes open-files JSON or JSONL change events. This
invalidates matching source chunks and embeddings by source ref, revision, or
hash, updates permission/path/delete metadata, and records a local run ledger.
Outbox inputs can be local files or allowed S3 objects, but raw source files
remain owned by `open-files`.

Compatibility notes created by `knowledge add` live in the JSON item store.
They are returned by `knowledge search` and `knowledge search --context` through
keyword matching, but they are not chunked or embedded by `reindex`; reindexing
only refreshes SQLite source/wiki chunks and vector rows.

### search
```bash
knowledge search <query> [--scope project] [--limit <n>] [--verbose] [--json]
knowledge search <query> --semantic [--model openai:text-embedding-3-small] [--scope project] [--verbose] [--json]
knowledge search <query> --context [--semantic] [--scope project] [--verbose] [--json]
```
Run hybrid search over active JSON-store notes, `chunks_fts`, generated wiki
chunks, wiki/index catalog rows, and optional vector results. The default path
is local-only keyword and catalog search. `--semantic` embeds the query and
merges vector results from `vector_index_entries`, preserving source refs,
artifact URIs, citations, revision/hash metadata, and provenance in each
structured result. JSON notes are keyword-only results with `kind:
legacy_item` and `knowledge://item/<id>` source refs.

Default terminal search output shows compact result rows with source refs and
text previews. Use `--context` for an agent-ready citation pack, `--verbose` for
full human-readable result objects, or `--json` for stable structured output.

`--context` returns a reranked context pack for agents: selected excerpts,
assembled citations, freshness and permission notes, graph evidence from
`citations`/`wiki_backlinks`, and final rerank scores. This is the shape future
`knowledge <prompt>` flows should send to a model instead of raw search rows.

### context pack / proposals context
```bash
knowledge context pack <query> [--from search|runs|loops] [--max-tokens <n>] [--max-items <n>] [--scope project] [--json]
knowledge proposals context --from loops --topic <text> [--since <duration|ISO>] [--dedupe] [--max-tokens <n>] [--scope project] [--json]
```
Return compact deterministic JSON bundles for agents and loops. Packs are
read-only dry runs: they include bounded evidence previews, citation ids,
source/run/artifact refs, safety reminders, duplicate candidates when requested,
and a small write-ready outline. Raw artifact bodies are not embedded; callers
should inspect cited refs only when the bounded preview is insufficient.

`context pack` defaults to indexed search evidence. `--from runs|loops` builds
from the `runs`/`run_events` ledger, and `proposals context` defaults to loop
evidence for recurring proposal workflows.

### ask / build
```bash
knowledge ask <prompt> [--scope project] [--json]
knowledge build <prompt> [--generate] [--model default|provider:model] [--scope project] [--json]
knowledge <prompt> [--scope project] [--json]
```
Build an agent-native prompt run. The command first creates a read-only context
pack, returns a local citation draft by default, records a run ledger in
`runs`/`run_events`, and proposes durable wiki updates without writing them.
`--generate` explicitly calls AI SDK text generation; `--fake --generate` keeps
the flow deterministic for local tests. `--approve-write` records approval
intent, but durable wiki writes remain deferred to the wiki compile/write task.

### web
```bash
knowledge web search <query> [--provider openai|anthropic] [--model provider:model] [--domain <domain>] [--file-results] [--scope project] [--json]
```
Run provider-native hosted web search and return cited web sources. Real network
search is disabled unless `safety.network.web_search_enabled=true` or
`HASNA_KNOWLEDGE_WEB_SEARCH=1` is set. OpenAI uses the AI SDK OpenAI
`tools.webSearch` path; Anthropic uses its provider web-search tool when
available. `--file-results` stores returned snippets as read-only `web` source
refs in `knowledge.db` so later local search can cite them. `--fake` returns
deterministic offline sources for tests.

### safety
```bash
knowledge safety status [--scope project] [--json]
knowledge safety check generated_write [target] [--scope project] [--json]
knowledge safety approve generated_write [target] [--scope project] [--json]
knowledge safety audit [--scope project] [--json]
knowledge safety redact <text> [--scope project] [--json]
```
Inspect and operate the local safety model. Source reads are read-only by
default, web search and S3 reads are opt-in, generated writes require approval
by default, and known secret patterns are redacted before chunk storage.

### providers
```bash
knowledge providers status [--scope project] [--json]
knowledge providers models [--scope project] [--json]
knowledge providers check [provider|model-alias] [--scope project] [--json]
```
Inspect AI SDK v6 provider readiness for OpenAI, Anthropic, and DeepSeek. The
provider layer resolves BYOK credentials from `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, and `DEEPSEEK_API_KEY` by default, exposes model aliases
such as `default`, `fast`, `reasoning`, `sonnet`, and `deepseek`, and records
provider capability metadata for structured output, tool use, tool streaming,
reasoning, embeddings, and native web-search support.

### embeddings
```bash
knowledge embeddings status [--scope project] [--json]
knowledge embeddings index [--model openai:text-embedding-3-small] [--limit <n>] [--scope project] [--json]
knowledge embeddings search <query> [--model openai:text-embedding-3-small] [--limit <n>] [--scope project] [--json]
```
Build and query the local vector index over derived knowledge chunks. The first
implementation stores vectors in SQLite as JSON rows in `chunk_embeddings` and
`vector_index_entries`, with provider/model/dimensions, source revision/hash,
chunk offsets, token counts, invalidation status, and provenance metadata. Raw
source bytes remain owned by `open-files`; semantic results return cited chunks
with source refs and revision metadata.

OpenAI embeddings use AI SDK v6 and `OPENAI_API_KEY`. `--fake` provides
deterministic local vectors for tests and offline smoke checks.

### help
```bash
knowledge help [command]
```

## Global Options

| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON |
| `--store <path>` | Override store path |
| `--scope global\|project\|local` | Select global app workspace or project workspace |
| `--version, -v` | Show version |
| `--help, -h` | Show help |

## Store Location

Default global compatibility store: `~/.hasna/knowledge/db.json`

Project workspace: `.hasna/knowledge/`

The legacy `~/.open-knowledge/db.json` store is only read as a migration source.
On first global use, or explicitly with `knowledge storage import-legacy`, legacy
items are merged into `~/.hasna/apps/knowledge/db.json`; existing canonical items
win on `id` or `short_id` collisions. The legacy file is never moved, rewritten,
or deleted. When an existing canonical store changes, a pre-import backup is
written under `~/.hasna/apps/knowledge/exports/` and an import report under
`~/.hasna/apps/knowledge/runs/`.

Preview a legacy import without writing:

```bash
knowledge storage import-legacy --dry-run --json
```

Override item-store location with `--store <path>`.

Older app-folder workspaces are not read as an operational fallback. Use
`knowledge storage migrate-legacy-path --approve-write --approved-by <name>` to
move one into the canonical `.hasna/knowledge/` location with backup and
verification evidence when the canonical path is empty/default. If canonical
already contains data, use
`knowledge storage merge-legacy-path --approve-write --approved-by <name>` to
snapshot the legacy workspace and merge non-conflicting legacy items into the
canonical store.

## MCP Server

```bash
knowledge-mcp
```

The stable agent-facing MCP tools are:

- `knowledge_search`: return a reranked citation context pack.
- `knowledge_context_pack`: return compact cited JSON under token/item budgets.
- `knowledge_ask`: answer with read-only local knowledge and optional AI SDK
  generation.
- `knowledge_build`: run the prompt flow and optionally file a cited wiki answer
  when `approve_write=true`.
- `knowledge_get`: read an item, indexed source, wiki page, run, index, or
  decision by id.
- `knowledge_ingest`: ingest an open-files/S3/file/web source ref or open-files
  manifest into the derived catalog.
- `knowledge_web_search`: run safety-gated provider-native web search.
- `knowledge_lint`: lint generated wiki pages for citation/source issues.
- `knowledge_run_status`: list recent runs or inspect one run ledger.
- `knowledge_storage`: inspect the local/S3/hosted storage contract.
- `knowledge_resolve_source`: resolve indexed source chunks through the
  read-only source boundary.
- `knowledge_app_wiki_init`, `knowledge_app_wiki_note_add`,
  `knowledge_app_wiki_source_add`, `knowledge_app_wiki_search`,
  `knowledge_app_wiki_query`: manage and query scoped app/project wiki stores
  through the same service contract as CLI and SDK.
- `knowledge_machines_topology`: inspect optional machine topology and route
  hints for future knowledge sync planning.
- `knowledge_machines_preflight`: check command, package, workspace, and
  optional open-machines readiness before knowledge sync.
- `knowledge_sync_status`: inspect machine registry rows, latest snapshot,
  changes, conflicts, and table counts.
- `knowledge_sync_doctor`: read-only sync readiness report with storage,
  open-files boundary, route/workspace diagnostics, and next commands.
- `knowledge_sync_snapshot`: record a local sync snapshot and refresh machine
  registry rows from optional topology.
- `knowledge_sync_conflicts`: list sync conflicts awaiting review or already
  resolved.
- `knowledge_sync_conflict_propose`: build deterministic or AI SDK conflict
  proposals with citations and explicit approval gating.
- `knowledge_sync_peer`: dry-run, pull, push, or bidirectionally sync with a
  local peer workspace.
- `storage_status`, `storage_push`, `storage_pull`, `storage_sync`: inspect or
  sync the SQLite catalog with PostgreSQL using the standard open-core storage
  env contract.

Compatibility and lower-level tools remain available with the `ok_*` prefix:
item tools (`ok_add`, `ok_list`, `ok_get`, `ok_update`, `ok_delete`,
`ok_archive`, `ok_restore`, `ok_upsert`, `ok_untag`, `ok_bulk_delete`,
`ok_prune`, `ok_dedupe`, `ok_stats`, `ok_export`, `ok_import`, `ok_batch`),
workspace/storage inspection (`ok_paths`, `ok_storage_status`), providers,
embeddings, reindexing, hybrid search, source parsing/resolution, and
`ok_web_search`.

MCP list-style compatibility tools also use gradual disclosure. Compatibility
note: `ok_list` returns compact item summaries by default and omits full
`content`/`metadata` fields from each row; call `ok_get` for a single full item
or pass `include_content=true` / `include_metadata=true` when expanded list rows
are required.

MCP also publishes project-scope JSON resources for agent inspection:

- `knowledge://project/config`
- `knowledge://project/storage`
- `knowledge://project/machines`
- `knowledge://project/sync`
- `knowledge://project/schema`
- `knowledge://project/sources`
- `knowledge://project/open-files`
- `knowledge://project/wiki/pages`
- `knowledge://project/indexes`
- `knowledge://project/runs`
- `knowledge://project/decisions`
- Templated reads:
  `knowledge://project/items/{id}`,
  `knowledge://project/sources/{id}`,
  `knowledge://project/wiki/pages/{id}`,
  `knowledge://project/indexes/{id}`,
  `knowledge://project/runs/{id}`,
  `knowledge://project/decisions/{id}`

These resources expose compact metadata, derived chunks, generated wiki text,
run ledgers, and citation evidence. They do not expose raw source bytes from
`open-files`, local files, or S3.

## Source And Artifact Boundary

Raw files should be stored and resolved through `open-files`. `knowledge`
stores source references such as `open-files://file/<id>`,
`open-files://file/<id>/revision/<revision_id>`, `s3://...`, `file://...`,
and `https://...`, plus citations, chunks, generated wiki pages, indexes,
logs, runs, and search metadata.

`knowledge source resolve` and the MCP `ok_resolve_source` tool resolve
only the indexed, derived knowledge catalog. The resolver enforces read-only
purpose labels from source permissions, returns chunk citation evidence, writes
an audit event, and keeps bytes/storage credentials inside `open-files`.

`knowledge ingest source` can also build derived chunks from an allowed
source ref. It does not copy raw files into the knowledge workspace; local file,
S3, web, and open-files inputs are converted into redacted chunks with offsets,
hashes, revision metadata, and FTS rows.

Chunks, resolver results, generated wiki pages, and index records carry
provenance metadata: source owner, source ref/URI, revision/hash, chunk offsets,
read-only status, citation requirements, and stale-source status. This keeps
future semantic search and wiki compile flows tied back to `open-files` instead
of detached Markdown.

Semantic indexing stores generated vector rows and provenance only. It does not
store raw S3 or local-file bytes in the knowledge app, so a future hosted/S3
wrapper can move generated artifacts to object storage while source ownership
and immutable object identity stay in `open-files`.

AI provider configuration is local/BYOK by default. `knowledge` declares
AI SDK v6 provider support through `ai`, `@ai-sdk/openai`,
`@ai-sdk/anthropic`, and `@ai-sdk/deepseek`, but does not call providers until a
prompt, embedding, or agent command explicitly requests a model.

Generated knowledge artifacts can be stored locally under
`.hasna/knowledge/artifacts` or through the S3 artifact-store adapter.
For example production, `knowledge setup --mode hosted
--canonical-example --scope project --json` configures generated artifacts
under `s3://example-knowledge-prod/.hasna/knowledge/` and
keeps `open-files` as the raw-source owner.

The default safety policy allows writes only under the resolved
`.hasna/knowledge` workspace. S3 manifest/outbox reads require
`safety.network.s3_reads_enabled=true` and an allowed bucket in config, or the
equivalent `HASNA_KNOWLEDGE_ALLOW_S3_READS=1` and
`HASNA_KNOWLEDGE_ALLOWED_S3_BUCKETS=bucket-a,bucket-b` environment variables.

## JSON Output

Every command returns structured JSON when `--json` is passed:

```json
{
  "ok": true,
  "item": { "id": "...", "title": "...", "content": "...", "url": null, "tags": [], "created_at": "...", "updated_at": "..." }
}
```

## Agent-Friendly Design

- **JSON-only mode**: `--json` flag for easy parsing by LLMs
- **Idempotent IDs**: each item gets a stable unique ID
- **Safe deletes**: `--yes` flag required; no accidental deletions
- **Concurrent-safe**: file locking prevents corruption from parallel agents
- **Scriptable**: works in pipelines, CI, and any automation tool

## MCP Server

```bash
knowledge-mcp
```

## HTTP mode

Run a shared Streamable HTTP MCP server (127.0.0.1 only):

```bash
knowledge-mcp --http      # default port 8819
knowledge-mcp --http --port 8819
MCP_HTTP=1 knowledge-mcp
```

- Health: `GET http://127.0.0.1:8819/health`
- MCP: `POST http://127.0.0.1:8819/mcp`

Stdio remains the default when no `--http` flag is passed.
