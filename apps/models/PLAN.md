# Hasna Models build plan

## Goal

Build `@hasna/models` as a CLI-first local model and dataset lifecycle tool.
The first version should make Hugging Face easy to search, inspect, install,
cache, and run locally, while keeping the provider contract broad enough for
ModelScope, Kaggle, Civitai, GitHub release assets, Ollama libraries, and future
registries.

The product should feel like the model equivalent of the existing Hasna tools:
one package, one CLI, stable JSON contracts, local-first storage, optional MCP
later, and optional `@hasna/machines/consumer` integration for remote/local
machine resolution.

## Research summary

Hugging Face is the first provider, but the abstraction should not be named
around Hugging Face. The Hub has model, dataset, and Space repo types, plus
collections, papers, jobs, inference providers/endpoints, and storage buckets.
Its repo cards carry the important discovery metadata: license, task, language,
dataset links, tags, and size-like metadata. Hugging Face also exposes JS and
Python libraries for listing, repo access checks, file downloads, cache scans,
and full snapshot downloads.

Datasets need first-class treatment, not a side command. Hugging Face Datasets
supports Hub datasets, local files, remote files, specific revisions, split
mapping, streaming for huge datasets, and separate cache controls. The CLI
should default to inspecting and streaming samples before downloading large
datasets.

Local execution is a runtime problem, not a provider problem. Providers answer
"what exists and where are the files"; runtimes answer "can this artifact run on
this machine." The first runtime adapters should be:

- `ollama`: easiest local UX for common chat models and its own model store/API.
- `llama.cpp`: best direct path for GGUF, CPU/GPU, OpenAI-compatible local server.
- `vllm`: higher-throughput server for GPU machines and safetensors/HF models.
- `mlx`: Apple Silicon path through `mlx-lm` and MLX-compatible models.
- `python-transformers`: fallback/debug path for models that need custom Python.

Comparable providers are not all model hubs. ModelScope is a model/dataset hub
with inference/training APIs. Kaggle has datasets, models, competitions, and
kernels. Civitai is model/version/artifact heavy for image models. GitHub
releases are a generic artifact source with release asset metadata and digests.
The provider interface must therefore support different entity kinds, metadata
quality, auth, license gates, and download mechanisms.

## Local ecosystem constraints

Follow these existing package patterns:

- Use Bun, TypeScript, Commander, and `@hasna/models` with binaries
  `models` first and `models-mcp` later.
- Store local state under `~/.hasna/models/`.
- Prefer dry-run plans for installs, runtime setup, destructive cache actions,
  and remote-machine operations.
- Every important command should have `--json`.
- Keep CLI/MCP parity as a contract, even if MCP ships after the CLI.
- Keep private credentials out of public manifests. Store provider tokens in a
  local profile/auth file or delegate to existing connector/secret tooling later.
- Treat `@hasna/machines/consumer` as optional. Try SDK, then `machines` CLI,
  then local fallback diagnostics.

## Core architecture

Separate the system into four contracts.

### Provider adapter

Responsible for catalog/search/info/files/download metadata, not execution.

```ts
export interface ModelProviderAdapter {
  id: string;
  capabilities: ProviderCapabilities;
  search(input: SearchInput): AsyncIterable<CatalogEntry>;
  info(ref: ProviderRef): Promise<CatalogEntryDetail>;
  files(ref: ProviderRef): AsyncIterable<RemoteFileEntry>;
  resolveDownload(input: DownloadRequest): Promise<DownloadPlan>;
  checkAccess?(ref: ProviderRef): Promise<AccessCheck>;
}
```

Normalize all providers into:

- `provider`, `entity_kind`, `repo_id`, `revision`, `canonical_url`
- `license`, `gated`, `requires_auth`, `publisher`, `tags`, `task`, `modality`
- `files[]` with path, size, etag/digest when available, format, quantization
- `card` metadata and raw provider metadata for debug

First adapters:

- `huggingface`: models, datasets, spaces, collections, repo files.
- `github-release`: generic artifact fallback for projects distributing GGUF,
  ONNX, safetensors, or archives outside model hubs.
- Later: `modelscope`, `kaggle`, `civitai`, `ollama-library`.

### Artifact selector

Responsible for picking the right file set.

Inputs:

