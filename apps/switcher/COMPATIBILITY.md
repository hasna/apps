---
id: "switcher-adapter-coverage"
title: "Switcher adapter coverage and acceptance matrix"
type: "verification-matrix"
owner: "codex-fixer"
created_at: "2026-09-06T06:41:25.915207+00:00"
updated_at: "2026-09-06T09:29:38.856913+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Evidence boundaries

This matrix covers the next release in progress. Documented endpoints and successful catalog parsing do not prove inference, tool use, model switching, cancellation or resume. The earlier 0.1.0 OpenRouter tests remain historical evidence in PLAN.md/TODOS.md. None of the next-release registry-installed live cells is closed yet. The npm-installed development tarball SHA-1 `7b6c403317d1206a060a2fecacd3f870b9b5a05f` passed direct DeepSeek Pro/Flash proof-file tool loops, all three native Claude picker entries, session-only Flash selection, and Default mapping to Pro. This run used Switcher's built-in vault binding and Keychain operator with no external wrapper or manual API/catalog setup. Claude was 2.1.263; installed Secrets was 0.3.13. The tarball remains unpublished version 0.1.0; these results do not establish a new registry release.

# Native harness contracts

| Harness | Adapter version requirement / prior tested version | Native wire protocols | Catalog | Next-release acceptance |
| --- | --- | --- | --- | --- |
| Claude Code | >=2.1.242 / 2.1.263 | Messages | Per-launch modelPicker | Split-catalog fixture and development-tarball Pro/Flash tool/picker checks pass; Default mapping passes live; full cancellation, resume and registry checks open |
| Codex | >=0.153.0 / 0.153.4 | Responses | Startup ModelInfo JSON | Candidate direct and Ori tool loops plus same-session resume pass; richer metadata, final native-picker and registry checks open |
| Grok Build | >=1.0.13 / 1.0.13 | Chat, Responses, Messages | Authenticated loopback catalog | Installed development CLI passes local Messages fixture and live DeepSeek Flash tool/read/resume; exact model confirmed by native usage; remaining protocols and registry cells open |
| OpenCode 2 | Tested beta-19157 | Chat, Responses, Messages | Version 2 provider/models | Installed development CLI passes local Messages fixture and live DeepSeek Flash read-tool/resume; remaining protocols and registry cells open |
| Pi | >=0.85.1 / 0.85.1 | Chat, Responses, Messages | Per-launch models.json; provider-scoped picker/cycling | Adapter and auth/path/case-collision fixtures implemented; rigorous native proof and registry acceptance remain open |

Claude + non-Claude models remains experimental and unsupported by Anthropic. Messages, Responses and Chat are distinct protocols. A matrix intersection is a candidate for testing, not an automatic compatibility guarantee.

# Provider registry

M = Anthropic Messages, R = OpenAI Responses, C = OpenAI Chat. Default catalog parser is an OpenAI-style data array. Anthropic cursor pagination, same-origin continuation links, Ollama tags, Together arrays and Mistral capabilities have explicit parsing. Sources and per-route notes are embedded in the shared typed registry and returned by `switcher providers presets ID`.

| Provider | Implemented native routes | Default authentication | Catalog / next-release evidence |
| --- | --- | --- | --- |
| DeepSeek | M, C | Bearer; DEEPSEEK_API_KEY alias | Root `/models`, independent of `/anthropic/v1`; split-path fixture, development Claude Pro/Flash tools/picker and Grok/OpenCode Flash tools/resume pass; remaining cells open |
| OpenRouter | M, R, C | Bearer; OPENROUTER_API_KEY | Public all-modality catalog; earlier 0.1.0 live evidence only |
| Anthropic | M | x-api-key; ANTHROPIC_API_KEY | `/v1/models`, Anthropic version header and cursor pagination; live open |
| OpenAI | R, C | Bearer; OPENAI_API_KEY | `/v1/models`; live open |
| xAI | M, R, C | Bearer; XAI_API_KEY | `/v1/models`; documented routes, live open |
| Ollama | R, C | None for local server | `/api/tags`; parser fixture passes; Responses >=0.13.3, stateless only; live open |
| LM Studio | M, R, C | Optional configured token | `/v1/models`; operator URL/auth overrides; live open |
| Groq | R, C | Bearer; GROQ_API_KEY | `/openai/v1/models`; Responses beta; live open |
| Cerebras | C | Bearer; CEREBRAS_API_KEY | `/v1/models`; live open |
| Mistral | C | Bearer; MISTRAL_API_KEY | `/v1/models`, declared capabilities/context and archived status; parser fixture passes, live open |
| Together AI | C | Bearer; TOGETHER_API_KEY | `/v1/models`, native bare array, exact namespaced IDs and declared model type; parser fixture passes, live open |
| Fireworks | M, R, C | Bearer; FIREWORKS_API_KEY | Account-scoped catalog requires account ID or explicit URL; paginated counts and native vision metadata fixtures pass; live open |
| Moonshot/Kimi | C | Bearer; MOONSHOT_API_KEY | Documented `/v1/models`; route fixture passes; live open |
| DashScope | C | Bearer; DASHSCOPE_API_KEY | Explicit region/workspace catalog URL + dashscope parser; pagination fixtures pass; live open |
| Z.AI | C | Bearer; ZAI_API_KEY | No documented model-list contract; explicit catalog or manual models required; automatic-discovery/live gate open |
| MiniMax | M, C | Messages x-api-key; Chat Bearer; MINIMAX_API_KEY | `.cn` Open Platform routes, protocol-specific model catalogs; Messages fixture passes; alternate-product authority must be explicit; live open |
| SiliconFlow | C | Bearer; SILICONFLOW_API_KEY | Official SiliconCloud OpenAPI `/v1/models` data array; fixture passes; live open |
| vLLM | M, R, C | Explicit operator reference or none | Explicit inference prefix, normally `/v1`; model catalog and Messages bridge fixtures pass; deployment/tool-parser/live validation open |
| LiteLLM | M, R, C | Explicit proxy reference or none | Explicit deployment prefix; Messages stored base ends in `/v1`; separate catalog auth and real bridge POST fixtures pass; live open |
| Generic Messages | M | Explicit reference or no auth | Required URL and declared catalog contract; fixture coverage, live operator deployment open |
| Generic Responses | R | Explicit reference or no auth | Required URL and declared catalog contract; fixture coverage, live operator deployment open |
| Generic Chat | C | Explicit reference or no auth | Required URL and declared catalog contract; fixture coverage, live operator deployment open |

