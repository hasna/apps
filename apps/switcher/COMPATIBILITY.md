---
id: "switcher-adapter-coverage"
title: "Switcher adapter coverage and acceptance matrix"
type: "verification-matrix"
owner: "codex-fixer"
created_at: "2026-09-06T06:41:25.915207+00:00"
updated_at: "2026-09-06T14:35:14.192834+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

Switcher 0.1.1 is published and registry accepted. Expanded adapters are implemented and candidate-accepted for 0.1.2; they are not features of the published 0.1.1 package. This matrix distinguishes advertised wire contracts, controlled native tests and real-provider acceptance. It does not imply that every provider model works in every harness.

## Published 0.1.1

PR #1810 merged as `e63213ece8be8dff2e21cdcdbd9cdd6d9fb7f857`. Published source is `0bb3d62e28ba23acb76352a8dfad9f2d5d770e50`; npm publication time is `2026-09-06T13:22:44.352Z`. Registry SHA-1 `fe0aee17e92a46d2500bbc69f85d53ecda4b22ed` matches the reviewed archive and all 38 installed files. Ordinary npm installation uses published Contracts 1.0.2 without the optional Secrets/Events/Paths chain. Earlier rejected archives remain withdrawn and are not current acceptance evidence. [Release record](../../release-candidate/switcher-release-completion.json), [registry identity](../../release-candidate/switcher-registry-consumer.json).

The actual registry-installed station command passed these seven bounded live paths. Every path performed an actual file read, then a fresh-process continuation after deleting the file; native session continuity and owned cleanup passed. M = Anthropic Messages, R = OpenAI Responses, C = OpenAI Chat Completions, G = native Gemini generateContent.

| Harness / native version | Backend | Provider / selected model | Wire | Registry live result |
| --- | --- | --- | --- | --- |
| Claude Code 2.1.263 | Direct | DeepSeek / deepseek-v4-flash | M | Read + deleted-file resume pass |
| Codex 0.153.4 | Direct | OpenRouter / anthropic/claude-haiku-4.5 | R | Read + deleted-file resume pass |
| Grok Build 1.0.13 | Direct | DeepSeek / deepseek-v4-flash | M | Read + deleted-file resume pass |
| OpenCode 2 beta-19157 | Direct | DeepSeek / deepseek-v4-flash | M | Read + deleted-file resume pass; resumed answer contained the proof with additional formatting |
| Pi 0.85.1 | Direct | DeepSeek / deepseek-v4-flash | C | Read + deleted-file same-session resume pass |
| Codex 0.153.4 | Ori 0.12.1 | OpenRouter / anthropic/claude-haiku-4.5 | R | Read + deleted-file resume pass |
| Grok Build 1.0.13 | Ori 0.12.1 | OpenRouter / anthropic/claude-haiku-4.5 | C | Read + deleted-file resume pass |

Evidence: [six core/Ori paths](../../live/registry-0.1.1/live-matrix-C5F5th/result.json), [Pi](../../live/pi-registry-fJgCLY/result.json). Claude with non-Claude models remains unsupported by Anthropic. Native usage reports are not proof of provider billing prices.

Registry-installed Codex returned exactly all **363 compatible IDs from 581 OpenRouter catalog entries** at the recorded refresh. These are dated observations, not fixed expected counts. OpenCode 2 exposed all three discovered DeepSeek IDs and selected Pro without inference. [Codex catalog](../../live/installed-codex-catalog-YUzaw0/result.json), [OpenCode picker](../parent-opencode2/picker-registry-bp732h83/result.json). Grok through Ori uses Ori's entitled OpenRouter catalog; Pi scopes its picker/cycling, while its diagnostic listing still exposes global definitions.

Node 26.8.1 and Bun 1.3.14 package CLI/API/SDK/server/standalone MCP surface tests pass from registry bytes; no MCP registration occurred. Reviewed identical candidate bytes also passed SQLite/PostgreSQL Compose persistence, 0.1.0 upgrade, rollback and re-upgrade on image `sha256:c515c2d85103d8e8fcb4aaccc5ef812725d3941196fa8ac1f775bf3ad950fd2d`. Published source includes the OpenCode 2 routing isolation, argument authority and unfinished-SSE cleanup fixes. These successes do not close later adapter-specific or cloud-provider work.

## Expanded native adapters: candidate accepted, unpublished

