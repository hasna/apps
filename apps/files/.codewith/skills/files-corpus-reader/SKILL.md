---
name: files-corpus-reader
description: "Read, extract, classify, and audit large open-files corpora across text, PDF, Office, image, audio, video, archive, raw/design, and unknown MIME types. Use when Codewith needs to inspect migrated Google Drive files, build extraction coverage, decide which tools or AI passes are required, create redacted corpus reports, or prepare semantic classification without exposing private filenames, object keys, or file contents."
---

# Open Files Corpus Reader

## Core Rule

Treat open-files as the source-of-truth byte layer. Read through open-files scheme refs, `files` CLI/MCP, or canonical S3 mappings. Do not paste private filenames, object keys, extracted text, OCR text, transcripts, ACL payloads, or row payloads into user-facing output unless the user explicitly approves that disclosure.

## Workflow

1. Audit coverage first.
   - Run `scripts/mime_coverage_audit.py` from this skill for redacted counts.
   - Run `scripts/build_corpus_map.py --output-dir <private-artifacts/corpus-map>` for the full public aggregate plus private worker map.
   - Run `scripts/provider_inventory.py --include-vault` when provider/key routing matters.
   - Report only MIME/category/count/bytes/owner/status aggregates.
   - Use `files organize stats --json` and `files organize apply-drive-policy --json` to verify metadata state.

2. Choose the extraction lane.
   - Text-like files: use existing `files extract-text` / `files extract-snapshot`.
   - PDF: use `scripts/extract_pdf_text.py` for bounded `pdftotext`, then AI summarize/classify the extracted artifact.
   - Office/OpenDocument: use `scripts/extract_office_text.py` for LibreOffice text conversion plus optional structured block/table sidecar, then AI summarize/classify.
   - Images/scans: use `scripts/extract_image_ocr.py` for bounded OCR artifacts when `tesseract` is available; otherwise write explicit OCR/vision/human-review routing and optional private vision-request artifacts for approved provider passes.
   - Audio/video: require `ffmpeg` plus transcription/keyframe extraction; use metadata-only until available.
   - Archives: use `scripts/archive_inventory.py` first, then recursively classify allowed children.
   - RAW/PSD/design/proprietary binaries: metadata, preview, sidecar, or AI vision if available.

3. Extract bounded artifacts.
   - Limit bytes/pages/duration.
   - Store extracted text/snapshots as derived artifacts, never as the canonical source.
   - Preserve `source_ref`, revision id, checksum, extractor version, and status.
   - Index bounded search text through `files search-index add`; do not write search tables directly.

4. Classify with AI only after extraction.
   - Give the model a small redacted excerpt or summary, not whole private files.
   - Ask for owner, document kind, date, entity, sensitivity, suggested name, confidence, and reason.
   - Mark uncertain results for human review instead of forcing a name.

5. Keep outputs reversible.
   - Do not rename S3 keys.
   - Propose or update metadata fields such as `target_path`, `canonical_name`, labels, classification, and review notes.
   - Keep legacy/import buckets readable until final audit and rollback windows close.

## Approval Notes

For approved plan regeneration, pass private operator approval JSON with
`--approval-note-file`. Do not place raw approval-note text in command lines,
task comments, reviewer packets, or public summaries. Approved planners and
validators should preserve only hash attestations in generated plans.

Search-index, large-file, and LLM campaign runners must pass the plan approval
attestation into `global_execution_preflight.py`. Explicit canary or scale
execution is invalid unless the plan is approved, an approval note is present,
and the approval-note SHA-256 attestation is valid. If the readiness gate is
present but that token is missing or invalid, the aggregate preflight must
return `canary_approval_token_required` or `scale_approval_token_required` with
`allowed=false`; canary caps alone are never sufficient.

Search-index canary and scale runs must also emit post-run CLI search probe
evidence before they can be treated as verified. The probe may use private
query strings stored only in private artifacts, but public summaries must expose
only query/result hashes, counts, latency stats, and whether the expected
indexed file was found through `files search --scope content`. Verifiers and
scale-readiness gates should fail closed if this probe is missing, slow, or
unmatched.

The replacement-readiness verifier recomputes current source artifact
bytes/hashes by default. `operator_approval_blocker_report` and
`adversarial_review_results` are known cyclic sources: the blocker report
consumes replacement verification while the replacement gate consumes the
blocker report, and adversarial results attest to a packet that snapshots the
replacement gate. Treat those labels as allowed cyclic warnings, not freshness
failures, unless running an explicitly strict audit.

