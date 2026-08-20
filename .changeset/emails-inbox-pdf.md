---
"@hasna/emails": minor
---

feat(emails): `emails inbox pdf <id>` renders a synced email to a local PDF file (--out path, --json {path, bytes, ok: true}); mirrors `open`'s data path and never marks the email read. Rendering is local-only via pdf-lib (pure-JS, no external service); the body is reduced through the package's canonical html->text path with the same fallbacks as the TUI.
