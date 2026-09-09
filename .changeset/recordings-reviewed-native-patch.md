---
"@hasna/recordings": none
---

Applied release record: the Recordings-only patch Changeset was already applied
in an isolated Changesets workspace to prepare 0.4.1. Retain this no-bump record
for the main-based version diff without scheduling an unintended 0.4.2 release.

Package the reviewed native paste-target tracking and end-of-input provider
integration, native-core receipt generator and universal macOS filesystem guard
that were absent from the published 0.4.0 archive. The native implementation
matches reviewed candidate 6; only its bundle version metadata changes here.
Publication and a registry-verified native-core receipt remain separate gates.
