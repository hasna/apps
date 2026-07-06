# connect-topaz-labs

TypeScript connector for the [Topaz Labs Image API](https://developer.topazlabs.com/reference).

## Features

- Image enhancement, upscaling, sharpening, denoising, restoration, generative upscale, and lighting
- Async job management and batch processing
- Model catalog, presets, tags, and upload URLs
- Account credits, usage, and webhook management

## Authentication

API key via `X-API-Key` header. Set `TOPAZ_LABS_API_KEY` or use profile config under `~/.hasna/connectors/topaz-labs/`.

## Quick Start

```bash
bun install
export TOPAZ_LABS_API_KEY=your-key
bun run dev image enhance --image-url https://example.com/photo.jpg
```

## API Base URL

`https://api.topazlabs.com/image/v1`

## Documentation

- [Topaz Labs API Reference](https://developer.topazlabs.com/reference)
- [Quickstart](https://developer.topazlabs.com/docs/quickstart)

## License

Apache-2.0
