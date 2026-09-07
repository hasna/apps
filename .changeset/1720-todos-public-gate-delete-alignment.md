---
"@hasna/todos": patch
---

Restore the admitted-local redaction's `delete env.TODOS_API_URL;` semantics in
stage-a and align the public-text-boundary exemption (and its gate tests) with
that emitted delete shape. The #1829 blanking workaround contradicted stage-a's
documented delete-not-blank law (a declared-but-blank authority is refused
loudly downstream) and left the gate stripping a shape the source no longer
emitted; the release-review P1 (0d22a7aa2) requires the exemption to match the
delete statement exactly, with every other spelling — a read, a blanking
assignment, any other module — still failing the boundary. The SDK README
documents the canonical HASNA_TODOS_API_URL / HASNA_TODOS_API_KEY names only.
