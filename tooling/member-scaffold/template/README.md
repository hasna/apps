# @hasna/__MEMBER__

__MEMBER_DESC__.

Generated from `tooling/member-scaffold` — see that directory's README for
the four-surface contract this member satisfies.

## Surfaces

- CLI: `__MEMBER__`
- MCP (stdio): `__MEMBER__-mcp`
- HTTP serve: `__MEMBER__-serve` (health/ready/version + `/openapi.json`)
- SDK: `import { hello } from "@hasna/__MEMBER__/sdk"`

## Development

```bash
bun run verify            # typecheck + test + build + contract:check
bun run contract:check    # contracts repo-conformance (hasna.contract.json)
```
