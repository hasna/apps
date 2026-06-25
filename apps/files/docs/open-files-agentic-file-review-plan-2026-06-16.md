# Open Files Agentic File Review Plan - 2026-06-16

## Scope

Build repo-local Codewith skills and use them to prepare the next phase of the
Google Drive replacement: content-aware classification and semantic renaming.
This phase must preserve canonical S3 object immutability and avoid exposing
private filenames, paths, object keys, extracted text, transcripts, ACL payloads,
or secret values in shared output.

End state: every active file is mapped, read/extracted or explicitly classified
as requiring OCR/transcription/human review, semantically renamed with logical
agent-friendly canonical names and target paths independent of old Google Drive
structure, indexed into fast searchable files CLI surfaces, and audited by
tests plus adversarial reviews.

## Skills Added

```txt
.codewith/skills/open-files-corpus-reader
.codewith/skills/open-files-semantic-renamer
.codewith/skills/open-files-migration-operator
```

Use `open-files-corpus-reader` to audit MIME coverage and choose extraction
lanes. Use `open-files-semantic-renamer` to propose 2026-ready AI/RAG-friendly
virtual names and target paths. Use `open-files-migration-operator` to preserve
the migration guardrails and verify current metadata state.

## Helper Scripts Added

Corpus reader:

```txt
.codewith/skills/open-files-corpus-reader/scripts/mime_coverage_audit.py
.codewith/skills/open-files-corpus-reader/scripts/provider_inventory.py
.codewith/skills/open-files-corpus-reader/scripts/lane_resolver.py
.codewith/skills/open-files-corpus-reader/scripts/extract_pdf_text.py
.codewith/skills/open-files-corpus-reader/scripts/extract_office_text.py
.codewith/skills/open-files-corpus-reader/scripts/archive_inventory.py
.codewith/skills/open-files-corpus-reader/scripts/extract_artifact_for_file.py
.codewith/skills/open-files-corpus-reader/scripts/build_corpus_map.py
.codewith/skills/open-files-corpus-reader/scripts/extraction_smoke_matrix.py
.codewith/skills/open-files-corpus-reader/scripts/extraction_tool_inventory.py
.codewith/skills/open-files-corpus-reader/scripts/extraction_lane_readiness_gate.py
.codewith/skills/open-files-corpus-reader/scripts/build_extraction_tool_remediation_packet.py
.codewith/skills/open-files-corpus-reader/scripts/inspect_file_metadata.py
.codewith/skills/open-files-corpus-reader/scripts/verify_extraction_worker_image.py
.codewith/skills/open-files-corpus-reader/scripts/build_extraction_worker_image_approval_packet.py
.codewith/skills/open-files-corpus-reader/scripts/build_extraction_approval_dashboard.py
.codewith/skills/open-files-corpus-reader/scripts/build_operator_approval_blocker_report.py
.codewith/skills/open-files-corpus-reader/scripts/verify_operator_approval_blocker_report.py
.codewith/skills/open-files-corpus-reader/scripts/build_drive_approval_queue.py
.codewith/skills/open-files-corpus-reader/scripts/verify_drive_approval_queue.py
.codewith/skills/open-files-corpus-reader/scripts/build_drive_approval_note_templates.py
.codewith/skills/open-files-corpus-reader/scripts/validate_drive_approval_notes.py
.codewith/skills/open-files-corpus-reader/scripts/verify_drive_approval_notes.py
.codewith/skills/open-files-corpus-reader/scripts/verify_operator_approval_request_packet.py
.codewith/skills/open-files-corpus-reader/scripts/plan_search_index_population.py
.codewith/skills/open-files-corpus-reader/scripts/validate_search_index_population_plan.py
.codewith/skills/open-files-corpus-reader/scripts/run_search_index_population_plan.py
.codewith/skills/open-files-corpus-reader/scripts/build_search_index_approval_packet.py
.codewith/skills/open-files-corpus-reader/scripts/verify_search_index_population_run.py
.codewith/skills/open-files-corpus-reader/scripts/verify_search_index_readiness_reconciliation.py
.codewith/skills/open-files-corpus-reader/scripts/deferred_media_completion_audit.py
.codewith/skills/open-files-corpus-reader/scripts/build_stage_dependency_gate.py
.codewith/skills/open-files-corpus-reader/scripts/verify_stage_dependency_gate.py
.codewith/skills/open-files-corpus-reader/scripts/build_replacement_readiness_gate.py
.codewith/skills/open-files-corpus-reader/scripts/verify_replacement_readiness_gate.py
.codewith/skills/open-files-corpus-reader/worker-image/Dockerfile
.codewith/skills/open-files-corpus-reader/worker-image/smoke-archive-tools.sh
```

Semantic renamer:

```txt
.codewith/skills/open-files-semantic-renamer/scripts/build_review_manifest.py
.codewith/skills/open-files-semantic-renamer/scripts/plan_llm_review_campaign.py
.codewith/skills/open-files-semantic-renamer/scripts/verify_llm_provider_readiness.py
.codewith/skills/open-files-semantic-renamer/scripts/validate_metadata_proposals.py
.codewith/skills/open-files-semantic-renamer/scripts/run_llm_review_batch.py
.codewith/skills/open-files-semantic-renamer/scripts/build_locked_worker_bundle.py
.codewith/skills/open-files-semantic-renamer/scripts/build_adversarial_review_packet.py
.codewith/skills/open-files-semantic-renamer/scripts/verify_adversarial_review_packet.py
.codewith/skills/open-files-semantic-renamer/scripts/verify_adversarial_review_results.py
.codewith/skills/open-files-semantic-renamer/schemas/worker-final.schema.json
```

The extraction scripts keep stdout to status/count JSON. Extracted text or
archive inventories are written only to explicit local artifact paths.

## Current Coverage Audit

Command:

```bash
python3 .codewith/skills/open-files-corpus-reader/scripts/mime_coverage_audit.py --top 20
```

Aggregate result:

```txt
total files: 18,212
total bytes: 132,917,143,313

needs_ocr_or_vision: 6,151 files / 15,769,814,938 bytes
needs_pdf_extractor: 5,986 files / 5,561,155,741 bytes
needs_office_extractor: 2,657 files / 793,567,676 bytes
readable_now_text: 1,334 files / 530,180,943 bytes
needs_video_pipeline: 956 files / 65,028,840,633 bytes
needs_design_raw_pipeline: 816 files / 26,916,469,493 bytes
metadata_only_or_unknown: 191 files / 4,553,293,760 bytes
needs_archive_inventory: 67 files / 11,956,041,310 bytes
needs_transcription: 54 files / 1,807,778,819 bytes
```

Available local tools on 2026-06-16:

```txt
pdftotext
libreoffice / soffice
unzip
file
python3
node
bun
```

Missing tools for full coverage:

```txt
tesseract
ffmpeg
exiftool
ImageMagick (`magick` / `convert`)
pandoc
7zz / 7z / 7za
unrar / bsdtar
```

## Provider And Codewith Status

Redacted provider inventory found usable local/vault paths for OpenAI,
Anthropic, Cerebras, ElevenLabs, OpenRouter, xAI, Groq, Gemini, and Alibaba.
The process environment contains several provider env vars, but some exported
values do not match the expected provider key prefix. In particular, OpenRouter
works from the local `secrets` vault key, not from the currently exported
Hasna alias.

Codewith exec smoke tests run on 2026-06-16:

```txt
default OpenAI API-key auth: failed, invalid API key
--auth-profile account001: passed
--auth-profile account001 --model gpt-5.4-mini: passed
--profile openrouter with vault key injected: passed
```

OpenRouter profile created at:

```txt
~/.codewith/openrouter.config.toml
```

Use this shape for future OpenRouter agent dispatch:

```bash
key=$(secrets get hasna/takumi/live/openrouter_api_key)
OPENROUTER_API_KEY="$key" \
OPENROUTER_AUTH_HEADER="Bearer $key" \
codewith exec --profile openrouter --sandbox read-only -C /home/hasna/workspace/hasna/opensource/open-files "<prompt>"
```

No file-review agents were launched during setup.

Xiaomi/Mimo status:

```txt
direct local Xiaomi/Mimo key: not found in env or secrets
OpenRouter models found: xiaomi/mimo-v2.5-pro, xiaomi/mimo-v2.5, xiaomi/mimo-v2-flash
Codewith exec smoke: passed with --profile openrouter -m xiaomi/mimo-v2.5-pro
Codewith tool-worker contract: rejected; worker reported zero jobs and wrote no proposals
Direct OpenRouter API runner: passed one-file validated canary with xiaomi/mimo-v2.5-pro
```

Verified Mimo command shape:

```bash
key=$(secrets get hasna/takumi/live/openrouter_api_key)
OPENROUTER_API_KEY="$key" \
OPENROUTER_AUTH_HEADER="Bearer $key" \
codewith exec --profile openrouter --disable image_generation \
  -m xiaomi/mimo-v2.5-pro \
  --sandbox read-only \
  "Reply exactly: mimo-ok"
```

Use Mimo through `run_llm_review_batch.py --provider mimo --execution-mode
direct-api`, not through nested Codewith tool-worker mode, until the tool-worker
contract is fixed. The direct runner uses the OpenRouter secret from the local
vault, sends only prepared bounded review artifacts, writes proposal/error JSONL
from the parent process, denies provider data collection by default, and uses
`provider_sort=throughput` for Nitro/UltraSpeed-style routing.

`verify_llm_provider_readiness.py` now checks an LLM campaign plan against the
redacted provider inventory before approval. Current sanitized one-job campaign
readiness is `ok`: provider data collection is denied, raw bytes/extracts/real
file IDs/secrets are not sent, schedule caps are valid, and no provider calls or
corpus/S3/DB mutations were made by the check. `build_adversarial_review_packet.py`
now includes that readiness artifact so reviewers must evaluate provider
availability, privacy policy, schedule caps, non-mutation, and redaction gates
before any scale decision.

## Naming Pattern

Use this virtual path pattern:

```txt
{owner}/{domain-or-project}/{yyyy-mm-dd?}-{entity?}-{subject}-{document-kind}-{status?}-v{nn?}.{ext}
```

Rules:

- lowercase kebab-case;
- ASCII letters, digits, and hyphens inside generated segments;
- ISO date only when the date is business-meaningful;
- entity/project/client/campaign/document kind where useful for retrieval;
- status/version only when real evidence supports it;
- original Google Drive name/path retained as provenance;
- sensitive specifics kept in metadata when a citation-visible filename would
  leak private data.

## Source Rationale

Online guidance checked on 2026-06-16:

- OpenAI File Search supports metadata filtering, so names should complement
  structured metadata rather than replace it.
