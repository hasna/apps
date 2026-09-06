---
id: "switcher-adapter-coverage"
title: "Switcher adapter coverage and acceptance matrix"
type: "verification-matrix"
owner: "codex-fixer"
created_at: "2026-09-06T06:41:25.915207+00:00"
updated_at: "2026-09-06T14:02:36.227431+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

Switcher 0.1.1 is published and registry accepted. Expanded adapters are being integrated for 0.1.2; their fixture results are not features of the published 0.1.1 package. This matrix distinguishes advertised wire contracts, controlled native tests and real-provider acceptance. It does not imply that every provider model works in every harness.

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

## Expanded native adapters: controlled evidence, unpublished

All rows below use official installed native software and synthetic credentials against owned loopback fixtures. Each still needs the common next-release acceptance below. An earlier source review does not approve uncommitted integration changes.

| Adapter / tested native | Controlled evidence | Material boundary / shortest remaining adapter check |
| --- | --- | --- |
| OMP 18.1.11 | Exact `658b1551` + reviewed followup; six C/R/M auth/no-auth cells, real read, deleted-file fresh resume; native RPC returns both provider models and selects the second | Preserve corrected shared grammar/minimum version in final source; repeat representative installed-package read/resume and exact native RPC catalog |
| DeepSeek Harness 0.1.2-rc.1 | Exact `c3235ef7` independently approved; author nine protocol/auth ACP cells; parent Messages/bearer read/resume and web catalog/401/403/loopback cleanup; integrated ACP/web replays | Distinct from Claude+DeepSeek. Web/ACP resume; headless starts a fresh task. SDK/custom profiles rejected. Repeat installed ACP read/resume and web auth/cleanup; image attachment round-trip and Linux remain unverified |
| Cline 3.0.61 | Exact `86b5964b` independently approved; C/R/M source CLI/native permissioned read, deleted-file fresh resume, full catalog, selected route/auth and AGENTS | Repeat packaged ACP/session path with permission grant; final shared-launch/config-isolation regression remains a release gate |
| Hermes 0.21.0 | Exact `3f32e765` approved; C/R/M ordinary chat oneshot read/deleted-file resume and instruction preservation. Integrated native provider inventory equals both selected-provider models; second-model selection succeeds without inference | Native UI retains built-in free-provider/MOA entries; do not claim exclusive picker contents. Repeat installed chat/resume and selected-provider inventory; do not use top-level native -z as an approval-preserving fixture |
| Prime Agent 0.9.2 | Foreground-supervisor correction and protocol fixtures; independent `ecb0931d` passes all six signal/callback orders. Integrated long-TMPDIR fallback passes actual ipython file read/deletion/fresh continuation and owned cleanup. Native RPC returns exactly two models, switches to the second, then sends one authenticated request for that model | Bind final integrated fallback/portable-test corrections to a clean commit. Repeat installed read/resume; retain delayed-start, same-turn cancellation and explicit unsupported-long-path negatives |
| Aider 0.86.2 | Exact `33f985ab` independently approved; C/R/M native file edits, deleted-file history restoration, model listing/second selection, hostile config suppression; six auth-style plus no-auth probes | File context/whole-file edits are its native behavior, not an autonomous read function tool. Responses output is buffered. Repeat installed edit/history and advertised native model listing; interactive/Linux remain unverified |
| Legacy OpenCode 1.18.29 | Exact `3005ca2f` parent C/R/M read/deleted-file same-session resume and exact native models diagnostic; corrected JSONC/root/agent deny checks; later foundation delta integrated | Distinct executable and singular-provider schema from OpenCode 2. Bind final integrated policy/argument corrections to exact source, then repeat installed tool/resume and diagnostic catalog; visual picker remains separate |
| Gemini CLI 0.58.0 | Exact hardening `6bfa6364`: six actual native source CLI launches cover file read, second model, deleted-file fresh resume, concurrent sessions, user deny and global/project imports; exact two-ID native loader catalog. Original argv/config/trust attacks reject | G with x-goog-api-key only; parent-held upstream key. Parent integrated native/adversarial replays pass, including six launches, zero-request routing rejection, untrusted exit55/no hook and timeout exit143 with upstream/listener cleanup. Bind final integrated source, then packaged tool/resume/catalog. ACP and conflicting model transport config reject; private-home/context limitations remain explicit |
| Kilo 7.5.15 | Official native interface and three-protocol WIP fixtures exist; late legacy-MCP startup and token inheritance reproduced | **Guard correction `96678360` is being integrated/reviewed; final acceptance remains open.** No native disable control proven durable. A parent-held bridge can withhold the upstream key, but native project MCP shares its temporary bridge authority. Do not count WIP as shipped or all isolation controls solved |

