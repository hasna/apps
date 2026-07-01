# App Integration

Use one stable `appId` per application. Store entries through the SDK, API, CLI, or MCP tools during development and release work, then generate or publish an app-specific `CHANGELOG.md`.

## Recommended Flow

1. Add entries as changes land.
2. Generate a release preview with `changelog generate --app <appId> --version <version>`.
3. Review the dry-run output with `changelog publish --app <appId> --dry-run`.
4. Write the target only with `changelog publish --app <appId> --write`.

The global registry remains in the JSONL data file, while individual app changelog files are deliberate publish artifacts.

