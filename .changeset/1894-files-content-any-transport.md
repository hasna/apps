---
"@hasna/files": patch
---

CLI and MCP content commands (context packs, search packs, hosted file reads/extracts, uploads and the organization-review machine operations) now run on the hosted transport through the service's data and extraction routes instead of refusing with "runs on-box only" or silently reading the machine-local island (hasna/apps#1894). Pack builders read through the Store the same way in both transports; organization tools stay machine-local operations and announce it, but are no longer transport-gated; a hosted run never opens the on-box SQLite. Command availability is now identical on every transport.
