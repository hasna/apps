---
id: "switcher-adapter-coverage"
title: "Switcher adapter coverage and acceptance matrix"
type: "verification-matrix"
owner: "codex-fixer"
created_at: "2026-09-06T06:41:25.915207+00:00"
updated_at: "2026-09-06T17:11:49.882018+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

Switcher **0.1.2 is published, installed and live-tested**. [PR #1836](https://github.com/hasna/apps/pull/1836) merged reviewed source `61c0ca1b241043567bd7349a2810012db9c41b46` as `24681fa7552584c39c6bbcf7107faa6dd2f885e3` after all nine checks passed; the optional external review was skipped. npm publication at `2026-09-06T16:47:17.965Z` has SHA-1 `3952926c933700c8e5a56130bc3cb3c56bb01969`. All 50 installed package files match. Normal station commands report 0.1.2; ordinary npm resolution uses Contracts 1.0.2 without its optional Secrets/Events/Paths chain. The previous installation and quarantine policy remain intact.

This matrix distinguishes supported wire contracts, controlled native fixtures, real-provider execution and native catalog interfaces. A compatible endpoint does not establish every model's tool support, entitlement or reasoning behavior. M = Anthropic Messages; R = OpenAI Responses; C = OpenAI Chat Completions; G = native Gemini generateContent.

## Installed registry live matrix

All rows below used the normal installed `switcher` command, built-in credential resolution/discovery and task-owned ephemeral tmux. Each read an unseen proof file, then resumed in a fresh process after deletion with no new tools and the same native session. Aider instead verified its real file-context/edit/history interface: an actual target edit followed by history recall after deleting both files. Exit codes, run finalization and owned launch-state/process cleanup passed. Models/providers are the exact finite tested combinations.

| Harness / native version | Backend | Provider / selected model | Wire | Registry result |
| --- | --- | --- | --- | --- |
| Claude Code 2.1.263 | Direct | DeepSeek / deepseek-v4-flash | M | Read + deleted-file resume pass |
| Codex 0.153.4 | Direct | OpenRouter / anthropic/claude-haiku-4.5 | R | Read + deleted-file resume pass |
| Grok Build 1.0.13 | Direct | DeepSeek / deepseek-v4-flash | M | Read + deleted-file resume pass |
| OpenCode 2 beta-19157 | Direct | DeepSeek / deepseek-v4-flash | M | Read + deleted-file resume pass; resumed proof had extra formatting |
| Pi 0.85.1 | Direct | DeepSeek / deepseek-v4-flash | C | Read + same-session resume pass |
| OMP 18.1.11 | Direct | DeepSeek / deepseek-v4-flash | C | Read + same-session resume pass |
| DeepSeek Harness 0.1.2-rc.1 | Direct ACP | DeepSeek / deepseek-v4-flash | M | Permissioned read + same-session resume pass |
| Cline 3.0.61 | Direct ACP | DeepSeek / deepseek-v4-flash | M | Permissioned read + same-session resume pass |
| Hermes 0.21.0 | Direct | DeepSeek / deepseek-v4-flash | C | Read + same-session resume pass |
| Prime Agent 0.9.2 | Direct | DeepSeek / deepseek-v4-flash | C | Native ipython read + same-session resume pass |
| Legacy OpenCode 1.18.29 | Direct | DeepSeek / deepseek-v4-flash | C | Read + same-session resume pass |
| Kilo 7.5.15 | Direct | DeepSeek / deepseek-v4-flash | C | Read + same-session resume pass |
| Gemini CLI 0.58.0 | Direct | Gemini / gemini-3.1-flash-lite | G | Read + same-session resume pass |
| Aider 0.86.2 | Direct | DeepSeek / deepseek-v4-flash | C | Target edit + deleted-file history recall pass |
| Codex 0.153.4 | Ori 0.12.1 | OpenRouter / anthropic/claude-haiku-4.5 | R | Read + resume pass; first proof had extra formatting |
| Grok Build 1.0.13 | Ori 0.12.1 | OpenRouter / anthropic/claude-haiku-4.5 | C | Read + deleted-file resume pass |

The proof-token checks and strict whole-answer checks are distinct. No response-format retry was used for the two passing core/Ori variations. Kilo's separately retained unsuccessful exact-answer attempt and stale tmux socket-node check were followed by a bounded corrected cell. Gemini's first isolated project was untrusted; a fresh owned fixture was explicitly trusted without changing global trust or permission policy, then passed. Legacy OpenCode's successful stage was retained. No credential or account rotation occurred. Native usage reports and Switcher profile/run model fields are not independent proof of provider billing.

Actual OMP and Prime native processes overlapped by 2.569 seconds using separate homes/databases and the same provider. Shared-database concurrency is covered by deterministic SQLite/PostgreSQL process fixtures; the paid overlap does not establish shared-database native concurrency. Owned acceptance resources were cleaned and the original user `switcher-deepseek` session was preserved.

## Catalog and native-interface boundaries

Switcher keeps the complete discovered provider inventory in its CLI/API and gives each harness the compatible subset through its supported native interface. It preserves exact IDs and metadata provenance; unknown capability fields remain unknown. These dated counts are observations, never constants:

- Registry Codex `model/list` returned exactly 363 compatible IDs from 581 OpenRouter entries. This is a native API observation, not a visual TUI inspection.
- Registry OpenCode 2's visual picker displayed all three discovered DeepSeek IDs: `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp` and `deepseek-v4-pro`. Selecting Pro changed the native status display without inference.
- Registry Cline/DSH ACP returned all three DeepSeek models and confirmed another model before switching back for the paid request. Registry OMP/Prime API inventory and Flash/Pro plans also matched; Pro plans were dry-run only. Controlled native fixtures separately verify exact second-model requests.
- Registry Kilo/legacy OpenCode discovered all three DeepSeek IDs. Their native catalog equality and second-request contracts have controlled fixture evidence; Switcher profile/run selection records are not relabeled as captured provider requests.
- Registry Gemini retained all 54 authenticated provider models. Historical candidate `453bc3d6` additionally verified the native loader's 40 eligible IDs and retention of 14 explicitly incompatible generation-method entries in the API. The final source and registry package contract tests preserve that filtering; a visual Gemini TUI was not inspected. `generateContent` alone does not prove text output or tool capability.
- Claude's compatible model mapping/picker and Grok's catalogs have native fixture coverage; Claude with third-party non-Claude models is outside Anthropic's official support. Ori owns its entitled OpenRouter catalog. Pi scopes native picker/cycling, while diagnostic listings can include global definitions.
- Hermes keeps native free-provider/MOA rows visible alongside the selected-provider inventory. Aider's listings include built-in definitions. These native lists cannot truthfully be described as containing only the selected provider.

## Controlled native contracts and limits

The required four adapters have parser-aware routing authority, process-scoped configuration and shared terminal/signal/timeout coverage. OpenCode 2 additionally covers hostile global/project/per-model/per-agent routing and preserved JSONC/YAML instructions/permissions. Grok's launch-state removal remains independent of bridge cleanup rejection. Native subscription credentials are never extracted or pooled. Credential diagnostics report observable missing/inaccessible/lookup and upstream authorization failures; distinguishing revoked from expired or stale/rotation metadata is a separately open diagnostic extension, not an inferred meaning of HTTP401/403.

| Adapter | Additional controlled contract | Material boundary |
| --- | --- | --- |
| OMP | C/R/M; six auth/no-auth paths; native RPC catalog/read/resume/second requests | Literal api-key Messages uses the authenticated loopback bridge |
| DeepSeek Harness | C/R/M native ACP; nine protocol/auth cells; web catalog/auth/origin/trust/shutdown | Headless one-shot starts a new task; SDK/custom profiles rejected; image attachment round-trip and Linux native behavior unverified |
| Cline | C/R/M permissioned ACP read/resume/catalog/session-set-model | Native permission requests remain active; acceptance granted only the fixture-file operation |
| Hermes | C/R/M ordinary chat, native read/resume, inventory/second selection | DeepSeek Chat auxiliary title generation can warn HTTP400 for unsupported json_schema; main tool loop/history and fallback naming succeed |
| Prime Agent | C/R/M catalog/selection; foreground readiness; six signal orderings; long-path fallback | Native Unix socket length limits still apply |
| Legacy OpenCode | C/R/M read/resume/catalog; JSONC/root/agent policy and argument authority | Separate executable/schema from OpenCode 2 |
| Kilo | C/R/M read/resume/catalog; Yargs authority, native permissions and interruption/cleanup | Native project MCP can use the ephemeral bridge token; the upstream credential stays in the parent |
| Gemini CLI | Native G; transport/config/import/trust negatives, concurrency and timeout143 | Exactly 0.58.0 is guarded; conflicting transport and ACP reject; native private-home/context boundaries apply |
| Aider | C/R/M; 16 native context/edit/history/catalog checks | Exactly 0.86.2 is guarded; no autonomous Read function/native session ID; Responses is buffered |

The common bridge forwards the chosen wire rather than translating between M/R/C. Tests cover changed boundaries, stream cancellation and tool/usage/reasoning preservation. This does not promise every provider's advanced parallel-tool, image or reasoning feature, nor cross-provider session migration. Raw native stdout/PTY belongs to the native client. POSIX lifecycle tests do not establish Windows parity, cleanup after parent SIGKILL or control of deliberately escaped process groups. [Adapter contribution contract](CONTRIBUTING-ADAPTERS.md).

## API, SDK and self-hosting acceptance

The published source passed 167 package tests / 1,799 assertions including PostgreSQL and native opt-ins, 147 root tests / 560 assertions, 43 affected builds, frozen locks and generated/manifest/secret/artifact guards. Registry Node 26.8.1 and Bun 1.3.14 CLI/API/SDK/server/standalone MCP surfaces passed; no Hasna MCP server was registered in a coding agent.

The exact reviewed runtime bytes passed SQLite/PostgreSQL Compose tests on image `sha256:2f0b14538018bd556ba92351a186910861dec28ec98ec1fbe1a2318f3a4a491f`. Both backends preserved two providers, eleven profiles and eleven run records plus generation-method metadata through 0.1.1→0.1.2→container recreation→0.1.1→0.1.2. Old clients read data but refuse unsupported new harness writes and metadata-bearing updates. Linux runtime credential injection and missing-value rejection passed; native macOS/Keychain-backed vault launches are separate evidence. Owned test containers/networks/volumes/listeners were removed; the user's VM and services were preserved.

The local API is a same-version in-process service owned by each CLI command, using ephemeral loopback ports and in-memory operator credentials. Its connection idle timeout is not an automatic service shutdown timer. Explicit remote configuration never falls back silently. Self-hosting uses `switcher-serve`; the local launcher remains responsible for local native execution.

## Provider and account access

The 24 presets cover DeepSeek, OpenRouter, Anthropic, OpenAI, xAI, Ollama, LM Studio, Groq, Cerebras, Mistral, Together, Fireworks, Moonshot/Kimi, DashScope, Z.AI, MiniMax, SiliconFlow, vLLM, LiteLLM, Gemini, Azure and explicit generic M/R/C endpoints. Registry notes define actual protocols, auth, prefixes and discovery. Deterministic parser/route/auth tests do not establish paid account entitlement.

Gemini native G uses x-goog-api-key; Google's compatible Chat route uses Bearer at `/v1beta/openai`. Azure v1 C/R uses the operator's `/openai/v1` resource and literal `api-key`, verified by native Codex fixtures. **Azure requires actual deployment names**, supplied manually or through an explicit deployment-aware catalog. Foundation-model definitions are not deployment inventory. Bedrock/Vertex native identity adapters are not provided by generic gateways.

| Provider group | Recorded acceptance | Remaining prerequisite or limit |
| --- | --- | --- |
| DeepSeek, OpenRouter, Gemini native | Published 0.1.2 registry live rows above and authenticated discovery | Only the listed models/routes were exercised |
| OpenAI | Historical candidate 453bc3d6: authenticated 133-model catalog, Codex/gpt-5-nano read/fresh-resume pass; this provider test was not in tmux | Not a registry-3952926c OpenAI replay or all-model entitlement claim |
| xAI | Historical candidate 453bc3d6: authenticated 12-model catalog, Grok/grok-4.20-0309-non-reasoning read/deleted-file resume in owned tmux | Not a registry-3952926c xAI replay |
| Anthropic | Historical candidate: authenticated 11-model catalog; direct Claude inference returned insufficient credits before tools, cost zero | Funded purpose-appropriate account needed; no retry/account switch/billing change performed |
| Groq, Mistral, Cerebras | Catalog-only observations: 14, 46 and 3 models respectively; first two refs belong to other projects, Cerebras ref is archived | Technical catalog access is not approved current paid access; provenance review required |
| Fireworks, Moonshot/Kimi, DashScope/Qwen, Z.AI, MiniMax | Preset/schema and credential-reference inventory only where present | Usable purpose-appropriate credential, account/region/workspace and truthful catalog contract as applicable |
| Together, SiliconFlow, Azure | No usable approved deployment/account established by this inventory | Credential; Azure also resource endpoint and deployment inventory |
| Google-compatible Chat | Distinct route/auth contract fixtures | Account/model live acceptance on that route |
| Bedrock, Vertex | Native cloud contracts explicitly separate; metadata alone is not runtime identity | Verified credential type/expiry, region or project/location, model access and native invocation adapter |
| Ollama, LM Studio, vLLM, LiteLLM/generic gateways | Compatible endpoint/auth/prefix fixtures | Reachable deployment, installed model and required tool/parser capability; auth where configured |

Unauthenticated controls for the historical Anthropic/OpenAI/xAI catalog probes returned HTTP401. No provider credential values were recorded. Scopes/expiry/account billing are not inferred from successful catalog calls. Missing access is an explicit external acceptance prerequisite, not a skipped success or evidence of a parser defect.

## Evidence and history

The [evidence index](docs/verification-evidence.json) binds exact source/archive identity, independent reviews, package/container results and each registry live report. Paths resolve under `~/Workspace/scratch/universal-harness-switcher`; they are retained local evidence, not relative links to nonexistent public repository files. Historical snapshots keep their original identities.

Release 0.1.1 passed its seven-path registry matrix under archive `fe0aee17e92a46d2500bbc69f85d53ecda4b22ed` at `2026-09-06T13:22:44.352Z` ([PR #1810](https://github.com/hasna/apps/pull/1810)). Expanded baseline `8bbf262f` and rejected SDK-error candidate `453bc3d6` were never published. Their reports are historical; the latter's credential-reflection defect was corrected and independently rechecked before publishing `3952926c`.

The release documentation follow-up remains subject to independent review and PR CI. External access prerequisites and optional native cloud-auth/translation/remote-worker extensions stay visible in [TODOS.md](TODOS.md); they are not silently counted as live successes.
