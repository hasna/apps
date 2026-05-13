---
name: image
description: Generate images using AI providers (OpenAI DALL-E 3, Google Gemini 3.0, xAI Aurora)
---

# Image Generation Skill

Generate high-quality images from text prompts using multiple AI providers.

This CLI is API-backed. Set `SKILL_API_KEY` when routing through the hosted skills/connectors runtime; provider-specific keys are managed by that runtime.

## Supported Providers

### OpenAI
- **Models**: dall-e-3, gpt-image-1
- **Sizes**: 1024x1024, 1792x1024, 1024x1792
- **Credentials**: managed by the hosted skills runtime

### Google Gemini 3.0 (Nano Banana)
- **Model**: gemini-3.0-generate-001
- **Sizes**: Configurable aspect ratios
- **Credentials**: managed by the hosted skills runtime

### xAI Grok-2 Image
- **Model**: grok-2-image-1212 (Grok's image generator)
- **Text-to-image capabilities**
- **Credentials**: managed by the hosted skills runtime

## Usage

```bash
# OpenAI DALL-E 3
bun run src/index.ts generate --provider openai --prompt "a cat" --output ./output.png

# Google Gemini 3.0
bun run src/index.ts generate --provider google --prompt "a dog" --output ./output.png

# xAI Aurora
bun run src/index.ts generate --provider xai --prompt "a bird" --output ./output.png
```

## Options

- `--provider`: Provider to use (openai, google, xai)
- `--prompt`: Text prompt for image generation
- `--output`: Output file path
- `--model`: (Optional) Specific model to use
- `--size`: (Optional) Image size (provider-specific)

## Environment Variables

Set the hosted runtime API key:

```bash
export SKILL_API_KEY="your-skill-api-key"
```