- Microsoft Azure AI Search RAG guidance emphasizes chunking and retrieval of
  the best document portions; names help provenance/citation but are not the
  only retrieval surface.
- AWS Bedrock Knowledge Bases guidance uses metadata filtering for scalable
  access control and tenancy boundaries.
- NIST RDaF treats metadata and provenance as essential for reuse and
  preservation.
- Harvard file naming guidance recommends identifying relevant metadata,
  applying conventions by file set, and keeping versioning explicit.
- C2PA/Content Credentials guidance reinforces provenance metadata for media
  authenticity.

The full reference list is in:

```txt
.codewith/skills/open-files-semantic-renamer/references/agentic-naming-standard.md
```

## Execution Order

1. Keep the unified Drive metadata policy idempotent:

   ```bash
   files organize apply-drive-policy --json
   ```

   Expected: `planned_updates: 0`.

2. Build a metadata-only review manifest:

   ```bash
   python3 .codewith/skills/open-files-semantic-renamer/scripts/build_review_manifest.py \
     --output .codewith/private-artifacts/review-jobs.jsonl \
     --limit 100
   ```

   Keep `--include-private-metadata` off unless a trusted local agent run
   explicitly needs filenames/paths.

3. Implement and use extractors in highest-value order:

   ```txt
   PDF -> Office -> text/SVG snapshots -> archive inventory -> images/OCR/vision -> audio/video -> raw/design
   ```

4. Start semantic review with the smallest/highest-risk lanes:

   ```txt
   intake: 119
   personal-review: 211
   archive: 1,320
   legal
   finance
   people
   ```

5. Produce rename proposals first as JSONL:

   ```json
   {
     "source_private_id_hash": "hash-only-private-id-reference",
     "canonical_name": "2026-05-vendor-invoice-final.pdf",
     "target_path": "finance/invoices/2026-05-vendor-invoice-final.pdf",
     "document_kind": "invoice",
     "confidence": "medium",
     "requires_review": true
   }
   ```

6. Validate proposals before apply:

   ```bash
   python3 .codewith/skills/open-files-semantic-renamer/scripts/validate_metadata_proposals.py \
     .codewith/private-artifacts/proposals.jsonl \
     --errors-output .codewith/private-artifacts/proposal-errors.jsonl
   ```

7. Apply reviewed metadata updates only through open-files metadata paths.

8. Sync to canonical Postgres/RDS only after the production DB path is approved.

9. Do not retire legacy buckets until final object-resolution, download,
   rollback, and user-approval gates pass.

## Approval Gate

The todos plan `open-files agentic file review setup` leaves
`Approval gate before launching file-review agents` pending. Do not dispatch
agents over real manifests, read extracted content, or apply proposal metadata
until that task is explicitly approved.

## Pilot Result - 2026-06-16

One-account Spark pilot:

```txt
account/profile: account001
model: gpt-5.3-codex-spark
jobs: 5 text-lane records
proposal rows: 5
validation: passed
validation errors: 0
metadata/S3 mutations: 0
```

Legacy Spark bypass invocation observed during the first pilot:

```bash
codewith exec \
  --auth-profile account001 \
  --disable image_generation \
  -m gpt-5.3-codex-spark \
  --dangerously-bypass-approvals-and-sandbox \
  -C /home/hasna/workspace/hasna/opensource/open-files \
  -o .codewith/private-artifacts/pilot-worker-final.txt \
  - < .codewith/private-artifacts/pilot-worker-prompt.md
```

This shape is retained only as historical evidence. Current worker dispatch must
use the locked bundle path and must not rely on sandbox bypass for new scale-up
runs.

Operational lessons:

- `gpt-5.3-codex-spark` is text-only; disable `image_generation`.
- Nested Codewith sandbox shell execution failed with `bwrap: loopback:
  Failed RTM_NEWADDR: Operation not permitted`; the pilot succeeded only after
  bypassing the nested sandbox.
- Future worker prompts must not stream extracted content to stdout. Capture
  extraction JSON in temp files, summarize privately, and write only proposal
  JSONL artifacts.
- Independent local audit confirmed the five proposal rows match the extracted
  evidence at the document-kind/date-window level. One larger CSV produced
  invalid/truncated JSON at `--max-bytes 32768` and `65536`; use a lower cap
  such as `16384` or an artifact-based extraction path before scaling.
- Do not scale to the full account pool until the runner enforces per-worker
  output redaction, bounded job counts, account/profile assignment, and retry
  accounting.

## Runner Hardening - 2026-06-16

Batch runner:

```bash
python3 .codewith/skills/open-files-semantic-renamer/scripts/run_llm_review_batch.py \
  --manifest .codewith/private-artifacts/review-jobs-smoke.jsonl \
  --provider spark \
  --limit 1 \
  --chunk-size 1 \
  --execute \
  --allow-bypass-sandbox
```

Status:

```txt
Spark / gpt-5.3-codex-spark / account001:
  one-job runner execution: accepted
  final aggregate: jobs_seen=1, proposals_written=1, errors=0
  proposal validation: passed
  per-file artifact runner prompt: accepted
  artifact-runner proposal validation: passed inside the runner

Mimo / xiaomi/mimo-v2.5-pro via OpenRouter:
  one-job runner execution: rejected by runner validation
  final aggregate: jobs_seen=0, proposals_written=0
  proposal validation: impossible because no proposal file was written
  decision: do not use nested Codewith tool-worker mode for file review scale

Strict Spark canary after adversarial hardening:
  default manifest: no source_ref, filenames, paths, target_path, ACL fields, or labels
  manifest extension contract: expected_ext present
  runner validation: exact scheduled file_id coverage across proposals/errors
  proposal validation: manifest-aware strict schema
  per-file artifact: content_ready/artifact_ready split plus provenance sidecar
  review artifact: bounded redacted JSON; raw artifact path hidden by default
  one-job execution: accepted
  final aggregate: jobs_seen=1, proposals_written=1, errors=0
  proposal validation: passed

Pre-extracted Spark canary:
  runner pre-extraction: accepted
  worker manifest: contains review_artifact/readiness fields only
  worker-visible review directory: contains no raw snapshot artifacts
  raw extraction directory: separate from worker review directory
  final aggregate: jobs_seen=1, proposals_written=1, errors=0
  proposal validation: passed

Direct Mimo/OpenRouter canary:
  execution mode: direct-api
  model: xiaomi/mimo-v2.5-pro
  provider routing: throughput
  provider data collection: deny
  runner pre-extraction: accepted
  final aggregate: jobs_seen=1, proposals_written=1, errors=0
  proposal validation: passed

Direct Mimo/OpenRouter mixed-lane canary:
  lanes: text, pdf, office, image_ocr_or_vision, audio_transcription,
    video_transcription_keyframes, archive_inventory,
    design_raw_metadata_preview, metadata_only_or_unknown
  chunks: 3
  jobs_seen: 9
  proposals_written: 8
  explicit error rows: 1
  error lane/status: video_transcription_keyframes / skipped_size
  runner validation files: 0
  proposal validation error lines: 0

Spark high-reasoning command dry-run:
  model: gpt-5.3-codex-spark
  auth profile: account001
  reasoning: model_reasoning_effort="high"
  command generation: accepted
```

The runner now rejects schema-shaped but incomplete worker outputs by checking
that `jobs_seen`, proposal lines, and error lines match the scheduled chunk.
This prevents a provider from being added to the scaling pool just because it
returned valid aggregate JSON. Executed chunks also run
`validate_metadata_proposals.py` automatically with the chunk manifest when
proposal rows exist. Worker environments are reduced to a small allowlist before
execution; OpenRouter-compatible runs receive only the OpenRouter credential
they need.

The runner now calls `extract_artifact_for_file.py` before LLM dispatch. It
writes raw extractor artifacts to a private raw artifact directory, copies only
bounded `review_artifact` JSON into a worker-visible review directory, and
writes a prepared worker manifest with review-artifact/status fields. Worker
prompts no longer contain extractor commands. The per-file extractor separates
`artifact_ready` from `content_ready`; metadata-only outputs are not treated as
content-ready and must stay low-confidence/review-required until OCR, vision,
transcription, or a richer extractor exists. It also hides the raw extraction
artifact path from stdout unless `--include-raw-artifact-path` is explicitly set.

The runner also supports `--execution-mode direct-api` for OpenRouter-backed
providers. In that mode the parent process calls the provider API, sends only
prepared review artifacts, writes proposal/error JSONL itself, then runs the
same strict validation. Use this path for Mimo canaries and low-cost provider
pooling. Keep `--allow-provider-data-collection` off unless explicitly approved.
Direct API chunks now retry transient provider/API failures and write a
`chunk-*.direct-api-audit.json` file with attempts plus provider usage/cost
fields when returned. The audit omits manifest rows, review artifacts, file IDs,
proposal rows, and secrets.
Direct API execution also supports `--direct-max-run-cost-usd` and
`--direct-chunk-delay-seconds` for basic cost/rate guardrails. The cost guard
checks cumulative provider-reported usage after each validated chunk and writes
`chunk-*.direct-api-cost-guard.json` before stopping if the configured maximum
is exceeded.
The runner also supports resumable staged execution with `--state-file`,
`--resume`, `--max-chunks`, `--stop-after-seconds`, and `--max-error-rows`.
The checkpoint file records completed chunk numbers, aggregate proposal/error
counts, provider usage totals, output paths, and stop reasons. It omits manifest
rows, review artifacts, file IDs, proposal rows, object keys, source refs, and
secrets.

Offline direct API runner regressions were added at:

```txt
.codewith/skills/open-files-semantic-renamer/tests/test_run_llm_review_batch.py
```

They cover JSON parsing, private manifest field filtering, JSON-schema fallback,
transient retries, redacted audit output, and proposal/error/final output
writing, usage aggregation, and checkpoint state tracking without live provider
calls.

One-file direct API cost-guard smoke:

```txt
model: xiaomi/mimo-v2.5-pro
provider routing: throughput
provider data collection: deny
max run cost: 1.0 USD
final aggregate: jobs_seen=1, proposals_written=1, errors=0
reported usage: 2,954 tokens / 0.00623106 USD
cost guard stop file: absent
proposal validation errors: 0
```

Two-chunk staged/resume canary:

```txt
model: xiaomi/mimo-v2.5-pro
first invocation: --max-chunks 1, status=partial, stop_reason=max_chunks
second invocation: --resume, skipped_chunks=[1], processed_chunks=1
final state: completed
completed_chunks: [1, 2]
proposal rows: 2
error rows: 0
runner validation files: 0
proposal validation error lines: 0
reported usage: 6,198 tokens / 0.01339668 USD
state privacy check: no file_id literals, object keys, or source refs
```

