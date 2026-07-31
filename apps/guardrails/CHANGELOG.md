# Changelog

All notable changes to `@hasna/guardrails` are documented in this file.

## 0.2.0 — unreleased

### Changed (breaking)

- `policySet.defaultDecision` is now a **fallback**, not a decision floor. It
  applies only when no rule matches. Previously it acted as a minimum, so a set
  with `defaultDecision: "deny"` denied every request regardless of which rules
  matched. A deny-by-default posture must now be expressed as a rule (for
  example a broad `deny` rule that specific `allow` rules outrank), because an
  explicit rule of any effect — including `warn` or `allow` — now wins over the
  default. **Review any policy set that sets `defaultDecision` to something
  other than `allow` before upgrading: requests it used to block may now pass.**
- `audit.decisionId` remains unique per evaluation. The deterministic content
  hash of the request now lives in the new `audit.decisionFingerprint` field, so
  repeated evaluations of the same request stay correlatable without collapsing
  into a single audit identity.

### Added

- `decision.matchedRule`: the single rule that produced the decision, alongside
  the existing `matchedPolicies` list of every effective rule.
- `decision.rationaleTrace`: per-rule match result, specificity, failed matcher
  groups, and the rationale for why each rule did or did not win.
- `audit.decisionFingerprint`: deterministic content hash of the input, policy
  set, and engine version.
- Deterministic rule ranking — effect precedence, then the number of matcher
  constraints, then the number of alternatives, then policy id — so the
  selected rule no longer depends on declaration order.
- `hasna.contract.json` declaring the repo against `hasna.service_contract.v1`
  (library class, SDK and CLI surfaces, API/MCP waived, no store).
- `scan:artifact` release gate — packs the tarball and runs the pinned
  `@hasna/contracts` artifact scan against it — wired into `prepack` and
  `prepublishOnly`.
- CI workflow running typecheck, tests, build, `repo-conformance`, `bun pm pack`
  and the artifact scan — the same gates `prepublishOnly` runs, so a branch that
  would break `npm publish` breaks the pull request instead.

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
