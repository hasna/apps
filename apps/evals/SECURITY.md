# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email **security@hasna.com** with details
3. Include steps to reproduce if possible
4. Allow reasonable time for a fix before public disclosure

## Security Model

### Local-first Architecture

open-evals stores all run history in a local SQLite database. No data is sent to external servers unless you explicitly configure an LLM-as-judge that calls an external API.

### API Keys

API keys for judge models (Anthropic, OpenAI) are read from environment variables — never stored in eval case files or the database.

### Data at Rest

- SQLite database is stored at `~/.hasna/evals/evals.db`
- Eval case files are plain JSONL — never include secrets in them
- Judge reasoning and verdicts are stored in the database

## Best Practices

- Set `EVALS_DB_PATH` to a location with restricted permissions
- Use environment variables for all API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`)
- Review generated eval cases before running them against production endpoints