Approval-gated campaign planner:

```txt
script: .codewith/skills/open-files-semantic-renamer/scripts/plan_llm_review_campaign.py
input: private review manifest JSONL
output: campaign-plan.json plus private shard manifests
execution: planner only; it does not call providers
approval gate: generated commands omit --execute unless --approved and
  --approval-note are provided
redaction: plan omits manifest rows, file contents, object keys, source refs,
  proposal rows, file IDs, and secrets
```

Campaign preflight validator:

```txt
script: .codewith/skills/open-files-semantic-renamer/scripts/validate_llm_review_campaign.py
input: campaign-plan.json plus private shard manifests
execution: validator only; it does not call providers or workers
checks: shard manifests exist, planned counts match, aggregate summaries match,
  source manifest checksum matches, duplicate file coverage is absent,
  approval/execute gates are consistent, direct API guardrails are present,
  sandbox-bypass commands are rejected by default, state files are not stale
  unless resume validation is explicit, and plan text does not leak sensitive
  private row values
redaction: summary omits manifest rows, filenames, object keys, source refs,
  file IDs, proposal rows, and secrets
```

Approval-gated campaign launcher:

```txt
script: .codewith/skills/open-files-semantic-renamer/scripts/run_llm_review_campaign.py
default: dry-run only; it does not execute shard commands unless --execute is
  passed to the launcher
preflight: calls validate_llm_review_campaign.py before launch
approval gate: refuses --execute when the plan is not approved
worker output: captures shard stdout/stderr to private per-shard logs and never
  streams worker output to shared stdout
environment: approved shard runner processes receive a minimal explicit
  allowlist rather than the parent environment; AWS credentials, provider API
  keys, and arbitrary secret-looking parent env vars are not inherited
parallelism: bounded by --parallel, defaulting to sequential execution
redaction: launcher summary omits worker stdout/stderr, manifest rows,
  filenames, object keys, source refs, file IDs, proposal rows, and secrets
```

Campaign result collector:

```txt
script: .codewith/skills/open-files-semantic-renamer/scripts/collect_llm_review_campaign_results.py
input: campaign-plan.json, private shard manifests, and runner state/output
  files when present
execution: collector only; it does not call providers, run workers, or apply
  metadata
outputs: private combined campaign manifest, proposal JSONL, error JSONL, and
  proposal-validation error JSONL
checks: state presence/completion, proposal/error coverage against scheduled
  private file IDs, duplicate scheduled/output IDs, extra outputs, and proposal
  schema/name/path validation
strict mode: --require-complete fails until every shard is complete and
  coverage/proposal validation passes
redaction: shared summary omits row payloads, filenames, object keys,
  source refs, file IDs, proposal rows, validation rows, and secrets
```

Mixed-lane campaign planning smoke:

```txt
campaign: mixed-lanes-plan
jobs planned: 9
shards: 3
providers: mimo-direct
approved: false
commands containing --execute: 0
state files planned: 3
plan privacy check: no file_id literals, object keys, or source refs
```

Mixed-lane campaign validation smoke:

```txt
status: ok
approved: false
jobs from shards: 9
duplicate planned file IDs: 0
commands containing --execute: 0
existing state files: 0
sensitive private values checked: 11
sensitive private value leaks: 0
errors: 0
warnings: 0
```

Mixed-lane campaign launcher dry-run:

```txt
status: dry_run
validation: ok
approved: false
execute requested: false
jobs selected: 9
shards selected: 3
completed shards: 0
failed shards: 0
skipped shards: 3
workers launched: 0
```

Launcher environment hardening smoke:

```txt
fixture: approved fake-runner campaign
injected parent env: AWS credentials plus OpenAI/OpenRouter/xAI API keys
runner result: completed
leaked env vars observed by fake runner: 0
worker stdout/stderr: captured in private shard logs only
shared stdout leak check: passed
```

Sandbox-bypass validation smoke:

```txt
fixture: approved legacy Spark provider plan with --allow-bypass-sandbox
default validation: rejected
error code: sandbox_bypass_not_allowed
explicit legacy validation override: accepted
launcher behavior: no override is exposed, so approved bypass plans are refused
  before launch
```

Locked worker bundle smoke:

```txt
builder: .codewith/skills/open-files-semantic-renamer/scripts/build_locked_worker_bundle.py
verifier: .codewith/skills/open-files-semantic-renamer/scripts/verify_locked_worker_bundle.py
source manifest: .codewith/private-artifacts/llm-review-runs/mimo-one-direct-api/chunk-0001.manifest.jsonl
bundle: .codewith/private-artifacts/locked-worker-bundles/mimo-one-direct-api
jobs bundled: 1
validation: ok
verification: ok
public privacy scan: ok on bundle-summary, command, environment-policy,
  bundle-integrity, locked-worker-bundle-verification, prompt, and run-worker
Codewith smoke: gpt-5.3-codex-spark account001, env -i,
  --sandbox workspace-write, conditional --skip-git-repo-check only when the
  bundle has no Git ancestor, no bypass
schema final: done
current limit: full review execution remains approval-gated and needs
  proposal validation before scale
```

Locked worker hardening update:

```txt
HOME policy: controlled bundle-local HOME at sandbox-home
TMP/XDG policy: bundle-local tmp and sandbox-home/.cache/.config/.local/share
host HOME inherited into worker env: false
CODEWITH_HOME: preserved separately for auth only
integrity manifest: bundle-integrity.json
integrity file count: 7
integrity validation: ok
skip-git-repo-check: conditional; omitted when the bundle has a Git ancestor,
  and allowed only for non-Git bundle roots with relative file hashes and copied
  artifact checksum justification
bundle summary kind: locked_worker_bundle_summary
bundle summary sanitized: true
verifier gates: no_sandbox_bypass, skip_git_repo_check_policy_valid,
  execution_surface_attested, controlled_home_tmp, minimal_env_allowlist,
  no_secret_env_allowed, cwd_confined_to_bundle,
  output_confined_to_output_dir, schema_confined_to_input_dir,
  runner_uses_env_i
controlled-home Codewith schema smoke: passed without running worker prompt
```

Direct-provider hardening update:

```txt
scope: OpenRouter-compatible direct API dispatch for Mimo/OpenRouter workers
campaign: .codewith/private-artifacts/llm-campaigns/sanitized-one-job
provider policy status: ok
allowed egress host: openrouter.ai
payload class: sanitized-bounded-review-jobs
job identity policy: synthetic-job-ref
real file IDs sent to direct provider payload: false
raw file bytes sent: false
raw extracts sent: false
secret values sent: false
provider data collection: deny
strict campaign validation: ok
negative execute check: blocked because plan is not approved
adversarial packet: rebuilt with 19 aggregate-safe source artifacts
public privacy scan: ok on regenerated campaign, runtime, bundle, and
  adversarial-review artifacts
runtime note: no approved provider execution was launched
```

Rename correctness gate update:

```txt
collector: .codewith/skills/open-files-semantic-renamer/scripts/collect_llm_review_campaign_results.py
gate field: rename_correctness_gate
checks: coverage completeness, proposal schema validity, error rows,
  canonical_name presence, target_path presence, basename equality,
  expected extension preservation, duplicate target paths, duplicate file IDs,
  confidence counts, requires_review counts, reason presence, and runtime
  attestation gate ok
current sanitized-one-job status: pending
current reason: no approved worker run has produced proposals yet
metadata apply ready: false until proposals pass review
metadata apply additional blocker: runtime attestation gate must be ok for
  every executed job before rename correctness can be ok
packet exposure: aggregate counts only under artifacts.llm_campaign_results
privacy scan: ok on regenerated packet
```

Immutable-byte and metadata-only attestation update:

```txt
search-index runner: emits private per-job runtime-attestation.json files for
  approved jobs and aggregate runtime_attestation counts/hashes in the run
  summary
LLM batch runner: emits private chunk runtime-attestations JSONL for approved
  proposal jobs and aggregate runtime_attestation counts/hashes in the batch
  summary
LLM campaign collector gate: runtime_attestation_gate blocks completed
  campaigns when expected per-job attestations are missing or unsafe
LLM campaign collector coverage: expected attestation refs are derived from
  shard/chunk manifests in memory and matched by shard, chunk_ref, job_ref,
  and hash-only source identity; duplicate, extra, missing, invalid, unsafe,
  or source-identity-mismatched rows block readiness
packet exposure: search-index runtime_immutable_metadata plus LLM
  runtime_attestation_gate, aggregate counts/hashes only
current status: search-index not_executed, LLM pending because no approved
  worker execution has been launched
policy checks: canonical S3 keys immutable, source bytes read-only, no S3
  mutation attempted, metadata/search-index/proposal-only write surface,
  no metadata apply before review
privacy scan: ok on regenerated packet and summaries
```

Canary vs full-run readiness update:

```txt
search-index run summaries: scale_readiness_attestation separates
  pending_canary / canary_verified / full_run_verified
LLM campaign collection summaries: scale_readiness_attestation separates
  canary evidence from full-run completion evidence
full-run readiness requires: canary evidence first, all planned jobs observed
  or completed, rename gate ok, runtime attestation gate ok, and immutable/
  metadata-only runtime evidence ok
current search-index readiness: pending_canary, runtime not_executed
current LLM readiness: pending_canary, rename/runtime gates pending
packet exposure: artifacts.search_index.scale_readiness_attestation and
  artifacts.llm_campaign_results.scale_readiness_attestation
privacy scan: ok on regenerated packet and summaries
```

Duplicate-preserve attestation update:

```txt
script: .codewith/skills/open-files-corpus-reader/scripts/build_duplicate_preserve_attestation.py
current full-plan status: attested_with_pending_index
active duplicate groups: 1,818
duplicate non-survivor rows: 2,564
duplicate survivor rows: 1,818
groups with planned survivor: 1,818
groups without active survivor: 0
groups without planned/indexed survivor: 0
duplicate non-survivor rows accidentally planned: 0
policy result: duplicate policy attested; scale still blocked until planned
  survivor rows are actually indexed
packet exposure: artifacts.search_index.duplicate_preserve_policy,
  aggregate counts and booleans only
```

Multi-account LLM schedule gate:

```txt
planner: .codewith/skills/open-files-semantic-renamer/scripts/plan_llm_review_campaign.py
validator: .codewith/skills/open-files-semantic-renamer/scripts/validate_llm_review_campaign.py
launcher: .codewith/skills/open-files-semantic-renamer/scripts/run_llm_review_campaign.py
real one-job plan account_ref: direct-api:openrouter:default
max_campaign_parallel: 1
account max_parallel: 1
rate_limit_per_minute: 30
strict validation: ok
unapproved execute: blocked / schedule_gate=ok / runtime_enforced=true
parallel above plan: rejected by launcher in tests
packet exposure: artifacts.llm_campaign.schedule_policy
```