Source `ef217dd749c4628bead0df43c4a83b3dc8d11468` has independent reviews reconciled against 19 exact file hashes. The final 49-file archive SHA-1 is `453bc3d6180a523286ab10f0a0154316cbf75672`. Its ordinary npm installation, Node/Bun package surfaces, SQLite/PostgreSQL containers and source checks pass. PR [#1836](https://github.com/hasna/apps/pull/1836) CI and registry publication remain separate gates.

All 14 native harnesses and both Ori paths passed real-provider requests and deleted-file fresh-process continuation on the installed baseline archive `8bbf262fe7b26d6ebc0141b7b262fe1bd16bad6e`. The subsequent final delta changes Gemini generation-method metadata/filtering and documentation; 14 adapter implementation files are byte-identical to that live baseline. Final Gemini acceptance is separately repeated below. Controlled native protocol fixtures establish additional routes; they do not establish untested provider entitlement.

| Adapter / native version | Controlled native contract | Installed live baseline / material boundary |
| --- | --- | --- |
| OMP 18.1.11 | C/R/M, six auth/no-auth paths, read/resume, exact RPC catalog and second-model requests | DeepSeek read + deleted-file resume pass. Literal api-key Messages uses the public launch bridge. |
| DeepSeek Harness 0.1.2-rc.1 | C/R/M native ACP tools, catalog, second selection, history; web authentication/origin/cleanup | DeepSeek ACP read + deleted-file resume pass. Distinct from Claude using DeepSeek; headless one-shot starts a fresh task. Image attachment round-trip and Linux native behavior remain unverified. |
| Cline 3.0.61 | C/R/M native permissioned ACP read/resume, complete catalog and session/set_model request | DeepSeek read + deleted-file resume pass with an exact-file ACP permission grant. Native permission requests remain active. |
| Hermes 0.21.0 | C/R/M ordinary chat oneshot, native read/resume, selected-provider inventory and second selection | DeepSeek Chat read + deleted-file resume pass. Built-in free-provider/MOA rows remain visible. Auxiliary title generation can warn HTTP400 because native json_schema is unsupported by this Chat route; main inference and fallback naming succeed. |
| Prime Agent 0.9.2 | C/R/M catalog/model selection, foreground supervisor/readiness, long-path fallback, native read/resume and RPC second request | DeepSeek native ipython read + deleted-file continue pass. Unix socket length limits remain enforced even after fallback. |
| Legacy OpenCode 1.18.29 | C/R/M read/resume, exact native diagnostic catalog, JSONC/root/agent permissions and argument authority | DeepSeek native read + deleted-file continue pass. Uses a separate executable and schema from OpenCode 2. |
| Kilo 7.5.15 | C/R/M read/resume/catalog, reviewed Yargs authority, native permissions, concurrent interruption/cleanup | DeepSeek native read + deleted-file continue pass. Project MCP can access the ephemeral bridge capability; the upstream key remains in the parent. |
| Gemini CLI 0.58.0 | Native G; routing/config/trust/import controls, concurrency, timeout143 and exact native settings loader | Gemini gemini-3.1-flash-lite read + deleted-file resume pass on baseline and final archive. ACP and conflicting transport settings reject. Native private-home/context boundaries remain documented. |
| Aider 0.86.2 | C/R/M, 16 native file-context/edit/history/catalog checks | DeepSeek actual target edit + deleted-file history recall pass. No autonomous read function or native session ID; Responses is buffered, and model listings also include native definitions. |

On the final archive, authenticated Gemini discovery retained all **54 models** and their generation methods. **40 compatible IDs** appeared in the native model definitions/resolutions; **14 explicitly incompatible method entries** remained in the API but were ineligible for coding selection. Native Gemini read the unseen marker, then a fresh process resumed the same session after deletion with zero tools. These counts are dated observations. Native loader/picker configuration was verified headlessly; no visual TUI rendering claim is made. `generateContent` does not independently establish tool or text-output capability.

Final source verification: **152 package tests / 1,584 assertions** with real PostgreSQL and installed Pi/Ori/Gemini opt-ins, **147 root tests / 560 assertions**, **43 affected builds**, generated/manifest/secret/artifact guards and frozen locks. Final archive Node 26.8.1/Bun 1.3.14 surfaces and both Docker backends pass. Image `sha256:e2fccdf4c9e5fd80bfed936fb6b2dc24d87044a897dd53dc8eedfb9d8f43879d` preserves providers/profiles/catalogs/runs and generation methods through 0.1.1→0.1.2→0.1.1→0.1.2 and container recreation. Old 0.1.1 clients read stored data but refuse unsupported new harness writes and metadata-bearing provider updates. Owned containers, networks, volumes, tmux sessions and launch state were cleaned; the user's original session remains intact.

The [evidence index](docs/verification-evidence.json) binds the current archive, exact review hashes, baseline live records and final Gemini/container/package reports. Historical failures remain retained in scratch evidence. Model-list APIs, native selection, visual pickers and actual inference requests remain separate claims.

## Providers and cloud access

Published presets cover DeepSeek, OpenRouter, Anthropic, OpenAI, xAI, Ollama, LM Studio, Groq, Cerebras, Mistral, Together, Fireworks, Moonshot/Kimi, DashScope, Z.AI, MiniMax, SiliconFlow, vLLM, LiteLLM and generic M/R/C endpoints. The typed registry's per-route notes remain authoritative for protocol, auth, discovery and prefixes. Parser/auth/prefix fixtures establish those contracts; the seven live rows above establish live acceptance only for their specific paths.

Expanded Gemini provider routes remain distinct: native G uses x-goog-api-key; Google's OpenAI-compatible C endpoint uses Bearer and `/v1beta/openai`. Expanded Azure v1 C/R uses a user-specified `/openai/v1` resource URL and literal `api-key`; an actual Codex fixture emitted that header and exact deployment ID. **Azure requires real deployment names supplied manually or by an explicit deployment-aware catalog.** Its foundation-model listing is not a deployment inventory. Both provider additions have integrated contract checks. Native Gemini now has authenticated catalog and live tool/resume acceptance; Google-compatible Chat and Azure account/deployment acceptance remain separate.

| Access group | What the existing inventory establishes | Remaining prerequisite |
| --- | --- | --- |
| DeepSeek, OpenRouter | Actual protected vault resolution and registry live paths pass | Reuse bounded accepted paths for release regression; no new key setup inferred |
| Anthropic, OpenAI, xAI, Groq, Cerebras, Mistral, Fireworks, Moonshot/Kimi, DashScope/Qwen, Z.AI/Zhipu, MiniMax | Candidate secret references exist; some are archived, notes or admin metadata | Validate a relevant authorized provider credential/account through the resolver; metadata is not proof of validity, entitlement or paid-call access. Fireworks also needs account scope; DashScope needs region/workspace; Z.AI needs a truthful explicit catalog contract |
| Gemini | Built-in protected vault binding, authenticated 54-entry catalog and final native Flash-Lite read/resume pass | Other Google routes/models retain separate capability and entitlement requirements |
| Together, SiliconFlow, Azure | No matching references in this inventory | Locate/provide a usable approved credential reference. Azure additionally needs resource endpoint and deployment inventory; absence in one inventory is not proof no key exists anywhere |
| Bedrock | API-key/bearer-token and expiry/identifier metadata | Verify actual credential type/expiry, region, model access and invocation contract. Native cloud adapter is not implemented by these metadata records |
| Vertex | OAuth client ID/secret metadata only | Establish an applicable runtime identity/token flow, project, location and model permissions. An OAuth client secret is not ADC or an access token; direct cloud adapter remains open |
| Ollama, LM Studio, vLLM, LiteLLM/generic gateways | Explicit endpoint contracts/fixtures; no running deployment established by credential inventory | A reachable configured local/server deployment, actual model availability and required native tool parser/capabilities; auth where configured |

The original metadata-only inventory explicitly records `valuesRead:false`. Later DeepSeek, OpenRouter and Gemini runtime acceptance is identified separately; metadata-only rows are not authentication evidence. Missing cloud access is an external acceptance prerequisite, not a skipped success and not evidence that the provider parser is defective. Generic gateways may satisfy an explicitly configured compatible wire path; they do not silently add Bedrock/Vertex native authentication or cross-protocol translation.

A subsequent bounded catalog-only audit on the final candidate verified Anthropic (11 models), OpenAI (133) and xAI (12) with ordinary credential references; all three credential-free controls returned upstream HTTP401. No inference was made, and scopes, expiry, per-model entitlement and billing remain unverified. Separate Groq (14) and Mistral (46) catalog probes succeeded using references associated with other projects. Cerebras (3) responded using an explicitly archived reference; that observation establishes technical catalog access only, not current suitability for inference. No station/task-specific credential was established for those latter probes; further use is paused pending provenance/suitability review. These access observations supersede metadata-only status for exactly the stated checks.

## Finite remaining release acceptance

1. Complete PR #1836 required CI, merge the reviewed source and publish the exact accepted archive through the protected npm flow.
2. Verify registry integrity/timestamp, install the released command without weakening quarantine, and repeat representative real-provider native task/resume and model catalog acceptance from registry bytes. Earlier baseline cells remain explicitly identified; immutable source binding carries unchanged adapter evidence.
3. Validate provider-specific account/catalog access where purpose-appropriate authorized credentials exist. Record absent keys, deployments and native cloud identities as concrete prerequisites; do not require every provider × model × harness to receive paid inference or label shared protocol fixtures as live-provider success.
4. Keep unsupported native interfaces and separately identified gateway/remote-worker/cloud-auth extensions explicit. Update PLAN/TODOS/evidence together without reopening completed historical releases.
