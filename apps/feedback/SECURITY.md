# Security

Open Feedback may receive user-submitted text and application context. Treat stored feedback as sensitive product data.

## Secrets

- Do not hardcode API tokens or credentials.
- Prefer `FEEDBACK_SUBMIT_TOKEN`, `FEEDBACK_READ_TOKEN`,
  `FEEDBACK_TRIAGE_TOKEN`, and `FEEDBACK_EXPORT_TOKEN` for non-local
  deployments. `FEEDBACK_API_TOKEN` remains the broad legacy fallback.
- Set `FEEDBACK_PUBLIC_SUBMIT=1` only at an intentional public collection
  boundary, and keep read, triage, and export protected.
- Do not commit local feedback exports, `.env` files, `.secrets/`, or `.connect/`.
- Rotate any credential that appears in logs, feedback text, screenshots, or exported JSONL.

## Built-in Redaction

The validator redacts common API-key and token patterns in submitted text and
URLs, and redacts values under sensitive metadata or context keys such as
`token`, `secret`, `password`, `authorization`, and `cookie`.

Redaction is a defense-in-depth measure, not a replacement for upstream secret hygiene.

## Reporting Vulnerabilities

Open a private security advisory or contact the maintainers through the Hasna security channel. Do not file public issues with exploit details or credentials.
