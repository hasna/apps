# models

A friendlier, more capable wrapper around Hugging Face for **discovering, searching,
downloading, and running local models** — open source.

> Folder: `open-models` · npm: `@hasna/models` · GitHub: `hasna/models` · CLI: `models`

## Why

The Hugging Face CLI gets the bytes down, but finding the right model, picking the
right format/quantization, managing disk, and actually running it is still fiddly.
`models` aims to be the single tool for the whole local-model lifecycle.

## Planned features

- **Browse & search** the full HF catalog with rich filters (task, library, license,
  size, format — GGUF/safetensors, quantization)
- **One-command install** of any model to a local store, with resumable downloads
- **Disk management** — see what's installed, sizes, dedupe, prune
- **Run / serve helpers** — quick local inference or an OpenAI-compatible endpoint
- **Search across installed + remote** in one place
- CLI + (later) MCP server, consistent with the Hasna OSS tooling

## Status

First CLI slice implemented. The package now has a Bun/TypeScript `models` CLI,
Hugging Face provider access, local SQLite catalog storage, selected-file
downloads, dataset search/install parity, and a local implementation goal chain.

See [PLAN.md](PLAN.md) for the full architecture and [docs/GOALS.md](docs/GOALS.md)
for the chained build goals.

## Quick start

```bash
bun install
bun run build
bun run src/cli/index.ts providers status --json
bun run src/cli/index.ts search tiny-gpt2 --limit 3
bun run src/cli/index.ts index best --limit 500 --json
bun run src/cli/index.ts install hf:sshleifer/tiny-gpt2 \
  --include config.json \
  --include tokenizer_config.json \
  --include vocab.json \
  --include merges.txt \
  --max-bytes 5mb
```

Local data is stored under `~/.hasna/models/` by default. Set
`HASNA_MODELS_HOME` or `HASNA_MODELS_DB` to isolate test stores.

Provider tokens are read from environment variables, `~/.hasna/models/auth.json`,
or generic local `secrets` keys such as `huggingface/token`. Secret references
stay local and are redacted from normal status output. For private or
organization-specific secret names, configure a local reference without
committing it:

```bash
models providers auth huggingface --secret-key <your/local/hf/token/key>
```

This package targets Bun for the CLI and library surface because it uses
`bun:sqlite`.

## License

Apache-2.0.