Deferred media completion buckets update:

```txt
audit: .codewith/skills/open-files-corpus-reader/scripts/deferred_media_completion_audit.py
summary: .codewith/private-artifacts/deferred-media-completion/deferred-media-completion-summary.json
packet exposure: artifacts.deferred_media_completion
active media files including duplicate-preserve rows: 1,010
video lane: 956 files / 65,028,840,633 bytes
audio lane: 54 files / 1,807,778,819 bytes
completion buckets:
  deferred: 997 files / 66,448,225,691 bytes
  duplicate_preserve: 13 files / 388,393,761 bytes
  queued: 0
  extracted: 0
  indexed: 0
  failed: 0
retry buckets:
  retried: 0
  not_retried: 1,010
completion gate: final_media_pass_required=true,
  cannot_hide_behind_boolean_deferral=true
privacy scan: ok on regenerated media summary and adversarial packet
```

Mixed-lane campaign result collection dry-run:

```txt
status: not_started
approved: false
scheduled rows: 9
observed proposal rows: 0
observed error rows: 0
missing shard state files: 3
coverage missing outputs: 9
proposal validation: skipped
metadata applied: 0
```

## Adversarial Reviews - 2026-06-16

Two read-only adversarial reviewers inspected the repo-local skills, runner,
and plan. They did not edit files and did not print private corpus payloads.

Scale decision:

```txt
not safe to expand to 10 jobs yet
not safe to expand to 100 jobs yet
```

Resolved or partially resolved:

- Default review manifests no longer expose `source_ref`, labels, ACL-adjacent
  fields, filenames, paths, or target paths unless `--include-private-metadata`
  is explicitly set.
- Runner validation now checks exact scheduled file IDs across proposal/error
  outputs, validates error-row schema, and rejects extra/missing/duplicate IDs.
- Proposal validation is now strict and manifest-aware: required fields,
  unknown-field rejection, lowercase kebab-case names, basename equality,
  expected extension preservation, boolean `requires_review`, bounded reason,
  and basic leakage-pattern checks.
- Worker env is now allowlisted instead of inheriting all shell/provider/cloud
  secrets.
- Per-file artifacts now get provenance sidecars with hashed source refs.
- Manifest building and per-file extraction now share one MIME/extension lane
  resolver.
- Direct OpenRouter/Mimo runner payloads now use synthetic `job_ref` values and
  map back to real file IDs only locally after provider response validation.
- Per-shard worker manifests now carry sanitized-manifest redaction
  attestations, and the campaign validator recomputes shard plus aggregate
  checksums/counts before launch.
- LLM campaign plans now carry a recomputable schedule policy with
  `account_ref`, account max parallelism, rate-limit caps, and
  `max_campaign_parallel`; the validator recomputes it from shard entries and
  the launcher rejects parallelism above the plan.
- LLM campaign and search-index execution runners now emit runtime approval
  attestations and block unapproved `--execute` attempts fail-closed.

Still blocking scale:

- Spark no longer requires sandbox bypass for the isolated locked-bundle smoke:
  `build_locked_worker_bundle.py` creates a standalone worker directory with
  copied bounded review artifacts, sanitized manifest, schema, prompt, output
  directory, minimal-env `run-worker.sh`, and no repo/DB/raw downloads/source
  object paths. A schema-only Codewith Spark smoke passed with
  `--sandbox workspace-write`, conditional `--skip-git-repo-check`, `env -i`,
  and no `--dangerously-bypass-approvals-and-sandbox`.
  `verify_locked_worker_bundle.py` now verifies controlled HOME/TMP, minimal
  env, no secret env allowlist, skip-git policy, execution-surface attestation,
  command confinement, output confinement, schema confinement, and no sandbox
  bypass.
  Full Spark file-review runs still require operator approval and post-run
  validation before scale.
- Direct OpenRouter/Mimo execution avoids nested tool-worker writes and passed
  one-file, mixed-lane, cost-guard, and staged/resume canaries. Full use still
  needs approved campaign execution and larger batch validation before thousands
  of rows. The runner now has dry-run/provider-pool schedule gates, but no broad
  provider execution has been approved.
  of rows.
- Models now use a deterministic redacted review-artifact layer and have passed
  mixed-lane canaries; extraction depth is still incomplete for OCR, vision,
  transcription, keyframes, and large files.
- Extraction smoke routing now uses the same shared MIME+extension lane
  resolver as per-file extraction, corpus maps, large-file planning, and
  semantic manifests. This prevents extension-known files with generic MIME
  values from being hidden inside the unknown/metadata lane during smoke
  coverage checks.
- `extraction_tool_inventory.py` reports local extractor readiness by lane in
  aggregate form. On this machine, PDF/Office/archive/metadata lanes have local
  tools available, OCR/vision and design/raw are degraded/provider-required,
  and audio/video lanes remain deferred until the final media pass.
- `build_extraction_tool_remediation_packet.py` maps lane/tool gaps to concrete
  aggregate operator actions. Current status is `operator_remediation_required`
  with 6 actions: non-media large-file canary, OCR/vision, archive inventory
  tools, design/raw EXIF/preview or vision, Docker/CI worker access, and a
  deferred final media pass. It is redaction-checked and non-mutating.
- `extraction_lane_readiness_gate.py` now converts private smoke output into an
  aggregate-only gate for adversarial review. Current state: all 9 active lanes
  are explicitly routed, 48/48 smoke samples routed, 0 failed, 0
  not_implemented, 11 usable outputs, and 0 `sampled_no_usable_output` hard
  blockers. The gate now treats any non-deferred, non-approval sampled lane
  with routed work but zero usable output as a hard blocker, so routed-only
  smoke cannot be mistaken for scale readiness. Full extraction is still
  pending because large-file approval, OCR/design provider work, and the
  deferred media pass remain open.
- Semantic target paths are now projected into `files` search, but content
  summaries and embeddings are not yet indexed.
- Large-file routes are non-terminal until representative large PDF/Office/
  archive/media extractors are implemented and validated.
- OCR/vision and media transcription/keyframes are still tool/provider-required.

Aggregate packet adversarial review update:

```txt
packet builder: .codewith/skills/open-files-semantic-renamer/scripts/build_adversarial_review_packet.py
packet output: .codewith/private-artifacts/adversarial-review/adversarial-review-packet.json
schema: .codewith/private-artifacts/adversarial-review/reviewer-final.schema.json
direct prompts:
  .codewith/private-artifacts/adversarial-review/reviewer-a-direct-prompt.md
  .codewith/private-artifacts/adversarial-review/reviewer-b-direct-prompt.md
review model: gpt-5.3-codex-spark with --auth-profile account001
review mode: read-only, schema-constrained, inline aggregate packet, no file
  content, no private names, no object keys, no source refs
source artifact privacy scan: passed on 12 aggregate-safe inputs
```

The first file-read based reviewer run hit the local Codewith exec
`bwrap: loopback: Failed RTM_NEWADDR` sandbox limitation. The direct inline
prompt fallback succeeded and wrote valid JSON results:

```txt
Reviewer A: fail / not approved to scale
risks: APPROVAL-001, SBOX-002, REDACT-003
blocker: approval enforcement is documented but not proven at dispatch time

Reviewer B: fail / not approved to scale
risks: IDX-001, GATE-002, AVD-003, RNM-004, RPN-005
blockers: approval is still open; 14,651 in-scope non-media files are still
  missing derived search documents
```

The false manual-count concern from the first direct prompt was removed by
adding explicit aggregate invariant totals. Remaining reviewer gates are real:
approval/runtime attestation, canary execution after approval, media completion
tracking after the deferred pass, and rename/canonical-name correctness
coverage.

Runtime-attested review update:

```txt
packet source artifacts: 10 aggregate-safe inputs
LLM negative execute summary:
  .codewith/private-artifacts/llm-campaigns/sanitized-one-job/unapproved-execute-summary.json
  approval_attestation: blocked / runtime_enforced=true / validation_status=ok
  execute requested: true
  plan approved: false
  selected shards/jobs: 1 / 1
Search-index negative execute summary:
  .codewith/private-artifacts/search-index-nonmedia-plan/unapproved-execute-summary.json
  approval_attestation: blocked / runtime_enforced=true / validation_status=ok
  execute requested: true
  plan approved: false
  selected jobs: 1
```

Latest direct reviewer results after runtime negative-execute evidence:

```txt
Reviewer A: pass_with_conditions / not approved to scale
remaining blockers: operator approval absent; approval note absent
current main risks: APR-001, NET-002
note: packet evidence now shows controlled HOME, bundle integrity, summary kind,
  and sanitized=true; any stale reviewer wording about missing kind/sanitized is
  contradicted by the current packet fields

Reviewer B: fail / not approved to scale
blockers: approval policy blocks execution; indexed_files=0 and
  missing_files=14,651 in the non-media scope
risks: IDX-COVERAGE-01, LANE-HIDING-02, CANARY-BIAS-03, RENAME-GAP-04
```

The direct-API approval-bypass concern is now backed by a blocked runtime
summary, but scale still correctly remains disallowed until an operator
approval note is present, a canary executes, and post-run coverage improves.

## Search Integration - 2026-06-16

Implemented:

- SQLite migration v19 rebuilds `files_fts` with organization owner,
  target path, labels, and review status.
- SQLite migration v20 adds `file_search_documents` plus
  `file_search_documents_fts` for bounded extracted/OCR/transcript/LLM-summary
  artifacts.
- `refreshFileFts` now indexes `file_organization_reviews` metadata alongside
  file name/path/canonical_name/description/tags.
- `updateFileOrganizationReview` refreshes FTS after organization metadata
  changes, so reviewed target paths become searchable.
- `src/db/file-search-documents.ts` is the supported DB API for adding,
  listing, deleting, and rebuilding derived search documents.
- `src/db/search.ts` merges metadata FTS hits with derived-content FTS hits and
  exposes organization fields plus match source/kind summaries on results.
- `files search --scope all|metadata|content` searches file metadata and/or
  indexed derived content while returning file-level results by default.
- `files search-index add/list/remove/stats/rebuild-fts` lets extractors and
  LLM workers populate the local searchable surface without mutating canonical
  S3 keys or printing indexed text in normal output.
- `files search-index stats --json` now reports active-file coverage for
  derived documents plus organization readiness counts: active files,
  active indexed files, missing active index count, coverage percentage,
  organized active files, owner/target/canonical-name coverage, and per-owner
  indexed counts.
- `plan_search_index_population.py` reports aggregate coverage for
  `file_search_documents` and writes private shard manifests for future
  extraction/index workers.
