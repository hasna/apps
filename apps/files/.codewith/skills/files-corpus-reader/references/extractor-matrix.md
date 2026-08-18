# Open Files Extractor Matrix

Use this as the coverage matrix before reading or classifying a corpus.

| Lane | MIME/examples | Current path | Required next tool |
| --- | --- | --- | --- |
| text | `text/*`, markdown, CSV, JSON, YAML, XML, HTML, SQL, SVG | `files extract-text` | none |
| PDF | `application/pdf` | `scripts/extract_pdf_text.py` wraps bounded `pdftotext` | AI summary/classification over extracted artifact |
| Office | DOCX, XLSX, PPTX, ODT/ODS/ODP | `scripts/extract_office_text.py` wraps LibreOffice text/html conversion and can write a private structured block/table sidecar | AI summary/classification over extracted artifact plus bounded structure summary |
| image | JPEG, PNG, HEIF, WEBP, TIFF, scans | `scripts/extract_image_ocr.py` writes bounded private OCR JSON/text artifacts when `tesseract` is available; otherwise writes routing/confidence/human-review fields plus optional private vision-request artifacts | Install `tesseract` for deterministic OCR and use an approved vision model only from queued private vision requests where OCR is missing or low-signal |
| raw/design | ARW, PSD, AI, EPS, Figma exports | `scripts/inspect_file_metadata.py` writes metadata, optional private preview PNG when ImageMagick is available, and a private approval-gated vision request artifact | preview renderer or approved vision pass |
| audio | MP3, WAV, M4A | metadata-only today | `ffmpeg` plus transcription |
| video | MP4, MOV, QuickTime | metadata-only today | `ffmpeg`, keyframes, transcription |
| archive | ZIP, tar, gz, 7z, rar | `scripts/archive_inventory.py` inventories entries without extraction; 7z/rar use `7zz`/`7z`/`7za`, `unrar`, or `bsdtar` when present. The reproducible archive worker image is in `worker-image/Dockerfile` and bakes `p7zip-full` plus `libarchive-tools`. | recursive manifest and child extraction |
| unknown | octet-stream, proprietary | metadata-only | `file`, magic sniffing, human review |

Large-file planning:

- Use `scripts/plan_large_file_extraction.py` to build private shard manifests
  for files above the active download/extraction cap.
- For first canaries, use `--max-size-bytes`, `--order size-asc` or
  `--order lane-size-asc`, and `--max-jobs-per-lane` to avoid starting with the
  largest objects or one overrepresented lane.
- Use `scripts/validate_large_file_extraction_plan.py` before any heavy worker
  executes.
- Use `scripts/build_large_file_approval_packet.py` to produce aggregate-only
  validation evidence plus dry-run, execute-canary, post-run verifier, and
  review-manifest collection commands.
- Use `scripts/run_large_file_extraction_plan.py` for dry-run or approved
  execution. It is dry-run by default, refuses unapproved execution, enforces
  selected-byte/download/artifact caps, captures extractor stdout/stderr in
  private job directories, and removes downloaded source files unless explicitly
  asked to keep them.
- Use `scripts/verify_large_file_extraction_run.py` after dry-runs or approved
  execution to verify selected/result private coverage hashes, public-summary
  redaction, result counts, and optional review-artifact existence.
- Use `scripts/collect_large_file_review_manifest.py` after an approved run to
  copy private review artifacts into a semantic review JSONL manifest for
  `run_llm_review_batch.py`.
- The planner does not download objects or run extractors.
- Shared output is aggregate-only; private shard manifests contain file IDs and
  non-name metadata needed by approved workers.
- Heavy PDF/Office/archive/image/design/unknown workers require an approved
  plan before execution.

Local tools observed on 2026-06-16:

- Available: `pdftotext`, `libreoffice`, `soffice`, `unzip`, `file`, `python3`, `node`, `bun`.
- Missing: `tesseract`, `ffmpeg`, `exiftool`, `pandoc`.

Archive worker image:

