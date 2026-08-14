---
name: open-files-semantic-renamer
description: "Design, review, and apply AI-ready semantic file naming patterns for open-files records. Use when Codewith needs to propose normalized filenames or virtual target paths, rename Google Drive imports, classify files from extracted content, evaluate 2026 agentic/RAG naming conventions, or update open-files metadata while keeping S3 object keys immutable."
---

# Open Files Semantic Renamer

## Core Rule

Rename metadata, not bytes. Canonical S3 keys under `objects/sha256/` must remain immutable. Proposed names belong in review metadata such as `target_path`, `canonical_name`, labels, classification, and audit events.

## Workflow

1. Load the standard.
   - Read `references/agentic-naming-standard.md` before designing patterns.

2. Build evidence.
   - Use metadata first: owner, target path, MIME, modified date, source root, duplicate status.
   - Use `open-files-corpus-reader` for extraction coverage and content summaries.
   - Use `scripts/build_review_manifest.py` to create approval-scoped JSONL work manifests for agents.
   - Use AI to interpret extracted content, not to guess from vague filenames alone.
   - Write bounded AI summaries or semantic metadata to the derived search index with `files search-index add`; do not mutate S3 keys or write SQLite directly.

3. Propose names.
   - Prefer stable, descriptive, lowercase kebab-case.
   - Include date only when it is part of the business meaning.
   - Include entity/project/client/campaign/document kind when useful for retrieval.
   - Keep version/status explicit when materially different: `draft`, `final`, `signed`, `executed`, `v02`.
   - Do not pack every metadata field into the filename; keep rich metadata in DB fields.

4. Validate.
   - Names must be unique within a target folder or receive a deterministic suffix.
   - Names must avoid private data leakage when surfaced in AI citations.
   - Run `scripts/validate_metadata_proposals.py` on proposal JSONL before any apply step.
   - Approved LLM review campaigns should use `--approval-note-file` with a private approval-note JSON artifact; generated plans and reviewer packets must retain only hash attestations, not raw approval text.
   - Run `scripts/collect_llm_review_campaign_results.py` after campaign execution; `rename_correctness_gate` and scale readiness require `runtime_attestation_gate.status == "ok"`.
   - Runtime attestations must cover every executed shard/chunk job exactly once with hash-only source identity, immutable-byte policy, metadata-only write policy, post-execution provider payload-policy proof, and human-review-before-apply validation.
   - Locked worker bundles must verify controlled HOME/TMP, minimal env, no secret env allowlist, no sandbox bypass, command/output/schema confinement, execution-surface attestation, provider-only deny-by-default network egress, and conditional skip-git policy: omit `--skip-git-repo-check` inside Git worktrees; allow it only for non-Git bundle roots with integrity-hash justification.
   - When an adversarial packet includes both a campaign direct-provider host allowlist and a locked-worker bundle, the verifier must require the two host allowlists to match so worker evidence cannot drift from the provider route.
   - Adversarial review packets must verify current source artifact hashes. If any source packet/gate/verification changes, rebuild the adversarial packet and rerun both reviewers so their `input_attestation` packet/schema/prompt hashes match.
   - Low-confidence names remain proposals and require review.

5. Apply only through open-files metadata commands or code paths.
   - Never rename S3 object keys.
   - Never delete duplicate source rows.
   - Preserve original Google Drive path and filename as provenance.

## Output Shape

Use aggregate-safe output by default:

```json
{
  "owner": "finance",
  "target_path": "finance/invoices/2026-05-vendor-invoice-final.pdf",
  "document_kind": "invoice",
  "confidence": "medium",
  "requires_review": true,
  "reason": "Derived from extracted text and existing metadata; no private content quoted."
}
```

## Useful Commands

