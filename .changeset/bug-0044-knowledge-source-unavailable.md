---
"@hasna/knowledge": patch
---

A fail-closed credential resolution now reports the dark source MACHINE-READABLY
instead of only in prose (BUG-0044). The rejection is a typed
`KnowledgeSourceUnavailableError` (`code: 'source_unavailable'`, exported from
the package root), and the CLI exits **3** — distinct from the generic `1` and
the version-conflict `2` — with `--json` carrying `status: 'unavailable'`,
`credential_source: 'none'`, the consulted credential-file paths, the credential
env KEY NAMES, the Keychain-tier flag, and the underlying reason. A run that
consumes KNOWLEDGE as a source can record `status=unavailable` from the field
instead of reading the message, and can tell a dark source apart from a command
that failed for an unrelated reason. The payload is value-free and never echoes
an authority URL the resolution refused to use; the human-readable message and
its existing assertions are unchanged.