For every implemented row, the release gate still requires applicable native harness inference, proof-file tool loop, streaming, full catalog, actual switched request model, cancellation, restart/resume and registry-installed CLI evidence. Credential access is not inferred from a public catalog.

# Remaining provider work

| Provider family | Required work / checklist |
| --- | --- |
| vLLM | Deployment-specific URLs, declared native capabilities and live local/gateway acceptance (E09) |
| LiteLLM | Gateway endpoint/auth/discovery contract and live acceptance (E10) |
| Mistral, Together | Current presets/parsers implemented; live credentials, inference and native acceptance remain open (E11) |
| Fireworks | Account-aware catalog implemented; credential/account and live native acceptance remain open (E11) |
| Moonshot/Kimi, Qwen/DashScope | Presets and explicit regional catalog parsing implemented; live native acceptance remains open (E11) |
| Z.ai, MiniMax, SiliconFlow | Presets implemented; Z.AI automatic catalog is unsupported without a documented contract; live acceptance remains open (E11) |
| Gemini | Distinct wire/auth contract or explicitly supported gateway adapter (E12) |
| Azure OpenAI | Deployment/version/auth contract or explicit gateway adapter (E12) |
| Bedrock, Vertex | Cloud auth, region/model/deployment contracts or explicit gateway adapter (E12) |

# Remaining harness and compatibility work

| Harness/backend | Required work / checklist |
| --- | --- |
| Ori 0.12.1 | Codex/Grok backend and boundary/version/auth tests implemented; Codex candidate tool/resume passes; Grok entitled-catalog live proof and registry acceptance remain open (H01–H04) |
| Pi | Integrated direct adapter; strengthened native auth/tool/resume verification and live registry acceptance (G14) |
| Prime Agent, DeepSeek Harness | Native adapter/catalog/lifecycle verification; Ori setup is not itself a launch (G15–G16) |
| Hermes, legacy OpenCode | Distinct native adapters; legacy OpenCode is not OpenCode 2 (G17–G18) |
| OMP, Kilo, Cline | Distribution/launch/provider/model interfaces and honest catalog support (G19–G21) |
| Gemini CLI, Aider | Distinct auth/wire/config adapters and native listing limits (G22–G23) |
| Protocol translation | Explicit opt-in gateway or implemented translators, with streaming/tool/reasoning/multimodal/cancellation coverage (H05–H08) |

Built-in vault resolution passes actual installed-CLI live acceptance and SIGINT/SIGTERM subprocess cleanup tests; provider Keychain resolution has fixture coverage. Native subscription authentication, live subagent/explicit family-alias behavior, remaining process/platform and protocol/resume cells, release-image verification, CI and publication remain open in TODOS.md. Provider environment injection remains available without saving values.

Current development container checks pass for both SQLite and PostgreSQL Compose profiles: health/readiness, authentication and recreation persistence. Upgrades from the published 0.1.0 image preserve provider/profile/catalog/run history in both backends. Release-image checks remain open. Pi-integrated source has 75 passing tests/739 assertions with installed Pi/Ori checks enabled, including native terminal/lifecycle regressions; macOS and Linux tests preserve six descriptor mixes and keyboard reads from `/dev/tty`. Lifecycle and Ori exact-commit review passed. The expanded gateway source is independently reviewed; registry acceptance is pending.
