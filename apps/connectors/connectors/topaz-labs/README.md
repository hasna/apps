# connect-topaz-labs

TypeScript connector for the [Topaz Labs Image API](https://developer.topazlabs.com/reference).

## Features

- Multipart async image operations for enhance, generative enhance, sharpen, generative sharpen, denoise, restore, lighting, matting, and tool processing
- Status lookup, status cleanup, download URL retrieval, and cancellation by `process_id`
- Standard, generative, and bulk estimate calls
- Profile-backed API key storage with private config directories and key-bearing files

## Authentication

API key via the `X-API-Key` header. Set `TOPAZ_LABS_API_KEY` or use profile config under `~/.hasna/connectors/topaz-labs/`.

## Quick Start

```bash
bun install
export TOPAZ_LABS_API_KEY=your-key
bun run dev image enhance --image ./photo.jpg --output-format png
bun run dev status get <process_id>
bun run dev download output <process_id>
```

## API Base URL

`https://api.topazlabs.com/image/v1`

## Documentation

- [Topaz Labs API Reference](https://developer.topazlabs.com/reference)
- [Image API OpenAPI YAML](https://openapi.gitbook.com/o/HctdcUHRfIWXBVA1egPp/spec/image-12-25-updated.yaml)

## License

Apache-2.0
