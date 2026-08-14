# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-agent is a TypeScript connector for the Agent.ai API. It provides access to Agent.ai's action-based endpoints including web text extraction, agent invocation, screenshots, YouTube transcripts, domain info, image generation, text-to-speech, and REST API calls.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## API Reference

- **Base URL**: `https://api-lr.agent.ai/v1`
- **Auth**: Bearer token (`Authorization: Bearer <key>`)
- **Rate Limits**: 20 requests/minute, 1000 requests/day
- **Request Format**: POST with JSON body
- **Response Format**: `{ status, metadata?, response, error? }`

## API Modules

| Module | Actions |
|--------|---------|
| `actions` | grabWebText, invokeAgent, screenshot, youtubeTranscript, domainInfo, generateImage, textToSpeech, restApi |

## CLI Commands

| Command | Description |
|---------|-------------|
| `profile list\|use\|create\|delete\|show` | Manage profiles |
| `config set-key\|show\|clear` | Manage configuration |
| `action web-text` | Extract text from a web page |
| `action invoke` | Invoke an agent |
| `action screenshot` | Take a web page screenshot |
| `action youtube-transcript` | Get YouTube video transcript |
| `action domain-info` | Get domain information |
| `action generate-image` | Generate an image from a prompt |
| `action tts` | Convert text to speech |
| `action rest-api` | Make a REST API call |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `AGENT_AI_API_KEY` | Agent.ai API key (overrides profile) |
| `AGENT_AI_TOKEN` | Alias for API key |

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere
