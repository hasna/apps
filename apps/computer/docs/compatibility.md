# Compatibility Matrix

Last checked: 2026-06-19 from the local `open-computer` source checkout.

This matrix pins the package and platform baseline for the open-computer control-plane roadmap. It is intentionally conservative: local package versions are the versions under test, while published versions show what a clean external install will currently receive.

## Package Baseline

| Role | Package | Local version | Published version | Bins | Exports | Release gate | Known blocker |
| --- | --- | ---: | ---: | --- | --- | --- | --- |
| OCCTRL | `@hasna/computer` | `0.1.13` | `0.1.12` | `computer`, `computer-mcp`, `computer-serve` | `.`, `./storage` | `bun run verify:release`, `prepublishOnly` | Local candidate is ahead of npm and includes unreleased dashboard/timeline/Playwright changes. Do not treat npm installs as containing P6/P7 dashboard work until published. |
| Browser | `@hasna/browser` | `0.4.19` | `0.4.19` | `browser`, `browser-mcp`, `browser-serve` | `.`, `./storage`, `./video`, `./extension` | `bun run verify:release`, `prepublishOnly` | Local package version matches npm. Worktree still has untracked `EXTENSION_SPEC.md`, so release evidence must be regenerated from a clean checkout before republishing. |
| Fleet | `@hasna/machines` | `0.0.46` | `0.0.48` | `machines`, `machines-mcp`, `machines-agent` | `.`, `./consumer`, `./storage` | `bun run verify:release`, `prepublishOnly` | Local checkout is behind npm. Do not publish or pin `0.0.46` as a release candidate; update/rebase to the published `0.0.48` line first. |
| Todos | `@hasna/todos` | `0.11.56` | `0.11.56` | `todos`, `todos-mcp`, `todos-serve` | `.`, `./sdk`, `./mcp`, `./registry`, `./contracts`, `./storage` | `bun run verify:release`, `prepublishOnly` | Local version matches npm. Worktree has unreleased release-gate and SDK verifier edits; regenerate release evidence before any Todo publish. |

Commands used for the published version check:

```bash
npm view @hasna/computer version
npm view @hasna/browser version
npm view @hasna/machines version
npm view @hasna/todos version
```

## Exact Compatibility Pins

These are the exact pins behind the current P7 evidence. A release dry-run may treat the "Release decision" column as policy.

| Surface | Exact tested pin | Current npm latest checked 2026-06-19 | Release decision |
| --- | --- | ---: | --- |
| `@hasna/computer` | Local tarball `0.1.13` | `0.1.12` | Candidate is ahead of npm. Publish `0.1.13` before external consumers can receive the dashboard, timeline, and packed cross-repo smoke work. |
| `@hasna/browser` | Local tarball `0.4.19` | `0.4.19` | Candidate version equals npm. Do not republish changed package metadata under `0.4.19`; bump before any browser dependency update. |
| `@hasna/machines` | Local tarball `0.0.46` | `0.0.48` | Local checkout is behind npm. Do not pin consumers to `0.0.46`; rebase/update before a strict release. |
| `@hasna/todos` | Local tarball `0.11.56` | `0.11.56` | Candidate version equals npm, but local release-gate edits need clean evidence before any publish. |
| `@hasna/events` | `@hasna/computer` `^0.1.3`, `@hasna/browser` `0.1.3`, `@hasna/machines`/`@hasna/todos` `^0.1.7` | `0.1.8` | Current repos intentionally differ. A strict cross-repo release should choose one range policy or document why browser stays exact. |
| `@modelcontextprotocol/sdk` | computer/todos `^1.12.1`, machines `^1.26.0`, browser `1.29.0` | `1.29.0` | Browser is exact-current; other repos allow older-compatible ranges. Keep MCP behavior covered by package export/bin smokes. |
| AI SDK core | `ai` `6.0.200` | `6.0.208` | Exact pin by `docs/ai-sdk-version-gate.md`; do not float during release dry-run. |
| AI SDK OpenAI provider | `@ai-sdk/openai` `3.0.69` | `3.0.73` | Exact pin by the age-safe gate; update only with focused AI SDK tests plus full build/test evidence. |
| AI SDK Anthropic provider | `@ai-sdk/anthropic` `3.0.82` | `3.0.85` | Exact pin by the age-safe gate; update only with focused AI SDK tests plus full build/test evidence. |
| Provider-native OpenAI SDK | `openai` `^4.85.0` in `@hasna/computer` | Not pinned by this matrix | P3 must replace the legacy `computer-use-preview` lane with current Responses computer-tool translation before strict provider release. |
| Provider-native Anthropic SDK | `@anthropic-ai/sdk` `^0.39.0` in computer, `0.104.1` in browser | Not pinned by this matrix | Keep beta computer-use headers/model support in docs until P3 normalizes provider-native lanes. |
| Playwright browser engine | `playwright` `1.60.0` in `@hasna/browser`; dashboard `@playwright/test`/`playwright-core` `1.60.0` | `1.61.0` | Keep `1.60.0` for current evidence. Moving to `1.61.0` requires rerunning browser release and dashboard Playwright screenshots. |
| Chromium used for dashboard evidence | Playwright Chromium `149.0.7827.0` | N/A | Current screenshot evidence is tied to this browser build. |
| Chrome extension manifest | MV3, extension/package/manifest version `0.4.19`, minimum Chrome `116` | N/A | Browser extension package and npm package versions must stay equal before publish. |
| Runtime toolchain | Bun `1.3.14`, shell Node `v22.22.2`, npm `10.9.7`, Bun verifier `process.version` `v24.3.0`, Linux `6.17.0-1014-nvidia` `aarch64` | N/A | Package evidence is valid for this toolchain. Package metadata still says Bun `>=1.0.0`, but lower Bun versions are unproven. |