Search-index, large-file, and extraction-worker approval packets must carry
source artifact hashes plus `redaction_check`/`approval_packet_checks`; packet
generation should fail closed if sensitive markers appear, even when the source
plan validation is otherwise complete.

Extraction-worker image evidence must also carry no-network Docker runtime
policy proof for `docker run` smoke/inventory commands: network mode `none`, no
provider/S3/Google Drive/DB egress, no corpus mounts, read-only rootfs, dropped
capabilities, no-new-privileges, and hashed command logs only. Treat stale
worker-image verification without that policy as blocked until regenerated.

The extraction tool remediation packet must carry `packet_checks`,
`packet_errors`, source artifact hashes, redaction status, and non-mutation
attestation. Treat it as invalid if required aggregate inputs are missing,
unhashed, or redaction fails.

The operator-approval blocker-report verifier also recomputes current
bytes/hashes for its seven file source artifacts by default, including the
extraction lane readiness verification. It also reruns the live
`todos ready --json` input as aggregate counts by default and compares ready
total, approval, media, non-approval non-media, and Drive/ACL approval counts
without storing task payloads.

The Drive approval queue builder writes the aggregate-only Drive/ACL
organization approval queue. It records ready-todo categories, row-count hints,
approval-prep doc hashes, and non-mutation/redaction attestations without Drive
row payloads, private filenames, ACL payloads, object keys, or source refs.
Verify it with `verify_drive_approval_queue.py`; the verifier recomputes
current approval-prep doc hashes and live ready-todo semantics before the final
operator approval evidence bundle can pass.

Drive approval-note templates are private fill-in artifacts, not approvals.
Build them from the verified Drive approval queue with
`build_drive_approval_note_templates.py`, validate completed private notes with
`validate_drive_approval_notes.py`, and verify packet/summary freshness with
`verify_drive_approval_notes.py`. The summary must expose only decision IDs,
hashes, status, counts, source doc hashes, and aggregate context; approval-note
text, row payloads, ACL payloads, filenames, object keys, and source refs must
stay private.

The stage-dependency verifier recomputes current bytes/hashes for its nine
aggregate source artifacts by default, including Drive approval-note summary
and verification artifacts. When stage or replacement verifiers gain new
critical gates, propagate those gates into the operator blocker report builder
so the safe-next-step report does not hide upstream freshness status.

The operator approval evidence bundle verifier is the final aggregate check for
the approval-safe chain. Run it after dashboard, approval request, stage,
adversarial, replacement, Drive approval queue, Drive approval-note, and
blocker artifacts are refreshed. It reruns the lower-level verifiers
in-process, including approval intake and post-approval command plan/run
freshness checks, allows only the known replacement cyclic warnings, scans all
refreshed aggregate artifacts/prompts/results for sensitive markers, and can
require that the safe next step is operator approval.

The search-index/readiness reconciliation verifier emits source artifact hashes
for the search-index plan and extraction readiness gate, plus a formal
redaction check. Treat reconciliation output as invalid if those source hashes
or redaction gates are missing.

The extraction lane readiness verifier recomputes current source artifact
bytes/hashes and can rebuild the aggregate gate from the corpus map, tool
inventory, smoke summary, optional worker inventory, and deferred media summary.
Run it after `extraction_lane_readiness_gate.py` and before stage, replacement,
adversarial, or final evidence-bundle refreshes.

The operator approval request packet records source artifact hashes for the
extraction approval dashboard and approval-notes summary. Its verifier
recomputes those source bytes/hashes by default, and the blocker report should
forward that freshness gate in approval-request critical evidence.

The extraction approval dashboard must carry `dashboard_checks`,
`dashboard_errors`, `redaction_check`, source artifact hashes, and a
non-mutation attestation. Verify it with
`verify_extraction_approval_dashboard.py` before rebuilding approval templates,
stage gates, replacement gates, adversarial packets, or blocker reports.

