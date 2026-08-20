---
"@hasna/conversations": patch
---

Fix `conversations send <channel> "<message>"` — the positional channel form taught by the fleet charter, .claude/rules/communication.md and dispatch briefs exited rc=1 with "Recipient is required" because only `<message>` was declared as a positional: the channel token bound to `<message>` and the real body was silently dropped as an excess argument (todos 4a2a4ac1). The send command now declares an optional second positional `[channel]`; when two positionals are present the first is resolved as the channel and the second as the message. The existing flag forms `send "<message>" --channel X` and `send "<message>" --to A` are unchanged, and a conflicting positional/`--channel` pair is rejected with an explicit ambiguity error instead of sending to the wrong recipient.
