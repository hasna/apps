# Security policy

`@hasna/cli` 0.2.x is private software. Report vulnerabilities privately to the Hasna security team or through the private GitHub repository's security-advisory flow. Do not open a public issue containing credentials, candidate data, exploit details, or internal endpoints.

Supported versions are the latest internal 0.2.x release only. Reports should include the CLI version, operating system, affected command, redacted reproduction steps, and impact. Never include tokens, passwords, encrypted credential files, application exports, or secret-manager output.

The CLI does not promise that terminal output is non-sensitive. Authentication token creation/rotation and careers application reads can intentionally return sensitive data. Operators must protect shell history, CI logs, redirected output, and generated CSV files.

## Security invariants

- no bearer token is stored in plaintext configuration;
- secrets are not accepted in process arguments;
- child processes are launched without a shell;
- remote provider JavaScript is disabled;
- app/account changes require an exact deterministic plan digest and confirmation;
- HTTPS is mandatory except for loopback development;
- machine-readable errors never include underlying exception text or credentials.
