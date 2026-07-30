# Changelog

All notable changes to `@hasna/guardrails` are documented in this file.

## Unreleased

### Added

- `hasna.contract.json` declaring the repo against `hasna.service_contract.v1`
  (library class, SDK and CLI surfaces, API/MCP waived, no store).
- `scan:artifact` release gate — packs the tarball and runs the pinned
  `@hasna/contracts` artifact scan against it — wired into `prepack` and
  `prepublishOnly`.
- CI workflow running typecheck, tests, build, `repo-conformance`, `bun pm pack`
  and the artifact scan.

### Removed

- The `open-guardrails` bin alias. The repo was renamed to `guardrails`, and the
  service contract allowlists `<name>` plus its documented suffixes only. Use
  the `guardrails` bin.

## 0.1.0 — 2026-07-24

First published release (initial npm publish of the existing `main` line).

### Added

- Local-first guardrail policy evaluator (`evaluateGuardrail`) with `allow`,
  `deny`, `warn`, `redact`, and `approval_required` decisions.
- Default starter policy set covering secret redaction, destructive shell
  command approval, remote-content-piped-to-shell denial, expensive model
  routing warnings, external-source trust warnings, and high-impact
  business-action approval.
- Zod-backed input/policy schemas, policy loader, and redaction helpers.
- Integration input helpers for sibling tools (terminal, dispatch, MCP,
  gateway, router, browser/computer use, business operations).
- `guardrails` CLI (`evaluate`, `validate`, `version`, `help`) with JSON output
  and status-derived exit codes (0 allow/warn/redact, 1 deny/invalid,
  2 approval required).

### Packaging

- Point `repository`, `homepage`, and `bugs` at `hasna/guardrails` (the repo was
  renamed from `open-guardrails`).
- Add `publishConfig.access: "public"` so the scoped package publishes publicly.
