---
"@hasna/files": minor
---

Knowledge-source resolution now works on the hosted transport.

`files knowledge resolve`, `files knowledge doctor`, `files extract-snapshot`
and the MCP tools `resolve_knowledge_source`, `doctor_knowledge_sources` and
`resolve_extracted_text` used to run on-box only: with a hosted credential they
refused, and the only way to use them was the opt-in local store. Each one's
underlying operation already had a versioned route, so they now compose those
routes instead:

- metadata comes from `GET /v1/files/{id}` (or `GET /v1/files/by-path`),
- content from `GET /v1/files/{id}/content`,
- extracted text and snapshots from `POST /v1/files/{id}/extract-text`,
- signed URLs from `POST /v1/files/{id}/sign-download`,
- `knowledge doctor` collects its refs from `GET /v1/files`.

The on-box implementations are unchanged and still serve the local opt-in
(`HASNA_FILES_LOCAL=1`); no hosted run opens the local database. Status,
recommendation and summary logic is now shared by both transports, so the two
cannot drift.

On the hosted transport `knowledge doctor` always asks the service for
extracted text when extracted text is required — file metadata does not carry
text availability, so the answer is measured rather than inferred.