- `plan_search_index_population.py --exclude-lanes ...` supports deferred-lane
  planning, currently used to keep audio/video out of the active non-media
  search-index population packet while recordings/media are deferred.
- `validate_search_index_population_plan.py` verifies shard checksums, counts,
  duplicate private IDs, approval state, and public-plan redaction before any
  runner can execute.
- `plan_search_index_population.py` now emits explicit aggregate invariant
  totals for rows/bytes across lane, owner, strategy, coverage, recommended
  kind, and lane-size dimensions.
- `validate_search_index_population_plan.py` now rejects aggregate dimension
  count/byte mismatches, so a public plan cannot hide untracked work behind a
  clean-looking lane summary.
- `validate_llm_review_campaign.py --require-sanitized-rows` now adds a strict
  worker-dispatch gate: private shard rows may still be checked for redaction,
  but real worker campaigns can require rows without source refs, names, paths,
  object keys, ACL fields, target paths, or `private_*` payloads.
- `plan_llm_review_campaign.py` now writes sanitized worker shard manifests by
  default, preserving only worker-safe fields such as file id, owner, lane,
  MIME/extension, expected extension, review artifact, and artifact readiness.
  The old private-field shard shape requires explicit
  `--include-private-worker-fields` and should remain legacy/debug-only.
- `plan_llm_review_campaign.py` now emits per-shard and aggregate redaction
  attestations using row counts, shard checksums, row-key hashes, and unsafe-key
  / sensitive-marker counts. The attestations contain no filenames, object keys,
  source refs, extracted text, proposal rows, or private row values.
- `validate_llm_review_campaign.py` recomputes those redaction attestations
  from private shard manifests and rejects mismatches or tampering.
- `plan_llm_review_campaign.py`, `plan_search_index_population.py`,
  `plan_large_file_extraction.py`, `run_llm_review_campaign.py`, and
  `run_search_index_population_plan.py` now emit approval attestations.
  Approved regeneration supports private `--approval-note-file` JSON artifacts;
  generated plans preserve only approval-note hashes and source metadata, not
  raw approval-note text. Runtime summaries show whether execute was requested,
  blocked, or verified.
- Sanitized one-job private campaign dry-run evidence:
  `worker_manifest_sanitized=true`, `jobs_planned=1`, strict validation
  status `ok`, execute commands `0`, sensitive plan leaks `0`, and public plan
  privacy scan passed.
- Sanitized one-job campaign redaction attestation:
  `status=ok`, `rows=1`, `shards=1`, `disallowed_key_hits=0`,
  `private_prefixed_key_hits=0`, `sensitive_value_marker_hits=0`.
- Sanitized one-job direct-API negative execute evidence:
  `approval_attestation.status=blocked`, `runtime_enforced=true`,
  `execute_requested=true`, `plan_approved=false`, `validation_status=ok`.
- `run_search_index_population_plan.py` is dry-run by default, refuses
  unapproved execution, captures extractor/indexer logs privately, and indexes
  derived text only by calling `files search-index add`.
- `run_search_index_population_plan.py` now emits runtime approval
  attestations showing whether execution was not requested, blocked,
  validation-failed, or verified. A non-media unapproved execute attempt with
  one selected job was blocked with validation status `ok`.
- Approved `run_search_index_population_plan.py` executions write private
  result rows with file IDs plus public-safe selected/result ID hashes in the
  run summary, so coverage can be verified without exposing row identities.
- `build_search_index_approval_packet.py` emits aggregate validation status,
  conservative canary commands, and pre/post stats commands for operator
  review. Its execute command now passes explicit `--max-canary-jobs` and
  `--max-canary-bytes` values that match the planned canary envelope, so the
  global execution preflight and approval packet cannot drift.
- `build_search_index_approval_packet.py` preserves planner filters such as DB
  path, lane allow/exclude lists, ordering, include flags, and job caps in its
  `regenerate_approved_plan` command, so a reviewed non-media plan cannot be
  accidentally regenerated as an all-lane/media-inclusive plan.
- `verify_search_index_population_run.py` compares private result coverage
  hashes, result counts, public-summary redaction, and optional DB
  `file_search_documents` coverage after approved execution.
- `extraction_smoke_matrix.py`, `run_search_index_population_plan.py`, and
  `extract_artifact_for_file.py` accept `--files-command`; use
  `--files-command 'bun run src/cli/index.tsx'` for repo-local runs so
  subprocesses use the current CLI and the plan DB path instead of a stale
  global `files` binary.
- `inspect_file_metadata.py` can now use PIL as a bounded private design/raw
  preview fallback when ImageMagick is unavailable. The readiness gate remains
  conservative: PIL is treated as a best-effort fallback, not broad preview
  coverage for the design/raw lane, so `preview`, EXIF metadata, and vision
  provider approval remain explicit blockers when sampled formats cannot be
  previewed locally.
- `build_adversarial_review_packet.py` builds aggregate-only reviewer packets,
  no-tool direct prompts, and a strict JSON schema for two adversarial review
  agents before any scale decision.

Worker indexing shape:

```bash
files search-index add <file-id> \
  --kind llm_summary \
  --extractor <extractor-or-agent-name> \
  --text-file <private-artifact.txt> \
  --metadata-json '{"document_kind":"summary"}'

files search "renewal forecast" --scope content --json
files search-index stats --json

python3 .codewith/skills/open-files-corpus-reader/scripts/plan_search_index_population.py \
  --output-dir .codewith/private-artifacts/search-index-plan
python3 .codewith/skills/open-files-corpus-reader/scripts/validate_search_index_population_plan.py \
  --plan .codewith/private-artifacts/search-index-plan/search-index-population-plan.json
python3 .codewith/skills/open-files-corpus-reader/scripts/build_search_index_approval_packet.py \
  --plan .codewith/private-artifacts/search-index-plan/search-index-population-plan.json \
  --files-command 'bun run src/cli/index.tsx'
python3 .codewith/skills/open-files-corpus-reader/scripts/run_search_index_population_plan.py \
  --plan .codewith/private-artifacts/search-index-plan/search-index-population-plan.json \
  --max-jobs 25 \
  --files-command 'bun run src/cli/index.tsx'
python3 .codewith/skills/open-files-corpus-reader/scripts/verify_search_index_population_run.py \
  --plan .codewith/private-artifacts/search-index-plan/search-index-population-plan.json \
  --run-dir .codewith/private-artifacts/search-index-plan/search-index-run \
  --require-complete \
  --check-db
python3 .codewith/skills/open-files-corpus-reader/scripts/verify_search_index_population_run.py \
  --plan .codewith/private-artifacts/search-index-plan/search-index-population-plan.json \
  --summary .codewith/private-artifacts/search-index-plan/search-index-dry-run-summary.json \
  --output .codewith/private-artifacts/search-index-plan/search-index-dry-run-verification.json
```

Verified:

```bash
python3 -m unittest discover -s .codewith/skills/open-files-corpus-reader/tests -p 'test_*.py'
python3 -m unittest discover -s .codewith/skills/open-files-semantic-renamer/tests -p 'test_*.py'
bun run typecheck
bun test src/db/search.test.ts src/cli/search-index.test.ts
bun test
bun run build:cli
```

Still pending:

- Embeddings or semantic vector index if approved.
- Full-corpus population of `file_search_documents` after approved extraction
  and LLM-review campaigns.
- Full-corpus FTS rebuild after reviewed proposals are applied or a production
  DB sync path is selected.

Search-index population plan:

```txt
script: .codewith/skills/open-files-corpus-reader/scripts/plan_search_index_population.py
output: .codewith/private-artifacts/search-index-population-plan/search-index-population-plan.json
status: approval_required
approved: false
active non-duplicate files: 15,648
indexed files with ready/partial derived search documents: 0
missing files: 15,648
stale-only files: 0
planned private shards: 32
planned bytes: 128,358,442,514
public plan privacy check: no file_id keys, private file-id values,
  open-files source refs, or objects/sha256 keys
```

Validator and dry-run:

```txt
validator status: ok
jobs from shards: 15,648
bytes from shards: 128,358,442,514
duplicate private file IDs: 0
plan sensitive marker hits: 0
plan private ID leaks: 0

runner dry-run status: dry_run
selected jobs: 25
selected bytes: 138,718
selected lane: metadata_only_or_unknown
execute requested: false
results: 25 skipped / 0 indexed
files command used for dry-run: bun run src/cli/index.tsx
dry-run verifier status: ok
dry-run verifier selected jobs: 25
dry-run verifier result rows seen: 0
dry-run verifier sensitive marker hits: 0
dry-run verifier duplicate result file IDs: 0
dry-run verification output:
  .codewith/private-artifacts/search-index-population-plan/search-index-dry-run-verification.json

files search-index stats:
documents: 0
indexed files: 0
stale documents: 0

approval packet:
output: .codewith/private-artifacts/search-index-population-plan/search-index-approval-packet.json
approval required: true
validation status: ok
recommended canary: 25 jobs / 1,048,576 selected bytes cap
pre/post stats command: bun run src/cli/index.tsx search-index stats --json
post-run verifier command: verify_search_index_population_run.py --require-complete --check-db
packet privacy check: no file_id keys, private file-id values,
  open-files source refs, or objects/sha256 keys
aggregate artifact privacy check: approval packet, dry-run summary, dry-run
  verification, and plan validation contain no file_id keys, private file-id
  values, open-files source refs, object keys, extracted text, or transcripts
```

Current non-media search-index population packet:

```txt
output: .codewith/private-artifacts/search-index-nonmedia-plan/search-index-population-plan.json
excluded lanes: needs_transcription, needs_video_pipeline
status: approval_required
approved: false
active non-media files planned: 14,651
indexed files in scope: 0
missing files in scope: 14,651
planned bytes: 61,910,216,823
shards: 30
validation: ok
duplicate private IDs: 0
plan private ID leaks: 0
plan sensitive marker hits: 0
aggregate invariant totals: all planned dimensions sum to 14,651 files /
  61,910,216,823 bytes
approval packet:
  .codewith/private-artifacts/search-index-nonmedia-plan/search-index-approval-packet.json
approval packet preserves exclude-lanes in regenerate_approved_plan: yes
public artifact privacy scan: passed
```

Top planned lanes:

```txt
needs_ocr_or_vision: 5,402 files / 14,565,343,818 bytes
needs_pdf_extractor: 5,255 files / 4,991,763,376 bytes
needs_office_extractor: 2,512 files / 752,839,440 bytes
needs_design_raw_pipeline: 721 files / 25,657,756,418 bytes
readable_now_text: 586 files / 162,502,050 bytes
metadata_only_or_unknown: 120 files / 4,373,212,000 bytes
needs_archive_inventory: 55 files / 11,406,799,721 bytes
```