## Cross-Repo Dependency Decisions

| Edge | Current declaration | P7-10 packed smoke result | Required decision before strict release |
| --- | --- | --- | --- |
| `@hasna/browser` -> `@hasna/todos` | Browser declares exact `@hasna/todos` `0.11.53`; local and npm Todo are `0.11.56`. | Temp app installed top-level `@hasna/todos` `0.11.56` and nested browser-local `@hasna/todos` `0.11.53`; smoke passed with warnings. | Either bump browser to a new version with Todo `0.11.56`, or make the browser task queue an optional dynamic bridge. Do not hide this with npm overrides in release evidence. |
| `@hasna/computer` -> browser/fleet/todos | No hard package dependency. | Packed app installed all four tarballs independently; computer imports and bins passed. | Keep optional until adapters are packaged behind stable public contracts. |
| `@hasna/machines` -> consumers | Consumers use `@hasna/machines/consumer`, contract version `1`. | Consumer conformance passed from the installed tarball using local `.bin/machines`. | Keep `scripts/consumer-conformance.mjs` in package files and release gates. |
| Todo machine metadata -> open-machines | Todo metadata remains local; machine authority is not unified. | No direct packaged edge yet. | Pick one machine identity authority before fleet/browser live validation becomes strict. |

## Runtime Baseline

| Surface | Tested value | Minimum for this roadmap | Notes |
| --- | --- | --- | --- |
| Bun | `1.3.14` | `1.3.14` for release evidence | Package metadata still says `>=1.0.0`, but P7 evidence is only valid on Bun `1.3.14` until lower versions are explicitly tested. |
| Node/npm | shell Node `v22.22.2`, Bun verifier `process.version` `v24.3.0`, npm `10.9.7` | npm capable of `npm pack`, `npm view`, and local tarball install | `verify:release` uses npm for package registry checks and clean install smoke tests. |
| OS for package tests | Linux `6.17.0-1014-nvidia` `aarch64` | Linux or macOS for package/server/storage tests | The Linux run validates package boundaries and non-UI logic only. |
| OS for real computer control | macOS with Accessibility and Screen Recording consent | macOS | Current native drivers are macOS-first. Linux fleet nodes can run package tests and remote coordination, but not full local desktop control without an additional driver. |
| Browser extension lane | Chrome/Chromium MV3 | Current Chrome/Chromium with extension support | Non-headless browser control requires the open-browser extension bridge plus a visible browser profile. Live extension screenshots remain gated by machine credentials and P8. |
| Dashboard UI tests | `@playwright/test` `1.60.0`, Chromium installed by `cd dashboard && bun run test:e2e:install` | Chromium-capable Linux/macOS node for UI evidence | `bun run test:dashboard` runs built Vite preview with fail-closed offline API mocks. Keep it as an explicit browser-ready gate, not part of default root `bun test`. |

