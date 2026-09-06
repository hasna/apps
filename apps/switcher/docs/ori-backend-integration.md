---
id: "switcher-ori-backend-integration"
title: "Switcher optional Ori backend integration contract"
type: "integration-contract"
owner: "codex-fixer"
created_at: "2026-09-06T11:06:49+03:00"
updated_at: "2026-09-06T11:06:49+03:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Scope

`src/ori-backend.ts` is an optional inspection and launch-plan seam for the
installed Ori 0.12.1 CLI. It is deliberately independent of Switcher's current
domain, harness and launcher modules. The parent owns credential resolution,
process lifecycle, signals, exit status and cleanup.

## Provider and catalog boundary

Ori receives exactly the `openrouter` provider, an explicit
`https://openrouter.ai/api/v1` authority, and a target-compatible native
protocol. `oriProviderCatalog` exposes the public OpenRouter catalog URL and
the user-entitled model URL; Switcher remains the owner of fetching, filtering
and validating model metadata. Pass the selected IDs through the typed
`catalog: {source: "switcher-openrouter", modelIds}` input. No DeepSeek or
other direct provider key may be routed through Ori, and no model credential is
placed in argv, plans or files. The parent must resolve `OPENROUTER_API_KEY` in
memory and pass it through the child environment only.

## Launch contract

Call `prepareOriLaunch` with the selected OpenRouter authority, protocol,
catalog and native passthrough arguments. The generated argv is `ori <target>
--model <id> [--reasoning-effort <level>] [native args]`. Ori's verified native
flags for Codex and Grok are `--model` and `--reasoning-effort`; the adapter
does not synthesize catalog/config flags, preserving Ori's own provider/auth
configuration. `ORI_FORCE_OPENROUTER_API_KEY=1` is set only after a nonempty
process-scoped key is validated, so a noninteractive launch cannot prompt for a
different auth source.

The preservation subset supports Codex and Grok launch plans. Missing keys and
`ORI_REQUIRE_LOGIN` lockdown fail closed before any process starts. Ori's Claude
integration may update `~/.claude.json` and create Ori-managed Claude storage,
so Claude remains unsupported until an isolated Ori home/global-config proposal
is separately verified. There is no opt-in mutation flag in this adapter.

OpenCode 2 is always rejected. Ori 0.12.1's `opencode` target resolves the
legacy `opencode` executable and cannot be mapped to Switcher's `opencode2`.
The parent must retain the direct OpenCode 2 adapter and must not add an alias,
wrapper or automatic legacy fallback.

## Parent integration requirements

The parent launcher should validate provider authority and protocol before
credential resolution, call `inspectOri` and `requireOriHarness`, merge only the
returned safe environment into the shared child process, and preserve native
working directory and user arguments. It owns signals/exit status/cleanup and
must keep direct adapters available. Provider selection flags, attached `-m`
model overrides, and Codex `-c` provider/base URL overrides are rejected before
spawning a process.

Evidence for this contract is the controlled fixture test in
`tests/ori-backend.test.ts` plus the installed read-only checks (`ori --version`
and `ori harness list --json`) on the station where Ori 0.12.1 is available.

## Sources

- [OpenRouter Ori harness guide](https://openrouter.ai/docs/guides/ori/harness)
- [OpenRouter models API](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
- [OpenRouter skills launcher contract](https://github.com/OpenRouterTeam/skills/blob/main/skills/install-ori-harness/SKILL.md)
