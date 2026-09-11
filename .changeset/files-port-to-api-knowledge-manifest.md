---
"@hasna/files": minor
---

The knowledge manifest now works on the hosted transport.

`files knowledge manifest` and the MCP `export_knowledge_manifest` were on-box
only: with a hosted credential they refused, so the `knowledge` app could only
index from a local store. The files service now builds the same manifest from
its own data and serves it at `GET /v1/knowledge/manifest`; both clients read it.

The envelope, cursor encoding, `manifest_id`, `open_files_root` evidence and its
hash, `source_revision_hash`, permission labels and the JSON/JSONL rendering
moved to a shared pure module that both the on-box exporter and the service
import — so the two transports produce the same document and a cursor minted by
one is readable by the other. Delta walks (`--delta`, `--since-sync-version`,
`--since-cursor`) work hosted, with the high watermark carried in the cursor so a
page is never widened mid-walk by later writes.

Two options are refused rather than answered with empty data:

- `include_acl_summary` — the service does not model file organization reviews,
  so there is no honest summary to return. An absent one would read as
  "reviewed, nothing to report".
- `include_evidence_assets` — evidence assets have their own route,
  `GET /v1/evidence/assets`.

An S3 manifest artifact still requires on-box source credentials and is refused
on the hosted transport; a local `--out` / `output_local_path` artifact is
written as before.

Hosted failures now show the reason the service gave instead of only a status
code. The check is structural rather than `instanceof`, because
`@hasna/contracts/client` can resolve to more than one module instance and a
cross-instance error object fails `instanceof` despite being the right shape.
