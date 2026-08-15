# Contributing

Open Feedback is a Bun and TypeScript project.

## Local Setup

```bash
bun install
bun run typecheck
bun test
bun run build
```

## Development Rules

- Do not commit credentials, tokens, or customer feedback exports.
- Keep API, SDK, CLI, and MCP behavior aligned when adding a new feedback field.
- Add focused tests for validation, storage, HTTP behavior, and integration helpers.
- Use Apache-2.0 compatible dependencies.

## Release Checklist

1. Run `bun run typecheck`.
2. Run `bun test`.
3. Run `bun run build`.
4. Run `npm pack --dry-run`.
5. Run the required staged secrets scan before committing or pushing.
