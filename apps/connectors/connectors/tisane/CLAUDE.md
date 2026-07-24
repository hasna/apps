# CLAUDE.md

This file provides guidance to Claude Code when working with the Tisane connector.

## Project Overview

connect-tisane is a TypeScript CLI and library for the [Tisane NLP API](https://api.tisane.ai). It provides content moderation, sentiment analysis, language detection, and related NLP operations.

## Authentication

- **Type:** apikey
- **Header:** `Ocp-Apim-Subscription-Key`
- **Env var:** `TISANE_API_KEY`
- **Profile field:** `apiKey`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/languages` | List supported languages |
| POST | `/parse` | Parse text for NLP features |
| POST | `/helper/extract_text` | Extract text from HTML/URL |
| POST | `/compare/entities` | Compare entities between texts |
| POST | `/similarity` | Text similarity score |
| POST | `/detectLanguage` | Detect language |
| POST | `/transform` | Transform/translate text |

Default base URL: `https://api.tisane.ai` (override with `TISANE_BASE_URL` or profile `baseUrl`).

## Build & Run

```bash
bun install
bun run dev -- languages
bun run typecheck
bun test
bun run build
```

## CLI Commands

```bash
connect-tisane config set-key <key>
connect-tisane languages
connect-tisane parse -c "hello world"
connect-tisane detect-language -c "bonjour"
connect-tisane extract-text --url https://example.com
connect-tisane compare-entities --text1 "..." --text2 "..."
connect-tisane similarity --text1 "..." --text2 "..."
connect-tisane transform -c "hello" -t es
connect-tisane request --path /parse --body request.json
connect-tisane profile list|use|create|delete|show
```

## Data Storage

```
~/.hasna/connectors/connect-tisane/
├── current_profile
└── profiles/
    └── default.json
```

Profile JSON:
```json
{
  "apiKey": "your-subscription-key",
  "baseUrl": "https://api.tisane.ai"
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TISANE_API_KEY` | API subscription key |
| `TISANE_BASE_URL` | Optional API base URL override |
