# Changelog

All notable changes to `@hasna/computers` are documented here.

## [0.1.0] - 2026-07-24

First publish to npm.

- Durable, policy-controlled computers for AI employees.
- CLI (`computers`), plus `computers-serve`, `computers-mcp`, `computers-worker`,
  `computers-resident`, `computers-migrate`.
- Durable operations with idempotency-key replay, policy generations, and a
  provider readiness surface (`local_machine`, `local_vm`, `aws_ec2`).
- `computers-serve` and `computers-mcp` fail closed without hashed bearer config.

### Notes

- `publishConfig.provenance` is intentionally not set: releases are currently cut
  from an operator machine, which cannot produce a sigstore attestation. Setting it
  would advertise provenance the registry does not carry. Re-enable it only together
  with publishing from GitHub Actions via OIDC.