- desired task: chat, completion, embedding, rerank, image, audio, dataset
- machine facts: OS, CPU, RAM, disk, GPU, VRAM, Apple Silicon, installed runtimes
- preferences: quantization, format, max size, license policy, offline mode

Output:

- ranked install candidates
- reason for each candidate
- expected disk and memory requirements
- compatible runtimes
- exact files to download

This avoids blindly downloading every file in a large repo.

### Local store

Use SQLite metadata plus a content/cache directory.

Recommended layout:

```text
~/.hasna/models/
  models.db
  auth.json
  config.json
  cache/
    huggingface/
    github-release/
  installs/
    <provider>/<namespace>/<name>/<revision>/
  runtimes/
  logs/
```

Do not fight Hugging Face's cache unless needed. Use provider-native caching
where reliable, but record installed entities in `models.db` with paths,
revision, selected files, size, digests, license decision, access decision,
runtime compatibility, and provenance. Prefer symlinks or references from
`installs/` into provider cache over duplicate bytes.

### Runtime adapter

Responsible for setup, run, serve, stop, and health.

```ts
export interface RuntimeAdapter {
  id: string;
  detect(machine: MachineTarget): Promise<RuntimeStatus>;
  planSetup(input: RuntimeSetupInput): Promise<RuntimeSetupPlan>;
  canRun(input: InstalledArtifact): Promise<RuntimeCompatibility>;
  run(input: RunInput): Promise<RunPlan | RunHandle>;
  serve(input: ServeInput): Promise<ServePlan | ServeHandle>;
}
```

Each runtime adapter should produce a plan first. Applying a setup plan should
require explicit `--apply --yes`, matching `open-machines`.

## CLI shape

First release command surface:

```bash
models providers list
models providers auth huggingface
models providers status --json

models search "qwen coder" --task text-generation --license apache-2.0 --json
models info hf:Qwen/Qwen3-Coder --json
models files hf:Qwen/Qwen3-Coder --format safetensors --json

models plan hf:Qwen/Qwen3-Coder --machine local --json
models install hf:Qwen/Qwen3-Coder --runtime llama.cpp --quant q4_k_m --json
models list --installed --json
models where hf:Qwen/Qwen3-Coder --json
models remove <install-id> --dry-run --json
models cache status --json
models cache prune --dry-run --json

models run <install-id-or-ref> "hello" --json
models serve <install-id-or-ref> --runtime vllm --port 11435 --json
models ps --json
models stop <serve-id> --json

models datasets search "medical images" --json
models datasets info hf:stanford-crfm/whatever --json
models datasets sample hf:... --split train --limit 5 --json
models datasets stream hf:... --split train
models datasets install hf:... --split train --max-bytes 20GB --json

models machines topology --json
models machines preflight local --json
models machines install spark01 hf:... --dry-run --json
models machines run spark01 <install-id-or-ref> "hello" --json

models doctor --json
models manual
```

Keep `models install` friendly for humans, but make `models plan` the contract
agents and tests depend on.

## Machine integration

Machine support should be optional and layered:

1. Import `@hasna/machines/consumer` dynamically.
2. If unavailable, call installed `machines topology --json` / compatibility
   commands.
3. If unavailable, use local-only probes.

Use machines for route and workspace resolution, then run app-owned probes over
`runMachineCommand` or CLI fallback:

- OS, architecture, CPU cores
- RAM and disk free
- GPU command availability: `nvidia-smi`, `rocm-smi`, `system_profiler`
- runtime command availability: `ollama`, `llama-server`, `vllm`, `mlx_lm`
- Python/Bun availability

The `models` package should own model-specific compatibility logic; machines
should only provide route/workspace/command execution boundaries.

## Dataset handling

Datasets should share provider/search/auth/storage infrastructure with models
but have their own install semantics:

- `sample` and `stream` before `install`
- split-aware metadata
- file-pattern selection
- row/sample previews
- max byte caps by default
- local materialization records with source revision and data files
- no accidental full download of massive corpora

For Python-heavy dataset transforms, `models` can generate a deterministic
Python runner script or call `python -m datasets` helpers, but the durable CLI
contract should stay in TypeScript JSON.

## Safety and policy

Defaults:

