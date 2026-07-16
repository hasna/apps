# Threat model

## Assets and trust boundaries

Assets include API bearer tokens, login passwords, candidate PII, recruiting exports, profile configuration, app installation state, and future provider packages. Boundaries exist between the terminal and CLI process, CLI and operating-system keychain, encrypted credential file, cweb HTTPS API, package registry, and future provider verifier.

The local user and operating system are trusted. Repository content, command input files, API responses, DNS, package metadata, and future provider packages are untrusted. A compromised local account can read process memory and is outside the protection offered by local encryption.

## Principal threats and controls

| Threat | Control |
| --- | --- |
| Token disclosure in config | Config stores only `env:`, `keychain:`, or `encrypted-file:` references; files are `0600`. |
| Secret disclosure in argv/process list | Passwords/passphrases use hidden prompts or stdin; optional 2FA uses an explicitly named environment variable; keychain writes use stdin; child processes use `shell:false`. |
| Malicious input/state files | Size/schema checks, no-follow opens, single-link ownership/mode checks, unpredictable exclusive temporary files, fsync, and atomic rename. |
| Accidental destructive mutation | Strict flag allowlists, dry-run, scoped idempotency/precondition headers, and short-lived single-use plans for high-impact actions. |
| Remote code execution from app discovery | 0.2.0 has a static built-in provider registry and no remote loader or shell lifecycle hooks. |
| Provider substitution in a future registry | Provider SDK reserves pinned package integrity and Ed25519 signature metadata; loading stays disabled until verification is implemented and reviewed. |
| API impersonation, SSRF, rebinding, or downgrade | HTTPS by default; explicit loopback opt-in; 3xx rejection; non-public/reserved address rejection after DNS resolution; checked-address pinning; OpenAPI title/minimum-semver/operation validation. |
| Candidate-data leakage | Private no-store server endpoints, redacted list APIs, `0600` atomic CSV output, explicit output warning. |
| Error/response-based secret leakage or exhaustion | Bounded responses and generic status-derived errors suppress server-controlled messages/details while retaining request IDs. |
| Concurrent apply or replay after state change | Digest binds operation, target, request, profile, API origin, org, provider/API revision. Atomic in-flight reservations reject concurrency, release only on transient transport failure, consume on success/definitive response, and expire. Server idempotency and version preconditions cover API races. |

## Residual risk

Environment variables can be read by same-user processes on some platforms. Terminal and JSON output can contain one-time token or candidate data. The macOS `security` and Linux `secret-tool` programs are trusted operating-system components. Encrypted-file security depends on passphrase strength. Certificate pinning is intentionally not implemented; the platform trust store is authoritative.
