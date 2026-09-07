---
"@hasna/domains": patch
---

Resolver-validation polish for hasna/apps#1720 (P2 lane).

- **CLI boundary reports a fail-closed refusal as one line.** An error that
  escapes a command action — the shared resolver's `domains fails closed: …`
  refusal naming the Keychain item, the credentials file and
  `HASNA_DOMAINS_API_KEY` — is now printed as a single stderr line with exit 1
  instead of a Bun source-context stack dump. Exit code, empty stdout and the
  message text are unchanged; only the presentation is.
- **`domains-mcp` fails closed at startup.** The store decision is resolved
  once before any transport is connected or port bound (mirrors mementos
  #1868): with no resolvable credential and no explicit local opt-in the
  server exits 1 with the same one-line refusal instead of connecting stdio,
  printing its banner and refusing only at the first tool call. A local
  opt-in announces `LOCAL mode` on stderr at startup. Nothing is created
  under the app home on the refusal path.
- **`domains-serve --help` / `-h` answers before the signing secret is
  resolved**, printing usage and exiting 0, the same way `--version` / `-V`
  already did; previously it died with "Missing API-key signing secret".
- **Safe-mode allow-list:** the never-registered `storage_status` entry is
  removed from `READ_ONLY_TOOLS`, and a static test now pins that every
  allow-listed tool is registered by the MCP entry.
- **Test hermeticity:** the subprocess store-resolution probes pin
  `HASNA_STATION` to a sentinel account so the ambient Keychain tier misses
  deterministically; on a provisioned station the real
  `hasna.credentials.domains.api-url` item previously contradicted the
  fixture authority and turned the CONTROL probe red.