- Build with `docker build -f .codewith/skills/files-corpus-reader/worker-image/Dockerfile -t open-files-extraction-worker:archive-tools .codewith/skills/files-corpus-reader`.
- Smoke with `docker run --rm --entrypoint /usr/local/bin/open-files-archive-tools-smoke open-files-extraction-worker:archive-tools`.
- The image installs `p7zip-full` for `7z`/`7za` and `libarchive-tools` for `bsdtar`, so archive inventory has both `7z_inventory` and `rar_inventory` coverage inside the worker even when the host still lacks those tools.
- Capture the worker-produced `extraction_tool_inventory.py` output and pass it
  to `extraction_lane_readiness_gate.py --worker-tool-inventory`; the gate keeps
  host inventory honest while using worker inventory only when it improves a
  lane or clears missing blocks.

Provider inventory:

- Use `scripts/provider_inventory.py --include-vault` to report provider env var names and redacted vault hits.
- Current routing should prefer deterministic extraction before model calls.
- Use low-cost text models for extracted text summaries and naming proposals.
- Reserve OpenAI file input or vision-capable models for PDFs/images where deterministic extraction is insufficient.
- Reserve ElevenLabs STT for audio/video once `ffmpeg` or another audio isolation path exists.

Corpus mapping:

- Use `scripts/build_corpus_map.py --output-dir <private-artifacts/corpus-map>` to create a public aggregate map plus private JSONL worker map.
- The public map covers lane, semantic lane, owner, review status, ACL review status, size bucket, search-index coverage, readiness, provider requirement, next action, risk tier, recommended search document kind, lane/owner, lane/size, lane/readiness, owner/risk, and top MIME counts.
- The private JSONL contains file IDs and non-name scheduling metadata only: no filenames, paths, object keys, source refs, extracted text, transcripts, or ACL payloads.
- Use `--exclude-duplicates` only when planning survivor/canonical work. The default maps every active row and marks duplicate rows as `deferred_duplicate_preserve`.

Derived search index planning:

- Use `scripts/plan_search_index_population.py --output-dir <private-artifacts/search-index-plan>` to count active files with no ready/partial `file_search_documents` rows and write private shard manifests for extraction/index workers.
- Use `scripts/validate_search_index_population_plan.py` before any worker execution.
- Use `scripts/run_search_index_population_plan.py` for dry-run or approved execution. It is dry-run by default, refuses unapproved execution, captures extractor/indexer stdout/stderr in private job dirs, and writes derived text through `files search-index add`.
- Use `scripts/verify_search_index_population_run.py` after approved execution to compare private result coverage hashes, result counts, public-summary redaction, and optional DB search-document coverage.
- Use `scripts/build_search_index_approval_packet.py` to produce an aggregate-only approval packet with validation status, pre/post stats commands, and conservative canary execution commands.
- For repo-local runs, pass `--files-command 'bun run src/cli/index.tsx'` to `extraction_smoke_matrix.py`, search-index runners, and artifact extractors so subprocesses use the current workspace CLI and the plan DB path.
- The public plan is aggregate-only. Private shards contain file IDs plus MIME/lane/owner/status metadata, recommended search document kind, and bounded worker strategy.
- The planner does not read file contents, call providers, run extractors, or mutate SQLite.

Extraction principles:

- Prefer existing structured parsers over ad hoc byte parsing.
- Keep extracted text separate from source bytes.
- For design/raw previews, ImageMagick/convert remains the broad local preview
  capability. PIL preview is a bounded fallback for formats it can open, but it
  must not be treated as full design/raw lane coverage.
- Store provenance: source ref, file id, revision id, checksum, extractor name/version, byte/page range, created_at.
- After a bounded artifact is ready, index searchable derived text with
  `files search-index add <file-id> --kind <kind> --extractor <name> --text-file <private-artifact.txt>`.
  Use `extraction_summary`, `ocr_text`, `transcript`, `vision_summary`,
  `llm_summary`, or `semantic_metadata` as appropriate. Do not write
  `file_search_documents` directly from worker scripts.
- Use AI for interpretation and naming after deterministic extraction, not as the byte reader when a reliable parser exists.
- Emit aggregate progress; do not print private names, paths, keys, content, or transcript text in shared output.
