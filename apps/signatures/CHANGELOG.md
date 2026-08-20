# Changelog

## 0.1.15

### Patch Changes

- ed27854: Republish with the canonical `signatures` bin. npm 0.1.14 is stale relative to this tree: the registry tarball still declares the retired `open-signatures` bin (renamed pre-import in hasna/signatures#7), while the monorepo tree and `hasna.contract.json` both declare `signatures`/`signatures-mcp`/`signatures-serve`. This version bump exists so the next release-train publish supersedes the stale registry metadata at a new version instead of colliding with 0.1.14 content.
- Updated dependencies [f1fe3f2]
  - @hasna/attachments@1.1.6

## 0.1.14

## 0.1.12

- Migrated global package-owned files, render cache, and database fallback from legacy `~/.signatures` to `~/.hasna/signatures` while preserving repo-local `.signatures` databases.

## 0.1.11

- Hardened routed signing so token/session completion signs the assigned field or next matching pending field instead of the first document field.
- Added signing-order enforcement for fielded and fieldless session workflows, including CLI smoke coverage for out-of-order rejection.
- Split local signer evidence certificates from full document completion certificates and recorded completion metadata.
- Bound agent input hashes to the PDF actually reviewed and signed, including already partially signed PDFs.

## 0.1.10

- Added first-class human and agent signers with `signer_type`, agent identity, run, thread, policy, reason, and hash metadata.
- Added signer routing metadata for Markdown signature anchors, sessions, fields, audit events, certificates, CLI, REST, MCP, and dashboard views.
- Added agent attestation rendering for local signatures and session listing/filtering by signer type and recipient status.

## 0.1.9

- Fixed CLI Markdown variable injection so dotted `--var client.name=value` arguments render as nested `{{ client.name }}` values.
- Preserved nested `signer.*` template data while allowing `--signer-name` and `--signer-email` to override those fields.

## 0.1.8

- Moved repository target to `hasna/signatures`.
- Added Markdown variable rendering and Markdown-to-PDF document creation.
- Added signature anchors from `{{signature}}` and `{{signature:name}}`.
- Added people/contact storage.
- Added shared local signing workflow with field resolution and completion certificates.
- Added open-emails invitation integration with dry-run fallback.
- Added open-domains signing-domain setup wrapper.
- Added PandaDoc and Yousign provider request preparation with explicit SES/AES/QES/eSeal/qeSeal levels.
- Added durable provider evidence records, session validation metadata, CLI/API/MCP provider send flows, and dashboard evidence views.
- Added Hasna connectors SDK routing for dry-run and future live provider execution.
- Added OSS governance docs and CI workflow.

## 0.1.7 And Earlier

Initial document, signature, field, session, REST, CLI, and MCP foundations.
