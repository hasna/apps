---
"@hasna/mementos": minor
---

Route memory locks, expired-lock cleanup, session ingestion/status/listing,
queue statistics, and synthesized profiles through the authoritative hosted
`/v1` API whenever a Mementos credential resolves. The client no longer opens
or consults local SQLite before selecting these hosted operations, while
explicit local mode keeps the existing local implementations.

Hosted session listing now preserves `session_id`, `limit`, and `offset` across
the CLI, MCP, SDK, client transport, and server route. A versioned page receipt
proves that the server applied the new contract, carries truthful continuation
metadata, and refuses older servers that could silently ignore filters. Session
ingestion returns the accepted job in its versioned receipt, avoiding an
ambiguous follow-up read after the server has already queued the transcript.

Profile scope now controls cache identity and source-corpus isolation: agent
profiles read only that agent, project profiles read only that project, and
global profiles use one canonical global cache. Cached profiles are stored as
resource records so they neither enter nor invalidate their own fact corpus.
Provider failures on the server now refuse instead of being reported as an
empty corpus, and both save and update hooks invalidate affected caches.

Lock, session, queue-statistics, and profile clients validate every field and
versioned contract they rely on. A malformed successful response refuses with
a stable protocol error instead of being represented as an empty list, zero
counters, a missing job, or a successful mutation.

The reduced MCP catalog keeps session/profile tools in `automation` and
memory-lock tools in `admin`; `core` and explicit `full` retain their intended
boundaries.
