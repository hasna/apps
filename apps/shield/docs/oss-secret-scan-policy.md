# Publishable OSS Secret-Scan Policy

This policy applies to publishable Hasna OSS packages: package repositories with
a non-private `package.json` intended for public npm or public GitHub release.

## Required Gates

Every publishable repo must provide:

- `check:secrets` package script that runs a real redacted repository-only
  secret scan, such as `shield secrets`, `shield oss-secrets-policy`,
  `gitleaks`, or `trufflehog`.
- A prepublish or prepack script that runs `check:secrets` before build or
  artifact packing.
- A release script or CI workflow that runs `check:secrets` or directly runs an
  accepted scanner command.

The preferred script is:

```json
"check:secrets": "shield secrets . --repo-only --format terminal --fail-on high"
```

Repos with unavoidable scanner fixtures should use the allowlist-aware policy
gate instead:

```json
"check:secrets": "shield oss-secrets-policy . --strict"
```

The terminal and JSON outputs must include path, rule id, severity, and counts
only. Secret values, snippets, command output, process output, and pane history
must not be printed in CI, release logs, task evidence, issues, or pull
requests.

## Fixture Policy

Scanner fixtures must use invalid synthetic material. If a live-shaped fixture
is unavoidable, it must be narrowly allowlisted in
`security/oss-secret-allowlist.json`:

```json
{
  "version": 1,
  "entries": [
    {
      "path": "tests/fixtures/scanner-token.test.ts",
      "rule_id": "github-token",
      "owner": "@hasna/example",
      "reason": "invalid synthetic scanner fixture",
      "expires_at": "2026-10-01"
    }
  ]
}
```

Allowlist entries without `rule_id`, `owner`, `reason`, or `expires_at` are
invalid. Paths must target fixture-like files or directories, such as
`tests/`, `fixtures/`, `mocks/`, `samples/`, or `*.test.*`. Expired allowlist
entries fail policy.

Vendored or upstream fixtures may be excluded only when their path clearly
identifies the source, such as `vendor/`, `third_party/`, `test/data/`, or
`tests/fixtures/upstream/`. New vendored exclusions should preserve upstream
license and provenance notes.

## Public Path Hygiene

Public docs, scripts, examples, workflows, and package metadata must not include
personal home directories or private machine hostnames. Use placeholders such as
`/path/to/workspace`, `$HOME/workspace`, `example-host`, or
`machine-example` instead of Linux or macOS operator-specific home paths.

## Inventory Command

Run a redacted inventory over one or more workspace roots:

```bash
shield oss-secrets-policy /path/to/opensource --strict
shield oss-secrets-policy /path/to/opensource --include-noncanonical --json
```

The command reports publishable repo inventory, gate status, vendored/upstream
fixture counts, allowlisted fixture counts, unsuppressed secret-shaped files,
and public path or hostname files. It does not emit secret values or source
snippets.