The operator approval intake verifier maps validated approval-note status to
the matching ready canary tasks without granting approval or launching work. It
also consumes Drive approval-note summary/verification as a global unlock gate:
canary tasks must stay locked until both extraction/index/LLM approval notes
and Drive organization approval notes are valid. Run it after
`validate_operator_approval_notes.py`, `validate_drive_approval_notes.py`, and
`verify_drive_approval_notes.py` and before any approved canary execution. It
must stay aggregate-only and expose only decision IDs, hash attestations,
counts, tags, and short task IDs.

The post-approval canary command planner consumes approval intake, Drive
approval-note summary/verification, and dashboard command maps, then emits only
command refs, hashes, byte counts, mutation class, and execution ordering. It
never copies raw commands or runs them. Treat `blocked_no_unlocked_decisions`
or `blocked_drive_approval_notes` as expected states until valid operator and
Drive approval notes exist. Verify it with
`verify_post_approval_canary_command_plan.py` before using the command refs for
any approved canary execution.

Post-approval command plans and runner summaries must also carry a current
operator-approval blocker report source artifact plus an aggregate
safe-next-step snapshot. Plan verification and dry-run/execution runners should
fail closed if that blocker report is missing, stale, invalid, or not at the
expected operator-approval step before approvals are granted.

The post-approval canary runner defaults to dry-run and must refuse execution
unless the command plan verifier is `ok`, the plan status is
`ready_for_operator_execution`, current Drive approval notes are approved and
verified, command refs resolve to current dashboard commands, and hashes match.
Raw commands and command logs must stay out of public summaries; execution logs
belong under private artifacts only. Verify the run summary with
`verify_post_approval_canary_command_run.py`.

When approval, stage, replacement, or adversarial packet sources change,
regenerate the adversarial review packet and rerun both reviewer agents. The
adversarial packet verifier recomputes current source hashes; reviewer results
must carry matching packet/schema/prompt input attestations before replacement
readiness can treat the adversarial review as fresh.

## Useful Commands

