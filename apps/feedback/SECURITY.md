# Security

Open Feedback may receive user-submitted text and application context. Treat stored feedback as sensitive product data.

## Secrets

- Do not hardcode API tokens or credentials.
- Use `FEEDBACK_API_TOKEN` to protect non-local deployments.
- Do not commit local feedback exports, `.env` files, `.secrets/`, or `.connect/`.
- Rotate any credential that appears in logs, feedback text, screenshots, or exported JSONL.

## Built-in Redaction

The validator redacts common API-key and token patterns in submitted text and redacts values under sensitive metadata keys such as `token`, `secret`, `password`, `authorization`, and `cookie`.

Redaction is a defense-in-depth measure, not a replacement for upstream secret hygiene.

## Reporting Vulnerabilities

Open a private security advisory or contact the maintainers through the Hasna security channel. Do not file public issues with exploit details or credentials.

