# MCP server

`economy-mcp` uses stdio by default:

```bash
claude mcp add --transport stdio --scope user economy -- economy-mcp
```

Codex configuration:

```toml
[mcp_servers.economy]
command = "economy-mcp"
args = []
```

Gemini settings:

```json
{
  "mcpServers": {
    "economy": { "command": "economy-mcp", "args": [] }
  }
}
```

`economy mcp --all` prints these snippets. The MCP server uses the same local-versus-cloud Store selection as the CLI; the credential resolves through the `@hasna/contracts` chain as described in [configuration](configuration.md#climcp-cloud-client).

## Streamable HTTP

```bash
economy-mcp --http                 # http://127.0.0.1:8860/mcp
MCP_HTTP=1 economy-mcp             # same
economy-mcp --http --port 8815
```

`MCP_HTTP_PORT` supplies the default HTTP port. The transport binds to loopback, exposes `POST /mcp`, and exposes `GET /health`. Stdio remains the default when `--http`/`MCP_HTTP` is absent.

## Tools

Discovery helpers:

- `search_tools`, `describe_tools`

Cost and activity reads:

- `get_cost_summary`, `get_sessions`, `get_session_detail`, `get_top_sessions`
- `get_model_breakdown`, `get_project_breakdown`, `get_agent_breakdown`, `get_account_breakdown`, `get_cost_center_breakdown`
- `get_daily`, `list_machines`, `get_usage`, `get_savings`, `get_billing_summary`

Management and estimation:

- `get_budget_status`, `set_budget`, `remove_budget`
- `get_goals`, `set_goal`, `remove_goal`
- `get_pricing`, `set_pricing`, `remove_pricing`, `estimate_cost`
- `list_subscriptions`, `set_subscription`, `remove_subscription`
- `sync`, `send_feedback`

Shared agent lifecycle tools:

- `register_agent`, `heartbeat`, `set_focus`, `list_agents`

High-cardinality tools return compact text by default. Where the schema offers them, use `limit`, `verbose=true`, or `json=true`. Limits are clamped to 100 for MCP calls.

The `sync` tool accepts `all`, any supported coding agent, or `loops`. It ingests on-box files (in local mode into the local SQLite; in cloud-client mode it reads the on-box files on this machine and pushes the rows to the shared API).
