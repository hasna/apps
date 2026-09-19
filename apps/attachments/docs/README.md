# Attachments documentation

- [Configuration](configuration.md): HTTPS credentials, preferences and server settings.
- [CLI](cli.md): remote attachment workflows and retired commands.
- [MCP](mcp.md): transport and remote tool boundary.
- [API](api.md): supported service routes and SDK exports.
- [Migration status](canonical-migration.md): provenance, validation and release blockers.

Clients never open an attachment database. The service owns PostgreSQL metadata
and object storage. Existing legacy data is not automatically copied or removed.
