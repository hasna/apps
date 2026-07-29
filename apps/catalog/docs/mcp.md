# MCP server

The `catalog-mcp` binary runs an MCP server over stdio. It opens the default
catalog database and exposes exactly two read-only tools.

Example client configuration:

```json
{
  "mcpServers": {
    "catalog": {
      "command": "catalog-mcp",
      "env": {
        "CATALOG_DB_PATH": "/absolute/path/to/catalog.db"
      }
    }
  }
}
```

Do not write protocol messages to the process outside the MCP client. Stdout is
reserved for the stdio transport.

## `catalog_list`

Lists or searches application records and returns:

```json
{ "apps": [], "count": 0 }
```

All inputs are optional:

| Input | Type | Behavior |
| --- | --- | --- |
| `lifecycle` | enum | `active`, `stub`, `deprecated`, or `archived` |
| `channel` | enum | `stable`, `beta`, `canary`, or `internal` |
| `query` | non-empty string | Search app id, npm name, summary, and tags |
| `limit` | positive integer, max 1000 | Maximum returned records |

Without `query`, lifecycle and channel are applied by the store and the
default list limit is 500. With `query`, the search runs first (default limit
50; store maximum 500), then lifecycle and channel are applied to that result.
Consequently, filters can reduce the returned count below `limit`.

## `catalog_get`

Input:

```json
{ "app_id": "open-example" }
```

`app_id` is a required non-empty string. A match returns
`{ "app": App }`. A missing record returns an MCP tool error whose text is
`app not found: <app_id>`.

Schema validation and store errors are returned as tool errors rather than
crashing the server.

## Library integration

The `@hasna/catalog/mcp` export provides `createCatalogMcpServer` and
`registerCatalogMcpTools`:

```ts
import { createCatalogMcpServer } from "@hasna/catalog/mcp";

const server = createCatalogMcpServer({
  name: "my-catalog",
  version: "1.0.0",
  store,
});
```

The optional store implements `CatalogStoreLike`, which makes the tools usable
with an in-memory or alternate read model in tests and embedding applications.
