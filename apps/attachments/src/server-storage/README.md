# Application-owned PostgreSQL storage

The query, TLS, migration-ledger and health helpers originated in the existing
@hasna/contracts 0.8.2 kit at repository base 5d2fcfb02cc7a06d3f36c40b9c51141e1bc993dc.
They are now application-owned source, not an unmodified generated registry kit.
The retired local/cloud mode resolver and conditional pool factory were removed.
The pool validates the explicit PostgreSQL DSN and retains the original TLS rules.
Public health errors are deliberately redacted.

The owner-directed HTTPS/PostgreSQL boundary and independently reviewed Contracts
7ab022d87b48fd15f0ce1831fc560e0651b8c232 informed this adaptation. No unpublished
Contracts files or invented registry version are used. The existing published
Contracts dependency remains for authentication, SDK generation and artifact scanning.
Adoption of the released canonical shared kit is a separate, release-blocking step.

The live PostgreSQL tests exercise this exact pool, migration ledger and PgAttachmentsStore.
Without an explicitly supplied disposable test database, live integration is unverified.
