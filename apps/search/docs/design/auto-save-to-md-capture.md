# Auto-save-to-md capture pipeline — design (C2 search)

Task I38-00187. Design of the auto-save-to-md capture pipeline for
`@hasna/search`: the capture points, the default-on recording policy, the
redaction boundary, and the S3 markdown corpus placement. The companion task
I38-00188 implements the frontmatter metadata schema, the corpus layout, and
the writer artifact this document specifies.

## Goal

Every completed search — wherever it runs (CLI, MCP, server) — is recorded as
an append-only markdown document in an S3 corpus, so a search session is
reproducible later: the query, the providers, the results, the errors, and
the provenance of the capture itself. Recording is ON by default, never
blocks or fails the search, and never stores credential-shaped content.

## Capture points

A search completes at exactly one place in the package: the
`unifiedSearch()` function in `src/lib/search.ts`, which already persists the
search record and results to history. That is the single capture point —
capturing there means the CLI `query`/`<provider>` commands, the MCP `search`
and `search_<provider>` tools, and the server `GET /api/search` and
`GET /api/search/<provider>` routes all capture without per-surface wiring.

Capture fires after the history write, at the boundary where the search
record and its results are fully known. If capture is disabled, unconfigured,
or failing, the search result is returned unchanged — capture never degrades
the search.

## Default-on recording policy

- Recording is **on by default**. No opt-in step exists.
- Opt-out, in order of precedence:
  1. per-call flag `capture: false` on the `unifiedSearch` options;
  2. environment `HASNA_SEARCH_CAPTURE=false`;
  3. config key `capture.enabled: false` in `~/.hasna/search/config.json`.
- A capture that is refused by the secret gate, or that fails to write, is
  **not retried at search time** and never blocks the search. The failure is
  recorded in the search's history row metadata so a later pass can inspect
  it.

## Redaction

Two layers, both required:

1. **At capture time** — before anything is rendered or written, every field
   that reaches the markdown body passes through the existing redaction
   module (`src/lib/redaction.ts`): `redactCredentialBearingText` for the
   query and free-text fields, and `redactContentSearchResult` per result.
   The rendered document marks the capture `redacted: true` when any field
   was changed.
2. **At write time** — the rendered markdown is scanned with
   `@hasna/secrets/scanner`'s `scanInputExposures` before the S3 PUT. Any
   finding refuses the write with `SECRET_FOUND` and nothing is stored. This
   mirrors the plans app S3 store gate (I38-00175) so the corpus has one
   invariant across both writers.

Redaction at capture time preserves search ranking and coordinates (which
operate on the pre-redaction text); the write-time scan is the backstop that
makes the corpus safe even for fields the redactor does not recognize.

## S3 md corpus placement

- Bucket: `HASNA_SEARCH_S3_BUCKET` (required for capture; capture is inert
  when unset). Region: `HASNA_SEARCH_S3_REGION` or `AWS_REGION`, default
  `us-east-1`. Prefix: `HASNA_SEARCH_S3_PREFIX`, default `search`.
- Object key: `<prefix>/<yyyy-mm-dd>/<captureId>.md` — date-bucketed for
  enumeration and lifecycle policies, captureId-unique for immutability.
- **Append-only, create-exclusive**: every PUT uses `If-None-Match: "*"`.
  A taken key returns 412 and the capture is skipped (a captureId collision
  means the search was already recorded). Nothing in the corpus is ever
  overwritten.
- **Verified writes**: after the PUT, a HEAD must report the exact byte size
  that was written; on any verification failure the freshly written object
  is removed again (the writer owns the key via create-exclusive PUT), so a
  partial failure cannot leave an unverified object.
- **Size bound**: a capture larger than 2 MiB is refused with
  `CAPTURE_TOO_LARGE` rather than written.
- The capture document is `text/markdown; charset=utf-8`.

## Capture document shape

A capture is one markdown document:

```
---
<frontmatter: schema_version, capture_id, kind, query, providers,
 profile_id, result_count, duration_ms, captured_at, capture_point,
 redacted>
---

# <query>

*<result_count> results from <providers>* — captured <captured_at>

## 1. <title>

**Source:** <provider> | **URL:** <url>
[**Published:** <publishedAt>] [**Score:** <score>]

> <snippet>

---
```

The exact frontmatter schema, the YAML renderer, and the corpus key layout
are implemented under I38-00188 in `src/lib/capture/` (frontmatter schema,
layout, writer) with tests. This document is the contract they implement.

## Non-goals (separate tasks)

- Corpus retrieval/index surface (search history `--export-md`, corpus
  search) — I38-00189.
- The research-graph data model — I38-00190.
- Any change to the local history tables; capture is additive.
