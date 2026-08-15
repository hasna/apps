# Contributing

Use Bun for local development:

```bash
bun install
bun run check
```

`bun run check` runs typecheck, tests, and build in that order (same as `prepublishOnly`).

Guidelines:

- Never commit real TOTP seeds, OTP codes, API keys, passwords, tokens, screenshots containing codes, or local vault files.
- Keep CLI and MCP output redacted by default.
- Add focused tests for new parsing, generation, storage, and CLI behavior.
- Preserve the public package mapping: repo `open-otp`, package `@hasna/otp`, GitHub repo `hasna/otp`, CLI `otp`, MCP binary `otp-mcp`, data directory `~/.hasna/otp/`.
