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

Planned — scaffolding the repo. Design the catalog/search layer over the HF API first,
then the download/store manager, then run/serve.

## License

Open source (to be finalized — MIT/Apache-2.0).
