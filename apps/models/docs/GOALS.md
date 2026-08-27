# Goal chain

## Goal 1: CLI foundation and Hugging Face catalog

Status: in progress in this repo.

- Publishable Bun/TypeScript package.
- `models` CLI with JSON contracts.
- Hugging Face auth discovery through env, local config, and `secrets`.
- SQLite catalog under the models data home (`~/.hasna/models/models.db` by default, resolved via `@hasna/paths` to the XDG data home once adopted).
- Search, info, files, best-model indexing, and selected-file installs.
- Tiny model download smoke tests.

## Goal 2: Dataset-first workflows

- Dataset search/info/files/install parity.
- Safe sample/stream commands before full materialization.
- Split-aware metadata and max-byte defaults.
- Dataset fixture tests with tiny public datasets.

## Goal 3: Runtime adapters

- `ollama` detection and pull/run helpers.
- `llama.cpp` GGUF plan/run/serve helpers.
- `vllm` server plan for GPU machines.
- `mlx-lm` plan for Apple Silicon.
- Runtime compatibility reports that explain memory, disk, and command gaps.

## Goal 4: Machine-aware installs

- Optional `@hasna/machines/consumer` adapter.
- CLI fallback to installed `machines`.
- Local fallback when machines is absent.
- `models machines preflight`, `models machines install`, and remote dry-run plans.

## Goal 5: Provider expansion

- GitHub release artifact provider.
- ModelScope model/dataset provider.
- Kaggle dataset/model provider.
- Civitai model/version artifact provider.
- Provider conformance fixtures so Hugging Face is not special-cased.

## Goal 6: Agent and release interfaces

- `models-mcp` with CLI/MCP parity manifest.
- SDK fixtures and JSON contract snapshots.
- Local REST/serve option if needed by dashboards.
- Release smoke: build, test, pack, local install, tiny download, best index.