## Hardening Baseline - 2026-06-16

Corpus map:

```txt
script: .codewith/skills/open-files-corpus-reader/scripts/build_corpus_map.py
public output: .codewith/private-artifacts/corpus-map/corpus-map-public.json
private worker map: .codewith/private-artifacts/corpus-map/corpus-private-map.jsonl
total active files: 18,212
total bytes: 132,917,143,313
duplicate review rows preserved: 2,564
requires execution approval: 15,648
requires private content access: 15,528
indexed files: 0
stale-only indexed files: 0
missing index files: 18,212
private worker rows: 18,212
public map privacy check: no file_id keys, private file-id values,
  open-files source refs, object keys, extracted text, or transcripts

needs_ocr_or_vision: 6,151
needs_pdf_extractor: 5,986
needs_office_extractor: 2,657
readable_now_text: 1,334
needs_video_pipeline: 956
needs_design_raw_pipeline: 816
metadata_only_or_unknown: 191
needs_archive_inventory: 67
needs_transcription: 54

top readiness:
ocr_or_vision_required: 5,399
local_pdf_extractor_ready: 5,232
deferred_duplicate_preserve: 2,564
local_office_extractor_ready: 2,512
large_file_runner_required: 867
```

Artifact-based smoke matrix:

```txt
samples: 48
max download bytes: 10 MiB
files command: repo-local CLI (`bun run src/cli/index.tsx`)
failed: 0
not_implemented: 0

readable_now_text: 4 routed / 4 usable
needs_office_extractor: 5 routed / 4 usable / 1 large-file route
needs_pdf_extractor: 6 routed / 2 usable / 2 large-file routes
needs_archive_inventory: 5 routed / 1 usable / 2 large-file routes
needs_ocr_or_vision: 5 routed / 0 usable / 1 large-file route
needs_video_pipeline: 6 routed / 0 usable / 2 large-file routes
needs_transcription: 5 routed / 0 usable / 2 large-file routes
needs_design_raw_pipeline: 6 routed / 0 usable / 2 large-file routes / 4 private vision-request artifacts
metadata_only_or_unknown: 6 routed / 0 usable / 2 large-file routes
```

Extraction lane readiness gate:

```txt
script: .codewith/skills/open-files-corpus-reader/scripts/extraction_lane_readiness_gate.py
output: .codewith/private-artifacts/extraction-lane-readiness-gate.json
packet exposure: artifacts.extraction_readiness
status: pending_completion
all expected lanes present: true
all active lanes explicitly routed: true
sampled routed files: 48 / 48
sampled usable files: 11
failed smoke samples: 0
not_implemented smoke samples: 0
sampled no-usable hard-blocker lanes: 0
all sampled non-deferred non-approval lanes have usable output: true
large-file runner required files: 867
deferred media files: 1,010
route status counts:
  ready: 1
  approval_required_large_file_runner: 4
  degraded_provider_required: 2
  deferred_media: 2
```

Extraction lane readiness verifier:

```txt
script: .codewith/skills/open-files-corpus-reader/scripts/verify_extraction_lane_readiness_gate.py
output: .codewith/private-artifacts/extraction-lane-readiness-verification.json
status: ok
gate status: pending_completion
current source hashes: ok
semantic rebuild from corpus/tool/smoke/deferred-media inputs: ok
hard blocker lanes: 0
pending lanes: 8
large-file runner required files: 867
deferred media files: 1,010
redaction scan: ok
```

Immediate hardening gaps:

- Run an approved larger campaign only after an operator reviews the generated
  campaign plan and approval packet.
- Install `tesseract` or wire an approved vision model to make image/scanned
  document content usable instead of `tool_required`.
- Install `exiftool` and ImageMagick, or approve a design/raw vision pass, so
  PSD/AI/RAW/design rows can move from metadata-plus-request artifacts to
  usable visual summaries.
- Implement actual audio/video transcription and keyframes after ffprobe/ffmpeg
  or a remote media worker is available.
- Implement approved large-file execution runners. The redacted large-file
  planner now creates private shard manifests, but no heavy download/extraction
  should run until the plan is approved.
- Build/deploy the archive-capable extraction worker image after Docker access
  is available. The repo now contains
  `.codewith/skills/open-files-corpus-reader/worker-image/Dockerfile`, which
  bakes `p7zip-full` and `libarchive-tools` for 7z/rar-compatible listing.
  `archive_inventory.py` supports `7zz`/`7z`/`7za`, `unrar`, and `bsdtar` when
  present and reports missing candidate blocks without leaking archive member
  names. `extraction_lane_readiness_gate.py` now accepts
  `--worker-tool-inventory`, so the host inventory can remain honest while a
  worker-produced inventory clears archive missing blocks after the image is
  built and smoked.
- `verify_extraction_worker_image.py` now creates aggregate-only verification
  evidence for the archive extraction worker image. In this environment the
  static checks pass, but Docker runtime status is `permission_denied`; no image
  build or corpus extraction was attempted.
- `build_extraction_worker_image_approval_packet.py` writes a dedicated
  operator approval packet for the Docker/CI worker build and smoke. Current
  packet status is `ready_for_operator_approval`: static verification is OK,
  Docker access is unavailable here, and the requested approval scope does not
  require corpus reads, S3 mutation, DB writes, or private filename/object-key
  disclosure.
- `build_extraction_approval_dashboard.py` now consolidates the current
  approval queue, including the extraction tool remediation packet, into
  `.codewith/private-artifacts/extraction-approval-dashboard.json`. Current
  status is `ready_for_operator_review`: OCR/vision canary, balanced non-audio
  large-file canary, archive worker image build/smoke, search-index population,
  and sanitized LLM review campaign are all prepared for operator review; media
  remains intentionally deferred until the final pass. The dashboard now
  carries `dashboard_checks`, `dashboard_errors`, source artifact hashes,
  `redaction_check`, and non-mutation attestation.
- `verify_extraction_approval_dashboard.py` now validates the approval
  dashboard before downstream approval templates, stage gates, replacement
  gates, adversarial packets, or blocker reports depend on it. Current
  verification status is `ok`: 5 approval items are ready, 0 approval notes are
  approved, 5 approval-note items are pending, all 17 source artifacts are
  hashed/current, dashboard checks pass, no mutation is attested, and there are
  no errors or warnings.
- `build_extraction_tool_remediation_packet.py` now emits explicit
  `packet_checks`, `packet_errors`, source artifact hashes, redaction status,
  and non-mutation attestation. Current remediation status is
  `operator_remediation_required` with 6 actions, 5 non-deferred actions, 5
  approval-required actions, 1 deferred media action, all required aggregate
  sources present/hashed, and empty sensitive-marker counts.
- `validate_operator_approval_notes.py` now validates private operator
  approval-note artifacts and writes
  `.codewith/private-artifacts/operator-approvals/approval-notes-summary.json`.
  Current status is `missing_required`: 0 approval-note artifacts are present,
  5 required non-media decisions are missing, and the public summary exposes
  only decision IDs, status, timestamps, and hashes when notes exist. When the
  current approval request packet is supplied, the validator also requires each
  completed note to match the packet scope, remediation action IDs, remediation
  status, command hashes, and remediation redaction check. The current summary
  records `approval_request_packet_present=true`,
  `approval_request_packet_status=templates_ready`, 5 request templates, and
  request-packet checks active for all 5 missing decisions.
- `verify_operator_approval_intake.py` now consumes the approval-notes summary,
  approval request packet, Drive approval-note summary/verification,
  extraction approval dashboard, and operator blocker report to map each
  required decision to note validity, matching ready canary task, and
  execution-unlock state without granting approvals or launching work. Drive
  approval notes are a global unlock gate. Current intake status is
  `missing_required`: all 5 required approval notes are still absent, 14 Drive
  approval decisions are missing, Drive approval-note verification is `ok`, 0
  canary tasks are unlocked, the output is aggregate-only, and the redaction
  check passes.
- `build_post_approval_canary_command_plan.py` now consumes approval-intake
  readiness, Drive approval-note summary/verification, and the dashboard
  command maps, then emits a read-only canary command queue using only command
  refs, hashes, byte counts, mutation classes, and ordering. Raw command
  strings are omitted. Current plan status is `blocked_no_unlocked_decisions`:
  5 decisions remain blocked by missing notes, Drive approval notes are not
  ready (`missing_required`), 0 canary decisions are unlocked, 0 commands are
  planned, and the redaction check passes.
- `verify_post_approval_canary_command_plan.py` now independently verifies the
  post-approval command plan before any command ref can be used. It recomputes
  current intake/dashboard/Drive approval-note source hashes, rebuilds the
  expected semantic plan, validates command queue hashes/order/mutation
  classes, confirms raw commands are omitted, checks non-mutation attestation,
  and fails closed on redaction. Current verification status is `ok` with plan
  status `blocked_no_unlocked_decisions`, 0 planned commands, no errors, and no
  warnings.
- `run_post_approval_canary_command_plan.py` now provides the fail-closed runner
  for approved canary commands. It defaults to dry-run, resolves raw commands
  only from current dashboard command refs, verifies command hashes against the
  plan, requires plan verification `ok` plus plan status
  `ready_for_operator_execution` plus current Drive approval notes status
  `approved` before `--execute` can run, and writes raw command output only to
  private logs. Current run summary is `dry_run_blocked`: execution was not
  requested, execution is not allowed because the plan is
  `blocked_no_unlocked_decisions` with an empty command queue and Drive
  approval notes are `missing_required`, 0 commands were resolved, and 0
  commands executed.
- `verify_post_approval_canary_command_run.py` now independently verifies the
  runner summary. It checks source artifact freshness against the current
  command plan, plan verifier, dashboard, and Drive approval-note artifacts;
  validates dry-run/execution gate consistency; confirms count consistency and
  raw-command omission; verifies private log byte/hash evidence for executed
  commands; and fails closed on redaction or non-mutation attestation issues.
  Current verification status is `ok` with run status `dry_run_blocked`, Drive
  approval notes `missing_required`, 0 selected/resolved/executed commands, no
  errors, and no warnings.
- `build_operator_approval_note_templates.py` now writes private fill-in
  templates under `.codewith/private-artifacts/operator-approvals/templates`
  plus the redacted
  `.codewith/private-artifacts/operator-approvals/approval-request-packet.json`.
  Current request packet status is `templates_ready` with 5 templates:
  OCR/vision provider-use, large-file canary, archive worker build,
  search-index canary, and LLM review canary. Templates are ignored by
  `validate_operator_approval_notes.py`; only completed note artifacts in the
  approval directory can satisfy approval gates. Each template now carries
  aggregate remediation context: OCR/vision links to `enable_ocr_or_vision_lane`,
  large-file links to `approve_large_file_runner_canary`, and archive worker
  links to `enable_archive_inventory_tools` plus
  `grant_worker_docker_access_or_ci`; search-index and LLM templates carry the
  overall remediation status without approving extraction/tool work. The request
  packet also records source artifact hashes for the extraction approval
  dashboard and approval-notes summary that produced it.
