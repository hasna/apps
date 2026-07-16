# Security policy

`@hasna/cli` 0.2.x is private software. Report vulnerabilities privately to the Hasna security team or through the private GitHub repository's security-advisory flow. Do not open a public issue containing credentials, candidate data, exploit details, or internal endpoints.

Supported versions are the latest internal 0.2.x release only. Reports should include the CLI version, operating system, affected command, redacted reproduction steps, and impact. Never include tokens, passwords, encrypted credential files, application exports, or secret-manager output.

The CLI does not promise that terminal output is non-sensitive. Authentication token creation/rotation and careers application reads can intentionally return sensitive data. Operators must protect shell history, CI logs, redirected output, and generated CSV files.

## Security invariants

- no bearer token is stored in plaintext configuration;
- secrets are not accepted in process arguments;
- optional two-factor codes are read only from an explicitly named environment variable;
- child processes are launched without a shell;
- remote provider JavaScript is disabled;
- high-impact changes require a short-lived, single-use deterministic plan digest and confirmation;
- HTTPS is mandatory except for explicitly opted-in loopback development;
- non-public and reserved destinations are rejected after DNS resolution and the checked address is pinned;
- unknown or misplaced flags fail before side effects;
- remote response bodies are bounded and server-controlled messages/details are never reflected;
- machine-readable errors preserve only a bounded request ID for correlation, never underlying exception text or credentials.
- redirects are never followed and all 3xx responses are typed remote failures;
- plan reservations prevent concurrent apply and cannot be reset by identical replanning, even past plan expiry or after a CLI crash. Network, TLS, timeout, redirect, 5xx, and incomplete/invalid/unclassified remote outcomes remain ambiguous and are never automatically released or reclaimed. Only validated non-application statuses consume a failed reservation; otherwise a private operator must verify remote state before using confirmed `plans resolve`, which performs no API request. Settlement lock retries are bounded, and an unrecorded successful remote result fails closed with exit 9 rather than inviting an automatic replay.
