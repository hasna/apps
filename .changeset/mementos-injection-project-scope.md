---
"@hasna/mementos": patch
---

Honor explicit project scope for private memories in context and injection paths,
reject unknown projects before memory access, canonicalize accepted project names and
paths to their stable IDs, and preserve unassigned owner context in the library
and MCP injection strategies.

Apply the optional null-or-project list filter before pagination and counts, and
parse comma-separated categories so default CLI injection returns its configured
memory categories over HTTP.
