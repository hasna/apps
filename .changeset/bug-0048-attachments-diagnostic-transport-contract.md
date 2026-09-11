---
"@hasna/attachments": patch
---

Drop the misleading local `Preferences:` line from the `attachments status` / `attachments doctor` report and state the transport and its mode on one stable line: `Transport: authenticated HTTPS (remote-only; no local fallback)`. That `remote-only` marker is the documented replacement for the pre-1.2.0 `Mode:` line, which was retired with the local SQLite/`localhost:3459` fallback, so consumers no longer read a local-mode signal off the only diagnostic the CLI offers and mis-triage a healthy remote-only CLI as unconfigured (BUG-0048).