## Provider Baseline

| Provider lane | Current external guidance | Planned integration |
| --- | --- | --- |
| OpenAI | The current guide uses the Responses API `computer` tool with `gpt-5.5`; the older `computer-use-preview` path is documented as deprecated. The GA flow returns batched `actions[]` and expects the harness to execute actions and return screenshots. | Implement first-class OpenAI Responses computer-call translation, with custom-harness fallback for local macOS and open-browser/open-machines execution. |
| Anthropic | Computer use is still beta. The current beta header for Claude Opus 4.8, Opus 4.7, Opus 4.6, Sonnet 4.6, and Opus 4.5 is `computer-use-2025-11-24`. Anthropic explicitly calls out prompt-injection risk, isolated environments, domain allowlists, and human confirmation for consequential actions. | Keep Anthropic as a provider-native lane and normalize actions into the same policy/approval/runtime graph used for OpenAI and AI SDK tool calls. |
| AI SDK | AI SDK exposes Computer Use tool interfaces but requires the application to implement the execution layer. AI SDK also has a provider gateway for switching providers and native human-in-the-loop tool approval patterns through `needsApproval`. | Use AI SDK as the planner/orchestrator abstraction, not as the low-level desktop driver. The execution layer remains open-computer/open-browser/open-machines with policy gates and audit. |

The AI SDK package selection is locked in `docs/ai-sdk-version-gate.md`. The current gate pins stable age-safe versions for `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, and `zod`; canaries and packages blocked by Bun minimum-release-age policy are excluded from release candidates.

## Integration Edges

| Edge | Minimum contract | Boundary rule |
| --- | --- | --- |
| `@hasna/computer` to browser/fleet/todos | Keep optional. open-computer must not hard-depend on `@hasna/browser`, `@hasna/machines`, or `@hasna/todos`. | Runtime integration uses generic resource leases such as `browser_extension_session` and `fleet_machine`; concrete adapters load through local tools, MCP, or future optional packages. |
| `@hasna/browser` to todos | Browser task queue currently expects `createTask`, `listTasks`, and `completeTask`; local browser declares `@hasna/todos` `0.11.53`. | Decide whether Todo is required package metadata or an optional dynamic bridge before publishing a browser control-plane release. |
| `@hasna/machines` to consumers | Consumers should use `@hasna/machines/consumer` and contract version `1`, not internal fleet modules. | The consumer conformance smoke is mandatory release evidence. |
| Todo machine metadata to open-machines | Todo machine fields remain task-local registry data until bridged intentionally. | Pick a single machine identity authority; current env names differ between `HASNA_MACHINES_MACHINE_ID` and `TODOS_MACHINE_NAME` / `TODOS_MACHINE_ID`. |

References checked on 2026-06-18:

- OpenAI computer use guide: `https://developers.openai.com/api/docs/guides/tools-computer-use`
- Anthropic computer use guide: `https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool`
- AI SDK Computer Use guide: `https://ai-sdk.dev/cookbook/guides/computer-use`
- AI SDK Gateway provider: `https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway`
- AI SDK human-in-the-loop guide: `https://ai-sdk.dev/cookbook/next/human-in-the-loop`

## Verification Commands

`open-computer` now owns the cross-repo verification command:

```bash
bun run verify:workspace -- --include-npm --write /tmp/occtrl-workspace-verification.json
bun run verify:workspace:release
bun run verify:packed-cross-repo -- --write /tmp/occtrl-packed-cross-repo-smoke.json
```

The command emits `open-computer.workspace-verification.v1` JSON with package metadata, npm drift, git cleanliness, release blockers, command status, exit codes, timings, and bounded output tails for each repo. `verify:workspace:release` turns release blockers into a failing exit code.

`verify:packed-cross-repo` emits `open-computer.packed-cross-repo-smoke.v1` JSON. It packs local tarballs for `@hasna/computer`, `@hasna/browser`, `@hasna/machines`, and `@hasna/todos`, installs them together in a clean temp app, imports key public exports, invokes package bins through the temp app's `node_modules/.bin` paths, starts local server/status smokes, and records dependency-alignment warnings without using global package CLIs.

Default coverage:

