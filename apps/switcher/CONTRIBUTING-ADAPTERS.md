---
id: "switcher-contributing-adapters"
title: "Contributing a native harness adapter"
type: "contributor-guide"
owner: "codex-fixer"
created_at: "2026-09-06T16:06:19.269815+00:00"
updated_at: "2026-09-06T17:11:49.882018+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
source_commit: "61c0ca1b241043567bd7349a2810012db9c41b46"
---

This guide describes the existing Switcher adapter interfaces and verification contract. An adapter launches a supported native CLI with the selected provider, exact model and native policies. It does not add a runtime plugin framework.

## Existing interfaces

`src/harness-types.ts` derives `HarnessId` from the profile schema. `HarnessLaunchInput` supplies the harness, provider base URL/protocol/auth style, exact selected model, compatible catalog, in-memory credential, executable/arguments, cwd, per-launch state directory, detected version and optional durable session directory.

`PreparedLaunch` returns:

```ts
{
  executable: string;
  args: string[];
  env: Record<string, string>;
  configPaths: string[];
  warnings: string[];
  beforeLaunch?: () => Promise<void>;
  cleanup?: () => Promise<void>;
}
```

`src/harnesses.ts` dispatches preparation, with dedicated backend/configuration modules where needed. `src/launcher.ts` obtains the API plan, resolves credentials, owns run metadata and state, and calls the shared `runHarnessProcess`. Keep process groups, terminal handling, signal status and timeout ownership in `src/harness-process.ts`; do not create a second general runner inside an adapter. A native daemon prerequisite may use the existing `beforeLaunch` readiness/cleanup contract, as Prime does.

## Routing and native policy

1. Define the harness ID and supported wire/auth combinations in the domain contract. Update generated OpenAPI/SDK artifacts when the public schema changes. Reject unsupported direct, saved-profile, SDK and dry-run configurations through the existing shared validation path; validate a returned launch plan again.
2. Add detection/installation guidance and a version guard based on the actual native parser/configuration interface. Detection uses the credential-free child environment. Do not infer flags from a related or renamed CLI. Extend the parser-aware argument guard, preserving literal arguments and required option values while reserving native routing overrides.
3. Generate the full compatible catalog with exact upstream IDs. Preserve unknown capabilities as unknown. Keep any alias explicit and reversible; verify native second-model selection reaches that exact upstream model. A diagnostic listing, eventual native catalog and visual picker are different observations.
4. Establish native configuration precedence from installed source and fixtures. Global/project/per-agent settings must not override the selected endpoint, auth or model. Preserve supported instruction imports, workspace trust and permissions; do not silently grant trust or broaden approvals. Snapshot only safe configuration through the existing adapter-specific mechanisms, and reject conflicts that cannot preserve the selected contract.
5. Never write provider credentials to generated settings, argv or run records. Use the existing credential resolver and child-environment boundary. Where the native client cannot preserve upstream authority, use the authenticated loopback bridge with a short-lived native token and a parent-held upstream credential. The bridge admits catalog IDs and the selected wire route; it does not authorize arbitrary destinations.
6. Keep generated settings per launch and session storage stable where native history requires it. Cleanup must release owned listeners/readers/processes and be safe to repeat. Failed preparation must release resources allocated before returning `PreparedLaunch`. The launcher removes launch state in `finally`, including when prepared cleanup rejects. Never remove an unrelated native database, user setting or process.

## Native versions

These are the guards at the audited source, alongside the concrete native versions used in recorded acceptance. A minimum-version guard does not mean every newer version has been tested.

| Harness | Guard | Recorded native version |
|---|---|---|
| Claude | ≥2.1.242 | 2.1.263 |
| Codex | ≥0.153.0 | 0.153.4 |
| Grok | ≥1.0.13 | 1.0.13 |
| OpenCode 2 | beta-19157 or ≥2.0.0 | beta-19157 |
| Pi | ≥0.85.1 | 0.85.1 |
| OMP | ≥18.1.11 | 18.1.11 |
| DSH | ≥0.1.2-rc.1 under the explicit prerelease check | 0.1.2-rc.1 |
| Cline | ≥3.0.61 | 3.0.61 |
| Hermes | ≥0.21.0 | 0.21.0 |
| Prime Agent | ≥0.9.2 | 0.9.2 |
| Legacy OpenCode | ≥1.18.0 | 1.18.29 |
| Kilo | ≥7.5.15 | 7.5.15 |
| Gemini CLI | exactly 0.58.0 | 0.58.0 |
| Aider | exactly 0.86.2 | 0.86.2 |

Ori is a separate optional backend with an inspected 0.12.1 contract for its supported Codex/Grok and OpenRouter subset. Do not register an unsupported Ori harness merely because a native executable exists.

## Verification and evidence

Use the pinned Bun 1.3.14 and installed native executable in an owned scratch fixture. Existing tests cover shared domain, argument, environment, launcher, bridge, terminal and storage behavior. Reuse that coverage; add a new regression when an adapter introduces a distinct branch or reproduces a defect. A missing adapter-specific test name is not proof that the shared behavior is broken.

For each advertised native route, the meaningful fixture launches through the Switcher CLI, verifies exact path/auth/model, requests a unique fixture-file read or the native equivalent, deletes the file, then starts a fresh process to verify same-session recall without new tools. Aider uses its actual file-context/edit/history interface, not an invented read function or session ID. Include full native catalog equality and second selection, a hostile routing/policy negative where applicable, bounded cancellation, and owned cleanup. Permission grants must be limited to the intended fixture operation; never enable blanket approval to make a test pass.

The package exposes `test:native-*` scripts for the installed adapters, including `test:native-opencode2-authority`, `test:native-grok-resume`, `test:native-dsh`, `test:native-dsh-web`, `test:native-cline`, `test:native-hermes`, `test:native-gemini`, `test:native-aider` and the OMP/Kilo/legacy checks. Read the selected script's executable environment variable rather than assuming all use the same one. Set `SWITCHER_TEST_ROOT` to owned Workspace scratch. These fixtures use controlled providers; paid provider acceptance is a separately authorized installed-package test.

Run proportionate focused tests, `bun run verify`, the real PostgreSQL gate when storage/launch contracts are affected, and `bun run scan:artifact`. Follow repository root/affected-build and independent exact-commit review requirements before integration. Record source commit, native version, artifact hashes, request/model/session assertions and cleanup. Distinguish source fixtures, ordinary npm candidate installation and published registry bytes; none substitutes for another.

## Payload and platform limits

The common bridge forwards the selected Messages, Responses or Chat wire unchanged, apart from explicit model alias/auth handling. It is not a general cross-protocol translator. Preserve tool IDs/arguments/results and opaque usage/reasoning events at any boundary the adapter changes. Verify representative advanced features only when advertised; API compatibility or a generation-method name alone does not establish tool, image or text-output capability.

Keep known native limits explicit: Aider's Responses path is buffered; cross-provider reasoning/session migration is not supplied; DSH image attachment round-trip remains unverified; some native diagnostic catalogs include built-ins or become available asynchronously. Native stdout/PTY remains under the native client's control. POSIX process-group/terminal tests do not establish Windows parity or guarantee cleanup after the parent is SIGKILLed or a descendant deliberately leaves its owned group. Refer to `COMPATIBILITY.md` for the actual tested platform/provider/candidate boundaries.
