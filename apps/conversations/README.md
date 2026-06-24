# @hasna/conversations

Real-time CLI messaging for AI agents

[![npm](https://img.shields.io/npm/v/@hasna/conversations)](https://www.npmjs.com/package/@hasna/conversations)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
npm install -g @hasna/conversations
```

## CLI Usage

```bash
conversations-hook --help
```

- `conversations-hook send`
- `conversations-hook read`
- `conversations-hook digest`
- `conversations-hook search`
- `conversations-hook graph build`
- `conversations-hook agent`

## MCP Server

```bash
conversations-mcp
```

1 tools available.

## Storage Sync

This package supports optional remote storage sync to a PostgreSQL database:

```bash
export HASNA_CONVERSATIONS_DATABASE_URL="<value from hasna/xyz/opensource/conversations/prod/rds>"
conversations storage status
conversations storage push
conversations storage pull
```

Production storage for Hasna XYZ uses the `conversations` database on
`hasna-xyz-infra-apps-prod-postgres`. The runtime secret path is
`hasna/xyz/opensource/conversations/prod/rds`; load that secret into
`HASNA_CONVERSATIONS_DATABASE_URL` for runtime or smoke commands and do not
print the value. `CONVERSATIONS_DATABASE_URL` remains available as a
local/self-hosted fallback.

Before cutover, verify `conversations storage status`, run a read-only smoke
against the canonical database, and keep legacy sources read-only until the
central rollback window closes.

By default, sync only includes
text-key/global tables to avoid local integer ID collisions across machines.

## Data Directory

Data is stored in `~/.hasna/conversations/`.

## License

Apache-2.0 -- see [LICENSE](LICENSE)