Parent followups supersede the earlier Gemini/Prime failures: [Gemini six-launch result](../parent-gemini/expanded/native/source-cli-KkESw9/result.json), [args](../parent-gemini/expanded/counter-pID892/result.json), [routing](../parent-gemini/expanded/config-counter-ZZNbkU/result.json), [trust](../parent-gemini/expanded/trust-counter-LGWBqY/result.json), [timeout143](../parent-gemini/expanded/cancel-SuFlhF/result.json); [Prime long-path read/resume](../parent-prime/fallback-cli-fixture.log), [exact native catalog](../parent-prime/expanded-catalog-shared-home.log), [actual switched-model request](../parent-prime/expanded-second-request.log). The Prime result's legacy `unexpected` field contains the deliberately requested second-model inference; `secondModelInferenceVerified:true` identifies the intended positive assertion.

The linked [evidence index](docs/verification-evidence.json) records the exact reviewed sources and later integration checkpoints. Model-list APIs, visual pickers and actual inference selection are separate observations; a no-inference second-model selection does not become a paid model call.

## Providers and cloud access

Published presets cover DeepSeek, OpenRouter, Anthropic, OpenAI, xAI, Ollama, LM Studio, Groq, Cerebras, Mistral, Together, Fireworks, Moonshot/Kimi, DashScope, Z.AI, MiniMax, SiliconFlow, vLLM, LiteLLM and generic M/R/C endpoints. The typed registry's per-route notes remain authoritative for protocol, auth, discovery and prefixes. Parser/auth/prefix fixtures establish those contracts; the seven live rows above establish live acceptance only for their specific paths.

Expanded Gemini provider routes remain distinct: native G uses x-goog-api-key; Google's OpenAI-compatible C endpoint uses Bearer and `/v1beta/openai`. Expanded Azure v1 C/R uses a user-specified `/openai/v1` resource URL and literal `api-key`; an actual Codex fixture emitted that header and exact deployment ID. **Azure requires real deployment names supplied manually or by an explicit deployment-aware catalog.** Its foundation-model listing is not a deployment inventory. Both provider additions require final integrated checks and real access acceptance.

| Access group | What the existing inventory establishes | Remaining prerequisite |
| --- | --- | --- |
| DeepSeek, OpenRouter | Actual protected vault resolution and registry live paths pass | Reuse bounded accepted paths for release regression; no new key setup inferred |
| Anthropic, OpenAI, xAI, Groq, Cerebras, Mistral, Fireworks, Moonshot/Kimi, DashScope/Qwen, Z.AI/Zhipu, MiniMax, Gemini | Candidate secret references exist; some are archived, notes or admin metadata | Validate a relevant authorized provider credential/account through the resolver; metadata is not proof of validity, entitlement or paid-call access. Fireworks also needs account scope; DashScope needs region/workspace; Z.AI needs a truthful explicit catalog contract |
| Together, SiliconFlow, Azure | No matching references in this inventory | Locate/provide a usable approved credential reference. Azure additionally needs resource endpoint and deployment inventory; absence in one inventory is not proof no key exists anywhere |
| Bedrock | API-key/bearer-token and expiry/identifier metadata | Verify actual credential type/expiry, region, model access and invocation contract. Native cloud adapter is not implemented by these metadata records |
| Vertex | OAuth client ID/secret metadata only | Establish an applicable runtime identity/token flow, project, location and model permissions. An OAuth client secret is not ADC or an access token; direct cloud adapter remains open |
| Ollama, LM Studio, vLLM, LiteLLM/generic gateways | Explicit endpoint contracts/fixtures; no running deployment established by credential inventory | A reachable configured local/server deployment, actual model availability and required native tool parser/capabilities; auth where configured |

The inventory explicitly says `valuesRead:false`; no credentials were read or validated by this documentation audit. Missing cloud access is an external acceptance prerequisite, not a skipped success and not evidence that the provider parser is defective. Generic gateways may satisfy an explicitly configured compatible wire path; they do not silently add Bedrock/Vertex native authentication or cross-protocol translation.

## Finite next-release acceptance

1. Bind the passing integrated Gemini and Prime corrections to the final clean source; finish Kilo guard integration/review and any remaining combined regressions. Preserve the native authority, permission and owned-process contracts.
2. On one exact expanded candidate, run package/generated/build/artifact/storage checks and required root/affected/CI gates. Repeat existing deterministic native fixtures for changed protocol/auth paths, with explicit negative routes, permission preservation and cleanup. Final source identity binds earlier unaffected evidence.
3. Install that candidate normally and run one bounded native task plus fresh-process resume per new adapter using a supported provider/model. Check its full compatible catalog and second selection using a native API/diagnostic where that is the supported interface. Use a protocol-specific extra cell only where it exercises a distinct changed adapter contract. DSH additionally retains its small web auth/cleanup check; Aider uses edit/history semantics. Shared launcher changes warrant the existing seven-path core/Ori regression, not every possible provider/model combination.
4. Complete provider-specific live cells only where account/endpoint/model access exists. Record other named provider cells as blocked or unverified with the concrete prerequisite above. Do not require every provider × every model × every harness to receive paid inference, and do not promote a successful shared protocol fixture to untested live-provider coverage.
5. Apply the next patch changeset, independent release review, PR/CI/publish checks, registry byte identity and a representative installed-command repetition. Preserve documented upstream limits and leave the overall expanded task open until its named acceptance scope is satisfied.
