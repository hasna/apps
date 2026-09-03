---
"@hasna/telephony": patch
---

Switch @hasna/telephony local path reads/writes through the in-package resolver (XDG/macOS home layout). The telephony data home (SQLite store and audio output) is resolved as `~/.local/share/hasna/telephony` on Linux and `~/Library/Application Support/Hasna/telephony` on macOS, adopted only once the store has actually been migrated there or the operator sets the data-kind override `HASNA_DATA_HOME` — the legacy `~/.hasna/telephony` default stays the effective home until then, so an existing local store never becomes invisible on upgrade. The wave-wide resolver dependency (`@hasna/paths@0.1.0`) was deleted 2026-09-03 (hasna/apps#1535); the resolver is now implemented locally in-package.
