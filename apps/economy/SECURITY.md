# Security Policy

## Supported Versions

Security fixes are handled for the latest published versions of `@hasna/economy` and `@hasna/economy-sdk`.

## Reporting A Vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for `hasna/economy` when available. If that is not available, open a minimal GitHub issue that says you need a private security contact without including exploit details.

Do not include secrets, access tokens, private database contents, or exploit payloads in public issues, pull requests, logs, screenshots, or package artifacts.

## Expected Response

Hasna maintainers will triage reports based on impact, affected package versions, exploitability, and whether user data or credentials can be exposed. Confirmed vulnerabilities are fixed in source, validated with focused tests, and released through the normal package process.

## Scope

In scope:

- credential or token exposure;
- unsafe package contents;
- auth, account, or tenant boundary bypasses;
- remote code execution or command injection;
- unintended publication of local databases or private telemetry.

Out of scope:

- attacks requiring direct write access to a user's local Economy database;
- reports based only on dependency age without a demonstrated vulnerable path;
- denial-of-service reports that require unbounded local filesystem control.
