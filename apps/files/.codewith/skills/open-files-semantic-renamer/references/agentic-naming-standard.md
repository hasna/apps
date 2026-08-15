# Agentic File Naming Standard

This standard is for open-files virtual names and target paths. It is based on current file-management, metadata, and RAG guidance reviewed on 2026-06-16.

## Online Guidance Used

- OpenAI File Search supports metadata filtering on files, which means names should work with structured metadata rather than replace it: https://developers.openai.com/api/docs/guides/tools-file-search
- Microsoft Azure AI Search RAG guidance emphasizes chunking, vectorization, and retrieving the best chunks, so names should help provenance/citation but not carry all semantic load: https://learn.microsoft.com/en-us/azure/search/retrieval-augmented-generation-overview
- Microsoft semantic chunking guidance emphasizes headings/document structure for higher quality retrieval: https://learn.microsoft.com/en-us/azure/search/search-how-to-semantic-chunking
- AWS Bedrock metadata filtering guidance emphasizes scalable access control and filtering across units: https://aws.amazon.com/blogs/machine-learning/multi-tenancy-in-rag-applications-in-a-single-amazon-bedrock-knowledge-base-with-metadata-filtering/
- NIST RDaF treats metadata and provenance as essential for reuse and preservation: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/1500-18/NIST.SP.1500-18r2.html
- Harvard Biomedical Data Management recommends identifying metadata, using conventions per file set, and versioning: https://datamanagement.hms.harvard.edu/plan-design/file-naming-conventions
- C2PA/Content Credentials emphasize provenance metadata for media authenticity: https://c2pa.org/ and https://spec.c2pa.org/specifications/specifications/2.4/explainer/Explainer.html

## Pattern

Use:

```text
{owner}/{domain-or-project}/{yyyy-mm-dd?}-{entity?}-{subject}-{document-kind}-{status?}-v{nn?}.{ext}
```

Rules:

- Use lowercase kebab-case for virtual target paths and filenames.
- Use ASCII letters, digits, and hyphens in generated names.
- Use `/` only as a virtual folder separator, never inside a segment.
- Keep names human-readable and citation-friendly.
- Keep the stable business terms near the front: owner, entity/project, subject, kind.
- Use ISO dates as `yyyy-mm-dd` only when the date is meaningful: contract date, invoice date, board meeting date, campaign date, shoot date.
- Put status near the end: `draft`, `final`, `signed`, `executed`, `approved`, `archived`.
- Use `v02`, `v03` for intentional versions. Do not infer version from duplicate copies unless evidence supports it.
- Preserve original name/path in provenance fields.
- Store sensitive specifics in metadata only when a public/citation filename would leak private data.

Examples:

```text
finance/invoices/2026-05-acme-cloud-invoice-final.pdf
legal/contracts/2026-03-14-vendor-msa-executed.pdf
people/hiring/2026-02-product-designer-offer-letter-signed.pdf
marketing-sales/campaigns/2026-q2-landing-page-copy-final.docx
product/research/2026-01-user-interviews-summary.pdf
archive/external-devices/2023-photo-backup-inventory.csv
intake/unassigned/needs-review-asset-7f3a2c91.pdf
```

## Confidence Levels

- `high`: extracted text or structured metadata clearly identifies entity, kind, date, and status.
- `medium`: enough context for a useful name, but one component is inferred.
- `low`: filename/path only, image-only scan without OCR, unclear archive, or mixed folder.

Low-confidence names must stay proposals.

## Proposal JSONL Contract

Agents should write one JSON object per reviewed file:

```json
{
  "file_id": "f_...",
  "canonical_name": "2026-05-vendor-invoice-final.pdf",
  "target_path": "finance/invoices/2026-05-vendor-invoice-final.pdf",
  "document_kind": "invoice",
  "confidence": "medium",
  "requires_review": true,
  "evidence_summary": "Short private-local rationale; do not quote sensitive file contents in shared chat.",
  "model": "provider/model"
}
```

Required validation:

- `target_path` uses lowercase kebab-case path segments.
- `canonical_name` is a filename, not a path.
- `confidence` is `high`, `medium`, or `low`.
- `low` confidence always sets `requires_review: true`.
- Duplicate target paths must be resolved before apply.
