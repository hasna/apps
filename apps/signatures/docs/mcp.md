# MCP Reference

Start the default Streamable HTTP transport on port `8878`:

```bash
signatures-mcp
```

Use `signatures-mcp --stdio` for stdio transport. HTTP accepts `--port <n>` and
also reads `MCP_HTTP_PORT`. Use `signatures-mcp --help` for transport metadata
without starting the service.

## Documents and Workflows

| Tool | Behavior |
| --- | --- |
| `signatures_document_save` | Create or update a document record |
| `signatures_document_from_markdown` | Render Markdown and create document fields |
| `signatures_document_get` | Get a document by ID or slug |
| `signatures_document_list` | List documents with filters |
| `signatures_document_delete` | Delete a document |
| `signatures_document_search` | Search documents |
| `signatures_detect_fields` | Detect PDF signature fields |
| `signatures_sign` | Sign locally and create signer/completion evidence |
| `signatures_send_for_signature` | Create a session and optional email delivery |
| `signatures_connector_sign` | Register connector/browser-driven signing |
| `signatures_share_document` | Share through the attachments integration |
| `signatures_get_link` | Get a session share link |
| `signatures_receive_signed` | Receive a signed attachment and complete a session |

## Signers and Evidence

| Tool | Behavior |
| --- | --- |
| `signatures_person_create` | Create a reusable human or agent signer |
| `signatures_person_list` | List people/agents |
| `signatures_session_list` | List signing sessions and lifecycle state |
| `signatures_certificate_get` | Get a local session certificate |
| `signatures_provider_send` | Send or dry-run a provider workflow |
| `signatures_provider_evidence_list` | List durable provider evidence |
| `signatures_signature_create` | Create text, image, or OpenAI-generated drawing signatures |
| `signatures_signature_get` | Get a signature |
| `signatures_signature_list` | List signatures |

Provider sends require an explicit `signature_level`: `ses`, `aes`, `qes`,
`eseal`, or `qeseal`. A provider evidence record is not a validation report;
qualified workflows remain pending until external proof is recorded as valid.

## Organization and Configuration

| Tool | Behavior |
| --- | --- |
| `signatures_project_save`, `signatures_project_list` | Save or list projects |
| `signatures_collection_save`, `signatures_collection_list` | Save or list collections |
| `signatures_tag_save`, `signatures_tag_list` | Create or list tags |
| `signatures_stats` | Get aggregate statistics |
| `signatures_config_set`, `signatures_config_get` | Set or read configuration |

Configuration responses mask values whose key contains `key`, `secret`, or
`token`.

## Agent Coordination

The MCP server also exposes standard coordination tools used across Hasna apps:

| Tool | Behavior |
| --- | --- |
| `register_agent` | Register or refresh an idempotent agent session |
| `heartbeat` | Update the agent's last-seen time |
| `set_focus` | Set the active project context |
| `list_agents` | List registered agents |
| `send_feedback` | Send service feedback |
