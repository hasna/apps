# models

A Bun/TypeScript CLI and library for discovering, inspecting, indexing, and
downloading selected files from Hugging Face models, datasets, and Spaces.

> npm: `@hasna/models` · GitHub: `hasna/models` · CLI: `models`

## Why

The Hugging Face catalog is broad, while local workflows often need exact file
selection, byte limits, revision-aware references, and durable install metadata.
`models` provides those workflows through human-readable and JSON CLI output,
with a small TypeScript SDK for the same underlying operations.

## Status

The current CLI supports:

- Hugging Face provider status and local secret references.
- Catalog search, info, and file listing for models, datasets, and Spaces.
- SQLite catalog and remote-file indexing, including a top-model index command.
- Revision-aware download plans and selected-file model or dataset installs.
- Local install listing, path lookup, and preview-first metadata/file removal.
- Dataset-specific command aliases and local diagnostics.
- A persisted model capability schema with fixtures for routing consumers.

Runtime adapters, inference, serving, resumable downloads, cache management,
additional providers, and MCP are planned but not implemented. See
[PLAN.md](PLAN.md) for the target architecture and
[docs/GOALS.md](docs/GOALS.md) for implementation status.

## Quick start

From a source checkout:

```bash
bun install
bun run build
bun run src/cli/index.ts --help
bun run src/cli/index.ts providers status --json
bun run src/cli/index.ts search tiny-gpt2 --limit 3 --json
bun run src/cli/index.ts info hf:sshleifer/tiny-gpt2@main --json
bun run src/cli/index.ts plan hf:sshleifer/tiny-gpt2 \
  --include config.json \
  --include tokenizer_config.json \
  --max-bytes 5mb \
  --json
bun run src/cli/index.ts install hf:sshleifer/tiny-gpt2 \
  --include config.json \
  --max-bytes 5mb \
  --dry-run \
  --json
```

After a global package install, use the same arguments with the `models`
executable. Use `models manual` for a compact example list and `models --help`
or `models <command> --help` for the authoritative command surface. Most leaf
commands accept `--json`; action failures are also emitted as JSON when enabled.

Provider refs use `hf:owner/repo@revision`. Add `dataset:` or `space:` after the
provider for non-model repositories, for example
`hf:dataset:owner/repo@revision`. The revision defaults to `main`.

Downloads default to a 2 GiB known-byte cap. `--include` and `--exclude` are
repeatable and accept exact paths, basenames, directory prefixes ending in `/`,
or `*` globs. Plans with no matching files, known bytes above the cap, or unknown
file sizes under a cap are blocked. `install --dry-run` performs the same plan
without downloading.

## Local data

Local state lives at the effective models data home — `~/.hasna/models/` by
default, resolved through `@hasna/paths` to the XDG data home
(`~/.local/share/hasna/models`, or the macOS `~/Library/Application
Support/Hasna/models`) once the store has been migrated there or `HASNA_DATA_HOME`
is set:

- `models.db` stores catalog entries, remote file metadata, installs, and model
  capabilities.
- `auth.json` stores local auth configuration and secret references.
- `installs/` contains downloaded files grouped by provider, entity kind, repo,
  and revision.

Override locations with `HASNA_MODELS_HOME`, `HASNA_MODELS_DB`,
`HASNA_MODELS_CACHE`, and `HASNA_MODELS_INSTALLS`. `HF_ENDPOINT` overrides the
Hugging Face base URL.

## Authentication

Hugging Face tokens are resolved in this order:

1. `HF_TOKEN`, `HUGGINGFACE_HUB_TOKEN`, `HUGGING_FACE_HUB_TOKEN`, or
   `HUGGINGFACE_TOKEN`.
2. `huggingface.token` in `auth.json`.
3. A local `secrets` CLI key selected by `HASNA_MODELS_HF_SECRET_KEY`,
   `HF_SECRET_KEY`, `huggingface.secretKey` in `auth.json`, or the built-in keys
   `huggingface/token`, `huggingface/live/token`, and `hf/token`.

Configure a private or organization-specific secret reference without storing
the token in this repository:

```bash
models providers auth huggingface --secret-key <your/local/hf/token/key>
models providers status --json
```

Token values and configured secret-key names are redacted from provider status
output. Anonymous Hub access remains available when no token resolves. This
package targets Bun for both CLI and library use because storage uses
`bun:sqlite`.

## Capability schema

`@hasna/models` publishes `hasna.model-capability.v1` through the root SDK export
and `@hasna/models/capabilities`. Capability records describe provider/model
identity, aliases, context and output limits, input/output modalities, tool use,
function calling, structured output, JSON mode, pricing, latency class, safety
labels, privacy posture, runtime requirements, provider health, source, and a
capability version.

The local store persists validated records and resolves them by model id,
`provider:model`, `provider/model`, or alias:

```bash
models capabilities seed-fixtures --json
models capabilities list --provider ollama --json
models capabilities get gpt-4.1-mini --json
```

Golden fixtures cover OpenAI-compatible hosted models, Ollama, LM Studio,
Hugging Face artifacts, and provider-unavailable states. Validation rejects
missing required sections, unsupported support/modality/runtime/health values,
invalid token limits or prices, and missing required timestamps before records
are stored.

Current consumer surfaces are:

- SDK: `ModelCapability`, `validateModelCapability`,
  `assertModelCapability`, and `MODEL_CAPABILITY_FIXTURES`.
- Storage: `ModelsStore.upsertCapabilities`, `listCapabilities`, and
  `findCapability`.
- CLI: `models capabilities seed-fixtures`, `list`, and `get`.

Future MCP consumers should expose the same contract as read-only tools first.
Mutation tools should remain local/operator-gated until provider probes and
capability refresh jobs exist.

The complete parser-derived command inventory and backend-scope audit is in
[docs/CLI_AUDIT.md](docs/CLI_AUDIT.md).

## License

Apache-2.0.