- Search/info/list are side-effect free.
- Install is explicit and records license/gated access decisions.
- Runtime setup is dry-run by default.
- Running provider repo code is disabled unless a command opts in clearly.
- Destructive removal and pruning are preview-first.
- Provider tokens are never printed in JSON, logs, or errors.
- Download plans must show total estimated bytes and unresolved size gaps.
- Gated/private repo errors should be structured, not swallowed.

## Implementation phases

### Phase 0: scaffold and contracts

- Add `package.json`, `tsconfig.json`, Bun build/test scripts.
- Add `src/cli/index.ts`, `src/index.ts`, `src/types.ts`.
- Add `src/providers/types.ts`, `src/store/schema.ts`, `src/runtimes/types.ts`.
- Add a small JSON contract test for every command added.

Exit criteria: `models --help`, `models doctor --json`, and `bun test`.

### Phase 1: Hugging Face catalog

- Implement `huggingface` provider using `@huggingface/hub` where practical.
- Commands: `providers`, `search`, `info`, `files`.
- Normalize model/dataset/space entries.
- Persist search snapshots and info lookups in SQLite with TTL.

Exit criteria: can inspect public/gated/private error states and produce stable
JSON without downloading model bytes.

### Phase 2: install/store manager

- Implement download planning and exact file selection.
- Support full snapshot and selected-file download.
- Record install provenance, size, digests/etag, and local paths.
- Add `list`, `where`, `remove`, `cache status`, `cache prune`.

Exit criteria: install a small public model and a small dataset, list them,
remove them through dry-run/apply, and verify no duplicate metadata drift.

### Phase 3: runtime adapters

- Start with `ollama` and `llama.cpp`; add `vllm` and `mlx` after contracts hold.
- Implement `doctor`, `runtimes status`, `plan`, `run`, and `serve`.
- Normalize OpenAI-compatible local endpoint output where possible.

Exit criteria: run or serve a compatible local artifact, capture process/port
metadata, and expose health in JSON.

### Phase 4: machine-aware workflows

- Add optional `@hasna/machines/consumer` integration.
- Commands: `machines topology`, `machines preflight`, `machines install`,
  `machines run`.
- Add remote dry-run plans before SSH execution.

Exit criteria: local fallback works without machines installed; SDK/CLI adapter
smoke tests pass when machines is present.

### Phase 5: more providers and MCP

- Add `github-release`, then `modelscope` or `kaggle` based on usage.
- Add `models-mcp` with parity manifest.
- Add SDK fixtures and command contract snapshots.

Exit criteria: provider adapter tests prove Hugging Face is not special-cased in
the store or runtime layers.

## Tests to require early

- Provider contract tests with fixture JSON and no network.
- One network smoke behind an explicit env flag.
- CLI JSON snapshot tests.
- Store migration tests.
- Download planner tests for GGUF, safetensors shards, dataset shards, missing
  sizes, gated repos, and revision pinning.
- Runtime planner tests for CPU-only, NVIDIA GPU, Apple Silicon, and missing
  runtime cases.
- Machines adapter smoke matching `open-knowledge` style: SDK, CLI, unsupported
  future contract, no-SDK fallback.

## Sources checked

- Hugging Face Hub Python API:
  https://huggingface.co/docs/huggingface_hub/en/package_reference/hf_api
- Hugging Face file download API:
  https://huggingface.co/docs/huggingface_hub/en/package_reference/file_download
- Huggingface.js Hub API:
  https://huggingface.co/docs/huggingface.js/en/hub/README
- Hugging Face model cards:
  https://huggingface.co/docs/hub/en/model-cards
- Hugging Face dataset cards:
  https://huggingface.co/docs/hub/en/datasets-cards
- Hugging Face Datasets loading, streaming, and cache docs:
  https://huggingface.co/docs/datasets/en/loading
  https://huggingface.co/docs/datasets/en/stream
  https://huggingface.co/docs/datasets/en/cache
- Ollama API docs:
  https://github.com/ollama/ollama/blob/main/docs/api.md
- llama.cpp server docs:
  https://github.com/ggml-org/llama.cpp/tree/master/tools/server
- vLLM project README:
  https://github.com/vllm-project/vllm
- MLX LM README:
  https://github.com/ml-explore/mlx-lm
- ModelScope README:
  https://github.com/modelscope/modelscope
- Kaggle CLI README:
  https://github.com/Kaggle/kaggle-cli
- GitHub release assets API:
  https://docs.github.com/en/rest/releases/assets