- `verify_operator_approval_request_packet.py` now verifies the approval
  request packet independently before the blocker report can depend on it. It
  checks the required decision set, scopes, remediation links, template counts,
  template-file hashes, command hashes, source status, source artifact hash
  shapes plus current source bytes/hashes, non-mutation attestation, and
  sensitive-marker absence. Current verification status is `ok` with 5
  templates, `source_artifact_current_hashes_ok=true`, and no errors or
  warnings.
- The archive worker image approval packet now includes structured Docker
  access remediation. Current static verification is OK, Docker CLI is present,
  but Docker socket access is `permission_denied`; the safe next action is to
  grant Docker socket access to the operator session or run the approved
  build/smoke in CI. This path requires no corpus reads, S3 mutation, DB
  mutation, or private filename/object-key disclosure. The packet now also
  carries source artifact hashes, `redaction_check`, and
  `approval_packet_checks`.
- Search-index and large-file approval packets now regenerate approved plans
  with `--approval-note-file` paths, not inline approval-note text, and now
  carry source artifact hashes, `redaction_check`, and
  `approval_packet_checks`. Current and non-media search-index approval packets
  validate cleanly; the legacy search-index-population packet and balanced
  non-audio large-file packet have empty sensitive-marker counts and valid
  source hashes but still report source-plan validation errors until approved
  plan attestations are regenerated. The dashboard, request packet, stage
  dependency gate, and adversarial packet were refreshed so command hashes
  match the file-based approval flow.
- The approval dashboard now separates preparation from approval. Current
  dashboard state has 5 items ready for operator review, 0 validated approval
  notes, `approval_notes_complete=false`, and 5 pending approval-note items.
- `build_adversarial_review_packet.py` now accepts
  `--extraction-approval-dashboard` and `--stage-dependency-gate` and includes
  redacted dashboard and stage summaries for the two adversarial reviewers, so
  they can audit operator readiness, non-mutation guarantees, ordered scale
  blockers, and deferred media alongside extraction/search/LLM gates.
- The adversarial packet now also accepts `--approval-request-packet`,
  `--approval-request-verification`, `--llm-provider-readiness`,
  `--stage-dependency-verification`, `--extraction-readiness-verification`,
  and `--replacement-readiness-gate`; current packet verification reports 25
  aggregate-safe source artifacts and
  verifies that the approval-template request packet and its verifier are ready,
  redacted, non-mutating, and linked to remediation action IDs, and that the LLM
  provider route, provider privacy policy, schedule caps, non-mutation
  attestation, redaction checks, ordered-stage verification, extraction
  readiness verifier, and final replacement-readiness evidence are ready for
  review.
- `verify_adversarial_review_packet.py` now validates the generated adversarial
  packet before reviewer agents run. It checks required source artifacts,
  current source artifact bytes/hashes, dashboard readiness,
  immutable/non-mutation invariants, generated reviewer
  prompt/schema/input-attestation presence, locked-worker verification and
  isolation policy gates,
  extraction-route safety, LLM provider-readiness gates, nested stage and
  approval-request verifier freshness gates, and sensitive-marker absence.
- Two schema-constrained adversarial reviewer agents were refreshed against the
  current aggregate packet and wrote
  `.codewith/private-artifacts/adversarial-review/reviewer-a-current-result.json`
  and
  `.codewith/private-artifacts/adversarial-review/reviewer-b-current-result.json`.
  `verify_adversarial_review_results.py` verifies the outputs and writes
  `.codewith/private-artifacts/adversarial-review/adversarial-review-results-verification.json`.
  Current status is `reviewed_with_blockers`: both reviewers preserved privacy,
  both copied the current packet/schema/prompt `input_attestation` hashes,
  neither approved scale-up, and the aggregate summary reports 13 risks, 12
  blockers, 9 blocker-severity risks, and no verifier errors or warnings after
  the stage dependency gate, approval-note gates, approval-template request
  packet, approval request verifier, LLM provider-readiness gate,
  stage-dependency verifier, Drive approval-note gate, and
  replacement-readiness gate made the ordered blockers explicit.
- `global_execution_preflight.py` now backs the search-index population runner,
  large-file extraction runner, and LLM campaign launcher. Execution summaries
  include `global_execution_preflight`; explicit execution now fails closed if
  the extraction readiness gate is missing, bounded canaries require a validated
  plan approval token, zero hard blocker lanes, and explicit job/byte cap
  compliance, and
  `--execution-scope scale` requires complete extraction readiness with zero
  pending/hard blocker lanes, a validated plan approval token, and no
  `requires_operator_approval_before_scale=true` flag. Unapproved canary
  negative-execution summaries with a present readiness gate must report
  `canary_approval_token_required` and `allowed=false`; cap compliance alone
  cannot unlock execution.
- Search-index plans now include `declared_totals` and completeness outcomes
  (`planned`, `already_indexed`, `exempt_duplicate`,
  `exempt_lane_not_selected`, `exempt_excluded_lane`,
  `unplanned_in_scope`). Current full search-index plan declares 18,212 active
  files, 15,648 planned jobs, 2,564 duplicate exemptions, and
  `reconciled=true`. Current non-media plan declares the same active inventory,
  14,651 planned jobs, 3,561 exemptions, and `reconciled=true`.
- `verify_search_index_readiness_reconciliation.py` compares the search-index
  completeness outcome lanes against the extraction readiness lanes and now
  emits source artifact hashes plus a formal redaction check. Current full and
  non-media reconciliation artifacts both report 9 lanes, 18,212 active files,
  matching active bytes, and 0 mismatched lanes; both artifacts have source
  hashes for their search-index plan and the extraction readiness gate, and
  their sensitive-marker counts are empty.
- `build_stage_dependency_gate.py` now writes
  `.codewith/private-artifacts/stage-dependency-gate.json`, an aggregate-only
  ordered readiness gate for scale-up. Current status is `blocked` and
  `approved_to_scale=false`: duplicate-preserve policy and LLM provider
  readiness are complete; extraction lane readiness is the first blocker; media
  remains deferred for the final pass; operator approvals now explicitly
  require validated extraction/index/LLM approval-note artifacts plus verified
  Drive approval-note artifacts; search-index canary/full population, LLM
  rename canary/full campaign, and metadata apply readiness remain blocked in
  order. The artifact now carries aggregate source hashes for its 10 input
  artifacts, including the extraction-readiness verifier plus the Drive
  approval-note summary and verifier. The extraction stage cannot complete
  unless that verifier is `ok`, source-current, redaction-clean, and
  semantically matched to the readiness gate.
- `verify_stage_dependency_gate.py` now verifies the ordered scale-up gate
  independently. It treats the current blocked gate as valid only when the
  10-stage order, stage-order numbers, blocker counts, first blocker, scale
  rules, source artifact hash shapes, current source artifact bytes/hashes,
  redaction scan, and approval flag are internally consistent. Current
  verification status is `ok` with
  `gate_status=blocked`, `approved_to_scale=false`, 8 blocking stages, 7 hard
  blockers, 1 deferred blocker, first blocker `extraction_lane_readiness`, no
  errors, and no warnings. The operator-approval stage now carries Drive
  approval-note evidence with notes status `missing_required`, 14 required
  decisions, 0 approved decisions, and verification status `ok`.
- `build_replacement_readiness_gate.py` now writes
  `.codewith/private-artifacts/replacement-readiness-gate.json`, an
  aggregate-only final gate for whether open-files can replace Google Drive.
  Current status is `blocked` and `approved_to_replace_google_drive=false`.
  It tracks 9 requirements: 2 complete, 1 deferred, 6 blocked, and 0 missing.
  Complete now: active file mapping and immutable bytes/duplicate-preserve
  policy. First incomplete requirement is `read_extraction_coverage`; deferred
  media, operator approvals, files CLI search-index population, semantic
  rename readiness, metadata apply readiness, and adversarial validation still
  block final replacement. The operator-approval requirement now requires
  Drive approval-note status `approved` plus Drive note verification status
  `ok`; the current Drive notes status is `missing_required`. The artifact now
  carries aggregate source hashes for 12 input artifacts, including the
  extraction-readiness verifier. Active-file mapping and read-extraction
  coverage cannot complete unless that verifier is `ok`, source-current,
  redaction-clean, and semantically matched to the readiness gate. The
  adversarial validation requirement now carries reviewer freshness evidence from the
  adversarial results verifier, including
  `freshness_all_input_attestations_match=true` plus packet/schema/prompt
  presence booleans.
- `verify_replacement_readiness_gate.py` now verifies the final replacement
  gate independently. It treats a blocked gate as valid only when the
  aggregate requirement list, status counts, first incomplete requirement,
  source artifact hash shapes, current non-cyclic source artifact bytes/hashes,
  adversarial reviewer freshness evidence, redaction scan, and approval flag
  are internally consistent. Current verification status is `ok` with
  `gate_status=blocked`, `approved_to_replace_google_drive=false`,
  `source_artifact_current_hashes_ok=true`, no errors, and two allowed cyclic
  warnings for `operator_approval_blocker_report` and
  `adversarial_review_results`, because the replacement gate, operator blocker
  report, adversarial packet, and reviewer-result attestations intentionally
  snapshot each other.
- `build_adversarial_review_packet.py` now requires the stage dependency gate
  and approval request verification alongside search-index runtime,
  duplicate-preserve evidence, and the extraction-readiness verifier for strict
  packet verification.
  `verify_adversarial_review_packet.py` checks the 10-stage order, first
  blocking stage, scale-rule booleans, approval request verifier status,
  stage-dependency verification status, extraction-readiness verifier
  status/current-source/semantic-projection gates, provider-readiness gates,
  replacement-readiness requirement set/status consistency, and approval
  consistency before reviewer agents run.
