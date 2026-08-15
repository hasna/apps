# Security Policy

Report security issues privately to the maintainers before opening a public
issue. Email `security@hasna.xyz`; if the GitHub repository is public and
advisories are enabled, maintainers may move the report into a private GitHub
advisory. Do not include secrets, private endpoints, or internal network details
in public reports.

## Defaults

- The API/dashboard binds to `127.0.0.1` by default.
- Local state is stored under `~/.hasna/uptime/`.
- Monitor URLs and hostnames can reveal internal infrastructure. Treat exported
  data and logs as sensitive.
- The CLI and MCP server do not execute arbitrary shell commands.