| Repo | Checks |
| --- | --- |
| `open-computer` | `bun run typecheck`, `bun run test` (`bun test --path-ignore-patterns='dashboard/tests/**'`), `bun run build` |
| `open-browser` | `bun run typecheck`, targeted policy/session/extension/server/MCP tests |
| `open-machines` | `bun run typecheck`, targeted compatibility/consumer/approval/screen/MCP tests, consumer conformance smoke |
| `open-todos` | `bun run typecheck`, `bun run test:no-cloud`, targeted goal/approval/headless/trust/evidence tests |

Dashboard-specific UI evidence is separate from the workspace default:

```bash
cd dashboard && bun run test:e2e:install
bun run test:dashboard
```

The current dashboard Playwright suite covers desktop mocked telemetry, API-key auth recovery, session detail/timeline rendering, polling updates without reload, stats-failure behavior, and a mobile stacked-layout screenshot smoke.

## Live Machine Validation

Use `bun run scripts/validate-live-machine.ts --machine <id> --approve-remote-validation --lab-only-remote-validation --installed-package-smoke /tmp/occtrl-installed-machine-smoke.json --write /tmp/occtrl-live-machine-validation.json --markdown /tmp/occtrl-live-machine-validation.md` from the source checkout before any screenshot or non-headless browser smoke. Without both `--approve-remote-validation` and `--lab-only-remote-validation` or their matching env vars, SSH/Tailscale probes are skipped or blocked. The command emits `open-computer.live-machine-validation.v1` JSON with route policy/audit proof, `source_checkout_lab_only` contract metadata, a `fleet_machine` lease acquire/release proof, Screen Sharing credential, remote capability, screenshot, visible-browser, extension-bridge, negative artifact, and pending-evidence results. The report separates `lab_ready`, `live_smoke_ready`, and `p8_complete`; the top-level `ready` flag follows `p8_complete` so a reachable machine cannot be mistaken for completed screenshot/sampler/package validation. Optional `--safe-action-sampler` and `--visual-review` paths ingest the remaining P8 evidence only after GUI/browser readiness exists. Sampler evidence must be fixture-only, use approved action types and fields, reject arbitrary localhost/file URLs, include screenshot hash/dimension artifacts, prove cleanup/no leftovers, and prove acquired/released `computer_display` plus `browser_extension_session` leases with `terminal_session` proof when Ghostty is opened. Visual review evidence must include a redacted selected-machine alias and screenshot hash/dimension artifacts. Run-specific machine aliases stay in generated artifacts, not in committed docs.

Packed installs expose `computer validate-machine --json --allow-failures --skip-screenshot`, which emits `open-computer.installed-machine-smoke.v1` and proves the installed CLI can run a non-destructive local readiness smoke. `bun run scripts/verify-release.ts --installed-smoke-out /tmp/occtrl-installed-machine-smoke.json` writes this exact temp-install report so the live gate can consume it. Full cross-repo remote validation remains source-checkout-only until the fleet/browser adapters are packaged behind stable public commands.

## Known Gaps

- `@hasna/computer` `0.1.13` is not published; npm consumers still receive `0.1.12` without the current dashboard timeline and Playwright work.
- `@hasna/machines` local `0.0.46` is behind published `0.0.48`; rebase/update before pinning or republishing fleet integration evidence.
- `@hasna/browser` still declares `@hasna/todos` `0.11.53` while the local Todo tarball is `0.11.56`; packed cross-repo smoke records this as dependency-alignment evidence, and P7-13 must decide whether to repin or make the bridge optional before a strict compatibility release gate.
- P8 live machine validation is not complete. The latest source-checkout run selected a redacted macOS machine alias, acquired and released the `fleet_machine` lease, passed route/screen URL/remote capability checks, and ingested installed-package smoke evidence. It remains blocked because remote screenshot capture cannot create an image from the display, Chrome visible-window query is not authorized to send Apple events to System Events, Screen Sharing credentials or an equivalent resident GUI validation path are unavailable, and the loopback browser endpoint is not the live `@hasna/browser` extension bridge.
- `open-browser` does not yet expose its task queue through the main MCP server or public package exports. Decide whether that remains internal or becomes the browser-lane control contract.
- `open-browser` and `open-todos` still have dirty/untracked worktree state, so clean release evidence must be regenerated before any publish or consumer pin.
- The current open-computer desktop driver is macOS-first. Fleet-wide "any computer" control requires additional Linux/Windows drivers or a VNC/RDP/web extension path through open-machines/open-browser.