- `build_operator_approval_blocker_report.py` now combines the approval
  dashboard, adversarial packet verification, stage-dependency verification,
  replacement-readiness verification, extraction-readiness verification,
  approval request packet, approval request verification, and ready todo queue
  into
  `.codewith/private-artifacts/operator-approval-blocker-report.json`. It only
  reports `operator_approval_required` when the approval request verification
  and final gate verifiers are themselves `ok`, and it forwards the extraction
  readiness, approval request, stage, and replacement current-source hash gates
  in critical verifier evidence. Current status is
  `operator_approval_required` with `approval_request_verification_ok=true` and
  `final_gate_verifiers_ok=true`: extraction readiness verification is current,
  semantic-current, and redaction-clean; 5 dashboard decisions are ready and all 5
  extraction/index/LLM approval decisions now link to explicit
  approval-required todos, 20 ready tasks are visible in the queue, 19 are
  approval tasks, 14 are Drive/ACL/organization approvals, 1 is deferred media,
  0 non-approval non-media tasks are ready, stage and replacement gates are
  both valid but blocked, media remains deferred, and the report redaction
  check passes with no sensitive markers.
- `verify_operator_approval_blocker_report.py` now verifies the blocker report
  independently. It checks report status logic, safe-next-step counts, queue
  counts, live ready-todo aggregate counts, source hash shapes plus current
  file-source bytes/hashes, approval request verification dependency, final
  gate verifier dependency, non-mutation attestation, approval-template
  readiness, and redaction. Current verification
  status is `ok`: expected report status matches `operator_approval_required`,
  approval request verification and final gate verifiers are `ok`, all seven file
  source artifacts are present, hashed, and current, the live ready-todo
  aggregate counts match the blocker report, the live `todos ready --json`
  source is recorded as a command attestation, and there
  are no errors or warnings.
- `build_drive_approval_queue.py` now writes
  `.codewith/private-artifacts/drive-approval/drive-approval-queue.json`, an
  aggregate-only Drive/ACL/organization approval queue. It groups the current
  ready Drive tasks by root type, business area, approval type, priority, and
  row-count hints, and records only approval-prep doc path hashes plus
  non-mutation/redaction attestations. Current queue status is
  `operator_drive_approval_required`: 14 Drive approval tasks, 9 ACL owner
  approvals, 2 unassigned folder reviews, 1 duplicate owner-assignment review,
  1 metadata apply/audit approval, 1 backup/rollback evidence approval, 29
  source docs, 0 missing expected source docs, 11 tasks with row-count hints,
  and aggregate row-count hints totaling 17,786 rows. No corpus bytes, S3
  objects, metadata rows, search-index rows, approvals, Drive row payloads, ACL
  payloads, private filenames, object keys, or source refs are written.
- `verify_drive_approval_queue.py` now verifies that queue independently. It
  recomputes current approval-prep doc hashes, rediscovers the doc inventory,
  rebuilds the queue semantics from live `todos ready --json`, validates
  expected-source-doc coverage and count consistency, confirms non-mutation
  attestation, and fails closed on sensitive markers. Current verification
  status is `ok`: queue status remains `operator_drive_approval_required`, the
  live ready-todo semantic projection matches, source doc hashes are current,
  and there are no errors or warnings.
- `build_drive_approval_note_templates.py` now writes private Drive
  approval-note templates under
  `.codewith/private-artifacts/drive-approval/templates` and the redacted
  `.codewith/private-artifacts/drive-approval/drive-approval-request-packet.json`.
  Current request packet status is `templates_ready`: 14 Drive approval-note
  templates are available, one per aggregate Drive queue decision. Templates are
  not approvals; they carry only aggregate queue context, source doc hashes,
  title/task hashes, row-count hints, allowed actions, and non-mutation
  boundaries.
- `validate_drive_approval_notes.py` now validates completed private Drive
  approval-note artifacts and writes
  `.codewith/private-artifacts/drive-approval/drive-approval-notes-summary.json`.
  Current status is `missing_required`: 0 Drive approval-note artifacts are
  present, 14 required Drive decisions are missing, 0 invalid notes exist, and
  0 Drive decisions are approved. The summary omits approval-note text and
  exposes only decision IDs, status, approval-note hashes when present, queue
  context status, and source artifact hashes.
- `verify_drive_approval_notes.py` now verifies the Drive request packet and
  notes summary independently. It checks template-file hashes, current Drive
  queue source hashes, request-packet source freshness, required-decision
  consistency, non-mutation attestation, and redaction. Current verification
  status is `ok`: packet status `templates_ready`, notes status
  `missing_required`, 14 templates, no errors, and no warnings.
- `verify_operator_approval_evidence_bundle.py` is now the final one-command
  aggregate check for the operator approval chain. It reruns dashboard,
  approval-request, Drive approval queue, Drive approval-note,
  approval-intake, post-approval command-plan, post-approval runner-summary,
  extraction-readiness, stage, adversarial-packet, adversarial-results,
  replacement, and blocker verifiers in-process, allows only the two known
  replacement cyclic warnings,
  scans the refreshed aggregate artifacts,
  approval-intake readiness artifact, post-approval command plan plus verifier,
  post-approval runner summary plus verifier, Drive approval queue/request/note
  artifacts, and
  reviewer prompts/results for sensitive markers, and writes
  `.codewith/private-artifacts/operator-approval-evidence-bundle-verification.json`.
  Current bundle status is `operator_approval_required`: 5 dashboard decisions
  are ready, 20 ready tasks are visible, 19 are approval tasks, 14 are
  Drive/ACL/organization approvals, 1 is deferred media, 0 non-approval
  non-media tasks are ready, the Drive queue verifier reports 14 Drive approval
  tasks with status `operator_drive_approval_required`, the Drive approval-note
  verifier reports 14 templates and notes status `missing_required`,
  extraction readiness status is `pending_completion`,
  approval-intake status is `missing_required`, post-approval plan status is
  `blocked_no_unlocked_decisions`, post-approval run status is
  `dry_run_blocked`, post-approval execution is not allowed, two reviewers are
  present, the adversarial review remains `reviewed_with_blockers` with 12
  blockers, and the bundle verifier has no errors or warnings.
- Rerun adversarial reviews after batching/rate-limit/full-scale runner changes.

Extractor status changes:

- PDF smoke now classifies `ready`, `malformed_pdf`, `password_protected`,
  and `skipped_size`.
- Office extraction now writes flat UTF-8 text plus an optional private
  `.office.structured.json` sidecar with bounded block/table structure. The
  per-file artifact runner uses that sidecar to build semantic review summaries
  without exposing full private Office content in shared output.
- Archive smoke now classifies `ready`, `tool_required`, `unsupported`, and
  `skipped_size`; 7z/rar rows are routed instead of treated as broken files.
- Image/scanned-document lane now routes through
  `scripts/extract_image_ocr.py`, which writes private OCR JSON/text artifacts
  when `tesseract` is available and otherwise records explicit
  OCR/vision/human-review routing without failing the lane. The image adapter
  now includes EXIF orientation when available, confidence, human-review
  routing, and optional private `.image.vision-request.json` artifacts for
  approved vision-provider passes when OCR is missing, empty, or low-signal.
- Design/raw lanes now write safe metadata artifacts, optional private
  ImageMagick preview PNG sidecars when the tool exists, and private
  approval-required `.design.vision-request.json` artifacts for approved vision
  or human-review routing. Unknown lanes write safe metadata artifacts.
- Audio and video lanes now produce `tool_required` routes when ffprobe/ffmpeg
  are unavailable.
- Unsupported lanes now produce explicit runner routes so the corpus map can
  separate "not built yet" from "extractor failed."

Large-file extraction planning:

```txt
script: .codewith/skills/open-files-corpus-reader/scripts/plan_large_file_extraction.py
validator: .codewith/skills/open-files-corpus-reader/scripts/validate_large_file_extraction_plan.py
approval packet: .codewith/skills/open-files-corpus-reader/scripts/build_large_file_approval_packet.py
runner: .codewith/skills/open-files-corpus-reader/scripts/run_large_file_extraction_plan.py
post-run verifier: .codewith/skills/open-files-corpus-reader/scripts/verify_large_file_extraction_run.py
collector: .codewith/skills/open-files-corpus-reader/scripts/collect_large_file_review_manifest.py
threshold: > 1 MiB
execution default: dry-run only; no downloads/extractors run unless --execute
  is passed
approval: required before any heavy worker executes; current plan is not
  approved
runner gates: validates plan first, refuses unapproved execution, enforces
  selected-byte/download/artifact caps, captures extractor stdout/stderr in
  private job directories, and removes downloaded source files by default
runner private results: contain file IDs and review artifact paths only in
  private JSONL; public summaries expose selected/result private ID hashes
verifier gates: validates plan, checks public summary redaction, selected/result
  private hash coverage, result counts, duplicate private IDs, and optional
  review artifact existence
private artifacts: 21 shard manifests under .codewith/private-artifacts
redaction: shared plan omits file IDs, filenames, paths, object keys,
  source refs, OCR text, transcripts, and row payloads

jobs planned: 5,061
bytes planned: 59,998,803,166
validation status: ok
duplicate private file IDs: 0
plan sensitive marker hits: 0
plan private ID leaks: 0

large-image-metadata-ocr-vision-review: 3,554 files / 13,934,149,031 bytes
large-pdf-windowed-text: 650 files / 4,256,807,155 bytes
large-design-raw-metadata-preview: 587 files / 25,594,179,976 bytes
large-office-private-conversion: 213 files / 451,865,724 bytes
large-archive-inventory-only: 38 files / 11,400,978,274 bytes
large-unknown-metadata-human-review: 19 files / 4,360,823,006 bytes

runner dry-run smoke:
selected jobs: 25
selected bytes: 16,668,913,021
selected shards: 1
execute requested: false
results: 25 skipped / 0 launched
validation: ok

balanced non-audio canary plan:
threshold: > 1 MiB and <= 10 MiB
lanes: archive, office, PDF
selection: max 3 jobs per lane, 9 jobs total
selected bytes: 32,516,425
validation: ok
duplicate private file IDs: 0
plan private ID leaks: 0
execute requested: false
results: 9 skipped / 0 launched
selected private ID hash: recorded in dry-run summary
dry-run verifier status: ok
dry-run verifier result rows seen: 0
dry-run verifier sensitive marker hits: 0
dry-run verification output:
  .codewith/private-artifacts/large-file-canary-balanced-nonaudio/large-file-dry-run-verification.json

approval packet:
output: .codewith/private-artifacts/large-file-canary-balanced-nonaudio/large-file-approval-packet.json
approval required: true
validation status: ok
recommended canary: 9 jobs / 41,943,040 selected bytes cap
execute cap: 26,214,400 bytes per download / 268,435,456 artifact bytes
post-run verifier command: verify_large_file_extraction_run.py --require-complete --check-review-artifacts
collector command: collect_large_file_review_manifest.py after verifier passes
public artifact privacy check: approval packet, dry-run summary, dry-run
  verification, and validation summary contain no file_id keys, private file-id
  values, open-files source refs, object keys, extracted text, or transcripts

review-manifest collection smoke:
input: dry-run output directory
job dirs seen: 0
review jobs written: 0
status: empty
```