```bash
python3 .codewith/skills/files-corpus-reader/scripts/mime_coverage_audit.py
python3 .codewith/skills/files-corpus-reader/scripts/provider_inventory.py --include-vault
python3 .codewith/skills/files-corpus-reader/scripts/extraction_tool_inventory.py
python3 .codewith/skills/files-corpus-reader/scripts/build_extraction_tool_remediation_packet.py --tool-inventory <private-artifacts/extraction-tool-inventory.json> --lane-readiness-gate <private-artifacts/extraction-lane-readiness-gate.json> --worker-approval-packet <private-artifacts/extraction-worker-image-approval-packet.json> --output <private-artifacts/extraction-tool-remediation-packet.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_extraction_worker_image.py --output <private-artifacts/extraction-worker-image-verification.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_extraction_worker_image_approval_packet.py --verification <private-artifacts/extraction-worker-image-verification.json> --output <private-artifacts/extraction-worker-image-approval-packet.json>
python3 .codewith/skills/files-corpus-reader/scripts/validate_operator_approval_notes.py --notes-dir <private-artifacts/operator-approvals> --approval-request-packet <private-artifacts/operator-approvals/approval-request-packet.json> --output <private-artifacts/operator-approvals/approval-notes-summary.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_operator_approval_intake.py --approval-notes-summary <private-artifacts/operator-approvals/approval-notes-summary.json> --approval-request-packet <private-artifacts/operator-approvals/approval-request-packet.json> --approval-request-verification <private-artifacts/operator-approvals/approval-request-packet-verification.json> --drive-approval-notes-summary <private-artifacts/drive-approval/drive-approval-notes-summary.json> --drive-approval-notes-verification <private-artifacts/drive-approval/drive-approval-notes-verification.json> --dashboard <private-artifacts/extraction-approval-dashboard.json> --blocker-report <private-artifacts/operator-approval-blocker-report.json> --output <private-artifacts/operator-approvals/approval-intake-readiness.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_post_approval_canary_command_plan.py --intake <private-artifacts/operator-approvals/approval-intake-readiness.json> --dashboard <private-artifacts/extraction-approval-dashboard.json> --drive-approval-notes-summary <private-artifacts/drive-approval/drive-approval-notes-summary.json> --drive-approval-notes-verification <private-artifacts/drive-approval/drive-approval-notes-verification.json> --operator-approval-blocker-report <private-artifacts/operator-approval-blocker-report.json> --output <private-artifacts/operator-approvals/post-approval-canary-command-plan.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_post_approval_canary_command_plan.py --plan <private-artifacts/operator-approvals/post-approval-canary-command-plan.json> --intake <private-artifacts/operator-approvals/approval-intake-readiness.json> --dashboard <private-artifacts/extraction-approval-dashboard.json> --drive-approval-notes-summary <private-artifacts/drive-approval/drive-approval-notes-summary.json> --drive-approval-notes-verification <private-artifacts/drive-approval/drive-approval-notes-verification.json> --operator-approval-blocker-report <private-artifacts/operator-approval-blocker-report.json> --output <private-artifacts/operator-approvals/post-approval-canary-command-plan-verification.json>
python3 .codewith/skills/files-corpus-reader/scripts/run_post_approval_canary_command_plan.py --plan <private-artifacts/operator-approvals/post-approval-canary-command-plan.json> --plan-verification <private-artifacts/operator-approvals/post-approval-canary-command-plan-verification.json> --dashboard <private-artifacts/extraction-approval-dashboard.json> --drive-approval-notes-summary <private-artifacts/drive-approval/drive-approval-notes-summary.json> --drive-approval-notes-verification <private-artifacts/drive-approval/drive-approval-notes-verification.json> --operator-approval-blocker-report <private-artifacts/operator-approval-blocker-report.json> --output <private-artifacts/operator-approvals/post-approval-canary-command-run-summary.json> --log-dir <private-artifacts/operator-approvals/post-approval-canary-command-logs>
python3 .codewith/skills/files-corpus-reader/scripts/verify_post_approval_canary_command_run.py --run-summary <private-artifacts/operator-approvals/post-approval-canary-command-run-summary.json> --plan <private-artifacts/operator-approvals/post-approval-canary-command-plan.json> --plan-verification <private-artifacts/operator-approvals/post-approval-canary-command-plan-verification.json> --dashboard <private-artifacts/extraction-approval-dashboard.json> --drive-approval-notes-summary <private-artifacts/drive-approval/drive-approval-notes-summary.json> --drive-approval-notes-verification <private-artifacts/drive-approval/drive-approval-notes-verification.json> --operator-approval-blocker-report <private-artifacts/operator-approval-blocker-report.json> --output <private-artifacts/operator-approvals/post-approval-canary-command-run-verification.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_operator_approval_note_templates.py --dashboard <private-artifacts/extraction-approval-dashboard.json> --approval-notes-summary <private-artifacts/operator-approvals/approval-notes-summary.json> --output-dir <private-artifacts/operator-approvals/templates> --packet-output <private-artifacts/operator-approvals/approval-request-packet.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_operator_approval_request_packet.py --packet <private-artifacts/operator-approvals/approval-request-packet.json> --output <private-artifacts/operator-approvals/approval-request-packet-verification.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_extraction_approval_dashboard.py --output <private-artifacts/extraction-approval-dashboard.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_extraction_approval_dashboard.py --dashboard <private-artifacts/extraction-approval-dashboard.json> --output <private-artifacts/extraction-approval-dashboard-verification.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_drive_approval_queue.py --output <private-artifacts/drive-approval/drive-approval-queue.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_drive_approval_queue.py --queue <private-artifacts/drive-approval/drive-approval-queue.json> --output <private-artifacts/drive-approval/drive-approval-queue-verification.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_drive_approval_note_templates.py --queue <private-artifacts/drive-approval/drive-approval-queue.json> --queue-verification <private-artifacts/drive-approval/drive-approval-queue-verification.json> --output-dir <private-artifacts/drive-approval/templates> --packet-output <private-artifacts/drive-approval/drive-approval-request-packet.json>
python3 .codewith/skills/files-corpus-reader/scripts/validate_drive_approval_notes.py --notes-dir <private-artifacts/drive-approval> --drive-request-packet <private-artifacts/drive-approval/drive-approval-request-packet.json> --output <private-artifacts/drive-approval/drive-approval-notes-summary.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_drive_approval_notes.py --packet <private-artifacts/drive-approval/drive-approval-request-packet.json> --notes-summary <private-artifacts/drive-approval/drive-approval-notes-summary.json> --output <private-artifacts/drive-approval/drive-approval-notes-verification.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_operator_approval_blocker_report.py --dashboard <private-artifacts/extraction-approval-dashboard.json> --adversarial-verification <private-artifacts/adversarial-review/adversarial-review-verification.json> --approval-request-packet <private-artifacts/operator-approvals/approval-request-packet.json> --approval-request-verification <private-artifacts/operator-approvals/approval-request-packet-verification.json> --stage-verification <private-artifacts/stage-dependency-verification.json> --replacement-verification <private-artifacts/replacement-readiness-verification.json> --extraction-readiness-verification <private-artifacts/extraction-lane-readiness-verification.json> --output <private-artifacts/operator-approval-blocker-report.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_operator_approval_blocker_report.py --report <private-artifacts/operator-approval-blocker-report.json> --output <private-artifacts/operator-approval-blocker-report-verification.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_operator_approval_evidence_bundle.py --output <private-artifacts/operator-approval-evidence-bundle-verification.json> --require-operator-approval-required
python3 .codewith/skills/files-corpus-reader/scripts/build_corpus_map.py --output-dir <private-artifacts/corpus-map>
python3 .codewith/skills/files-corpus-reader/scripts/extraction_smoke_matrix.py --limit-per-lane-bucket 1 --files-command 'bun run src/cli/index.tsx'
python3 .codewith/skills/files-corpus-reader/scripts/extraction_lane_readiness_gate.py --corpus-map <private-artifacts/corpus-map/corpus-map-public.json> --tool-inventory <private-artifacts/extraction-tool-inventory.json> --smoke-summary <private-artifacts/extraction-smoke-summary.json>
python3 .codewith/skills/files-corpus-reader/scripts/extraction_lane_readiness_gate.py --corpus-map <private-artifacts/corpus-map/corpus-map-public.json> --tool-inventory <private-artifacts/extraction-tool-inventory.json> --worker-tool-inventory <private-artifacts/extraction-worker-tool-inventory.json> --smoke-summary <private-artifacts/extraction-smoke-summary.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_extraction_lane_readiness_gate.py --gate <private-artifacts/extraction-lane-readiness-gate.json> --corpus-map <private-artifacts/corpus-map/corpus-map-public.json> --tool-inventory <private-artifacts/extraction-tool-inventory.json> --worker-tool-inventory <private-artifacts/extraction-worker-tool-inventory.json> --smoke-summary <private-artifacts/extraction-smoke-summary.json> --deferred-media-summary <private-artifacts/deferred-media-completion-summary.json> --output <private-artifacts/extraction-lane-readiness-verification.json>
python3 .codewith/skills/files-corpus-reader/scripts/plan_search_index_population.py --output-dir <private-artifacts/search-index-plan>
python3 .codewith/skills/files-corpus-reader/scripts/plan_search_index_population.py --output-dir <private-artifacts/search-index-nonmedia-plan> --exclude-lanes needs_transcription,needs_video_pipeline
python3 .codewith/skills/files-corpus-reader/scripts/validate_search_index_population_plan.py --plan <private-artifacts/search-index-plan/search-index-population-plan.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_search_index_approval_packet.py --plan <private-artifacts/search-index-plan/search-index-population-plan.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_search_index_readiness_reconciliation.py --plan <private-artifacts/search-index-plan/search-index-population-plan.json> --readiness-gate <private-artifacts/extraction-lane-readiness-gate.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_duplicate_preserve_attestation.py --plan <private-artifacts/search-index-plan/search-index-population-plan.json> --db <files.db> --output <private-artifacts/search-index-plan/duplicate-preserve-attestation.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_stage_dependency_gate.py --extraction-readiness-gate <private-artifacts/extraction-lane-readiness-gate.json> --extraction-readiness-verification <private-artifacts/extraction-lane-readiness-verification.json> --deferred-media-summary <private-artifacts/deferred-media-completion-summary.json> --search-index-runtime-summary <private-artifacts/search-index-unapproved-execute-summary.json> --llm-provider-readiness <private-artifacts/campaign/provider-readiness.json> --llm-campaign-results-summary <private-artifacts/campaign-results-summary.json> --duplicate-preserve-attestation <private-artifacts/duplicate-preserve-attestation.json> --extraction-approval-dashboard <private-artifacts/extraction-approval-dashboard.json> --drive-approval-notes-summary <private-artifacts/drive-approval/drive-approval-notes-summary.json> --drive-approval-notes-verification <private-artifacts/drive-approval/drive-approval-notes-verification.json> --output <private-artifacts/stage-dependency-gate.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_stage_dependency_gate.py --gate <private-artifacts/stage-dependency-gate.json> --output <private-artifacts/stage-dependency-verification.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_replacement_readiness_gate.py --stage-dependency-gate <private-artifacts/stage-dependency-gate.json> --extraction-readiness-gate <private-artifacts/extraction-lane-readiness-gate.json> --extraction-readiness-verification <private-artifacts/extraction-lane-readiness-verification.json> --deferred-media-summary <private-artifacts/deferred-media-completion-summary.json> --extraction-approval-dashboard <private-artifacts/extraction-approval-dashboard.json> --approval-notes-summary <private-artifacts/operator-approvals/approval-notes-summary.json> --drive-approval-notes-summary <private-artifacts/drive-approval/drive-approval-notes-summary.json> --drive-approval-notes-verification <private-artifacts/drive-approval/drive-approval-notes-verification.json> --operator-approval-blocker-report <private-artifacts/operator-approval-blocker-report.json> --search-index-runtime-summary <private-artifacts/search-index-unapproved-execute-summary.json> --llm-campaign-results-summary <private-artifacts/campaign-results-summary.json> --adversarial-review-results <private-artifacts/adversarial-review/adversarial-review-results-verification.json> --output <private-artifacts/replacement-readiness-gate.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_replacement_readiness_gate.py --gate <private-artifacts/replacement-readiness-gate.json> --output <private-artifacts/replacement-readiness-verification.json>
python3 .codewith/skills/files-corpus-reader/scripts/run_search_index_population_plan.py --plan <private-artifacts/search-index-plan/search-index-population-plan.json> --files-command 'bun run src/cli/index.tsx'
python3 .codewith/skills/files-corpus-reader/scripts/verify_search_index_population_run.py --plan <private-artifacts/search-index-plan/search-index-population-plan.json> --run-dir <private-artifacts/search-index-plan/search-index-run>
python3 .codewith/skills/files-corpus-reader/scripts/plan_large_file_extraction.py --output-dir <private-artifacts/large-files>
python3 .codewith/skills/files-corpus-reader/scripts/validate_large_file_extraction_plan.py --plan <private-artifacts/large-files/large-file-extraction-plan.json>
python3 .codewith/skills/files-corpus-reader/scripts/build_large_file_approval_packet.py --plan <private-artifacts/large-files/large-file-extraction-plan.json>
python3 .codewith/skills/files-corpus-reader/scripts/run_large_file_extraction_plan.py --plan <private-artifacts/large-files/large-file-extraction-plan.json>
python3 .codewith/skills/files-corpus-reader/scripts/verify_large_file_extraction_run.py --plan <private-artifacts/large-files/large-file-extraction-plan.json> --run-dir <private-artifacts/large-files/large-file-run>
python3 .codewith/skills/files-corpus-reader/scripts/collect_large_file_review_manifest.py --run-dir <private-artifacts/large-files/large-file-run> --output <private-artifacts/large-files/review-jobs.jsonl>
python3 .codewith/skills/files-corpus-reader/scripts/extract_artifact_for_file.py <file-id> --artifact-dir <private-artifacts/run>
python3 .codewith/skills/files-corpus-reader/scripts/extract_pdf_text.py <local.pdf> --output <private-artifacts/file.txt> --max-pages 20
python3 .codewith/skills/files-corpus-reader/scripts/extract_office_text.py <local.docx> --output <private-artifacts/file.txt> --structured-output <private-artifacts/file.office.structured.json>
python3 .codewith/skills/files-corpus-reader/scripts/extract_image_ocr.py <local-image> --output <private-artifacts/image-ocr.json> --vision-request-output <private-artifacts/image-vision-request.json>
python3 .codewith/skills/files-corpus-reader/scripts/archive_inventory.py <local.zip> --output <private-artifacts/archive.json>
python3 .codewith/skills/files-corpus-reader/scripts/inspect_file_metadata.py <local-file> --kind image --output <private-artifacts/metadata.json>
files organize stats --json
files organize apply-drive-policy --json
files extract-text <file-id> --json
files extract-snapshot <file-id> --json
files search-index add <file-id> --kind extraction_summary --extractor <name> --text-file <private-artifact.txt>
files search-index stats --json
files search <query> --scope content --json
```

## References

- `references/extractor-matrix.md`: extraction lanes, required tools, and fallback behavior.
