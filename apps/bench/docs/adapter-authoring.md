# Adapter Authoring

Adapters describe how open-bench would run and parse an external benchmark. In this release, adapters are declarative and dry-run safe; they do not execute external benchmark code.

## Adapter Contract

An adapter should define:

- install metadata: package type, package name, install command or notes
- supported execution modes
- dry-run command sample
- required environment variable names, not secret values
- expected output artifacts
- parse mode and projected metric ids
- safety metadata copied from the benchmark manifest

The adapter must have one corresponding `bench.manifest.v1` entry in the seed registry.

## Safety Requirements

Use fail-closed metadata:

- Network-required runners must set `runner.requiresNetwork`.
- Generated-code, browser, Docker, or repository-test runners must require sandboxing.
- Provider-calling benchmarks must declare `requiresSecrets`.
- High-cost benchmarks must require an explicit `maxCostUsd` limit.
- Expected artifacts should be specific enough to support checksums and parser tests.

Never include credential values in adapter commands, examples, test fixtures, docs, or evidence.

## Parser Requirements

Parser work should include:

- fixture outputs with representative success and failure cases
- metric id mapping tests
- parser warnings for missing optional fields
- artifact checksum recording
- evidence manifest checks for package version, manifest hash, source hash, command hash, policy, and redaction findings

## Validation Checklist

Run:

```bash
bun run typecheck
bun test
bun run build
bun run pack:check
```

For safety-sensitive changes, add an adversarial review before release.
