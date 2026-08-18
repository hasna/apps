---
"@hasna/loops": patch
---

`loops show` (CLI, API, and MCP) no longer reports the placeholder literal `'shell'` as a shell command loop's target. Command targets now expose the real resolved command line (secret-scrubbed and bounded for shell targets), a `commandDigest` (`cmd:sha256:<hex>`) binding the exact stored command + shell-quoted args the executor will run, and `commandResolvedFrom: "stored-target"` provenance. An operator can prove the stored target matches an intended candidate by comparing digests; a one-byte mutation changes the digest; credential-shaped values remain scrubbed; non-shell command targets keep their command name and gain the same digest. The executor's shell path now shares the same resolved-command-line function, so the digest binds exactly what runs.
