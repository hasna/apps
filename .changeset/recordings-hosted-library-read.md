---
"@hasna/recordings": minor
---

Add explicit hosted Library list/get support across CLI, stdio MCP, the loopback serve proxy, and SDK exports. The shared adapter uses the existing hosted client, typed cursors and metadata-only output by default. API authority and credential references are explicit; HTTP callers supply their own bearer session. Legacy modes remain available. This does not add hosted sign-in, writes, microphone control or transcription.