```bash
python3 .codewith/skills/open-files-semantic-renamer/scripts/build_review_manifest.py --output <private-artifacts/jobs.jsonl> --limit 100
python3 .codewith/skills/open-files-semantic-renamer/scripts/plan_llm_review_campaign.py --manifest <private-artifacts/jobs.jsonl> --output-dir <private-artifacts/campaign>
python3 .codewith/skills/open-files-semantic-renamer/scripts/verify_llm_provider_readiness.py --campaign-plan <private-artifacts/campaign/campaign-plan.json> --provider-inventory <private-artifacts/provider-inventory.json> --output <private-artifacts/campaign/provider-readiness.json>
python3 .codewith/skills/open-files-semantic-renamer/scripts/validate_llm_review_campaign.py --plan <private-artifacts/campaign/campaign-plan.json> --require-sanitized-rows
python3 .codewith/skills/open-files-semantic-renamer/scripts/run_llm_review_campaign.py --plan <private-artifacts/campaign/campaign-plan.json>
python3 .codewith/skills/open-files-semantic-renamer/scripts/collect_llm_review_campaign_results.py --plan <private-artifacts/campaign/campaign-plan.json>
python3 .codewith/skills/open-files-semantic-renamer/scripts/build_locked_worker_bundle.py --manifest <private-artifacts/jobs.jsonl> --output-dir <private-artifacts/locked-worker-bundle>
python3 .codewith/skills/open-files-semantic-renamer/scripts/build_adversarial_review_packet.py --output-dir <private-artifacts/adversarial-review> --search-index-packet <private-artifacts/search-index-approval-packet.json> --search-index-validation <private-artifacts/search-index-plan-validation.json> --search-index-runtime-summary <private-artifacts/search-index-unapproved-execute-summary.json> --duplicate-preserve-attestation <private-artifacts/duplicate-preserve-attestation.json> --stage-dependency-gate <private-artifacts/stage-dependency-gate.json> --stage-dependency-verification <private-artifacts/stage-dependency-verification.json> --llm-campaign-plan <private-artifacts/campaign/campaign-plan.json> --llm-campaign-runtime-summary <private-artifacts/campaign/unapproved-execute-summary.json> --llm-provider-readiness <private-artifacts/campaign/provider-readiness.json> --llm-campaign-results-summary <private-artifacts/campaign/collected-results/campaign-results-summary.json> --extraction-readiness-gate <private-artifacts/extraction-lane-readiness-gate.json> --extraction-readiness-verification <private-artifacts/extraction-lane-readiness-verification.json> --extraction-approval-dashboard <private-artifacts/extraction-approval-dashboard.json> --approval-request-packet <private-artifacts/operator-approvals/approval-request-packet.json> --approval-request-verification <private-artifacts/operator-approvals/approval-request-packet-verification.json>
python3 .codewith/skills/open-files-semantic-renamer/scripts/verify_adversarial_review_packet.py --packet <private-artifacts/adversarial-review/adversarial-review-packet.json> --output <private-artifacts/adversarial-review/adversarial-review-verification.json>
python3 .codewith/skills/open-files-semantic-renamer/scripts/verify_adversarial_review_results.py --reviewer-a <private-artifacts/adversarial-review/reviewer-a-current-result.json> --reviewer-b <private-artifacts/adversarial-review/reviewer-b-current-result.json> --packet <private-artifacts/adversarial-review/adversarial-review-packet.json> --schema <private-artifacts/adversarial-review/reviewer-final.schema.json> --reviewer-a-prompt <private-artifacts/adversarial-review/reviewer-a-prompt.md> --reviewer-b-prompt <private-artifacts/adversarial-review/reviewer-b-prompt.md>
python3 .codewith/skills/open-files-semantic-renamer/scripts/run_llm_review_batch.py --manifest <private-artifacts/jobs.jsonl> --provider spark --limit 1 --chunk-size 1 --prepare-artifacts
python3 .codewith/skills/open-files-semantic-renamer/scripts/validate_metadata_proposals.py <private-artifacts/proposals.jsonl> --errors-output <private-artifacts/proposal-errors.jsonl>
files search-index add <file-id> --kind llm_summary --extractor <agent-or-model> --text-file <private-summary.txt>
files search <query> --scope all --json
```

`plan_llm_review_campaign.py` writes sanitized worker shard manifests by
default. Use `--include-private-worker-fields` only for legacy/debug validation,
never for real worker dispatch.

## References

- `references/agentic-naming-standard.md`: recommended 2026 naming pattern and source rationale.
