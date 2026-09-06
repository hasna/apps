---
id: "switcher-readme"
title: "Switcher"
type: "package-documentation"
owner: "codex-fixer"
created_at: "2026-09-05T12:50:21.698672Z"
updated_at: "2026-09-06T15:23:09.568156+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Switcher

Launch Claude Code, Codex, Grok Build, OpenCode 2, legacy OpenCode, Kilo, Pi, OMP, DeepSeek Harness, Cline, Hermes, Prime Agent, Gemini CLI or Aider with a chosen compatible provider and its model catalog. An authenticated API owns profiles and run metadata; the CLI starts the native harness on your computer. Import the same HTTP client from `@hasna/switcher/sdk`.

Requires Bun 1.3.14 or newer. Install the native harnesses separately.

Switcher never installs or upgrades a native harness. `switcher doctor` reports
the executable name, verified version requirement, upstream project and
installation guidance for every adapter. If a harness is installed outside
`PATH`, pass its trusted absolute executable path with `--executable PATH`.

| Harness | Executable and verified version | Install target | Official instructions |
| --- | --- | --- | --- |
| Claude Code | `claude`, >=2.1.242 | Claude Code official distribution | [Quickstart](https://code.claude.com/docs/en/quickstart) |
| Codex CLI | `codex`, >=0.153.0 | OpenAI Codex official distribution | [Project](https://github.com/openai/codex) |
| Grok Build | `grok`, >=1.0.13 | xAI Grok Build official project | [Project](https://github.com/xai-org/grok-build) |
| OpenCode (legacy) | `opencode`, >=1.18.0 | `opencode-ai` | [CLI guide](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/cli.mdx) |
| OpenCode 2 | `opencode2`, beta-19157 or newer (including stable >=2.0.0) | OpenCode 2 official distribution | [v2 docs](https://opencode.ai/v2/docs/) |
| Pi Coding Agent | `pi`, >=0.85.1 | `@earendil-works/pi-coding-agent` | [Coding agent README](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md) |
| OMP (oh-my-pi) | `omp`, >=18.1.11 | `@oh-my-pi/pi-coding-agent` | [Project](https://github.com/can1357/oh-my-pi) |
| DeepSeek Harness | `dsh`, >=0.1.2-rc.1 | `@deepseek-ai/dsh` | [CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md) |
| Cline | `cline`, >=3.0.61 | `cline` | [CLI project](https://github.com/cline/cline/tree/main/apps/cli) |
| Hermes Agent | `hermes`, >=0.21.0 | NousResearch Hermes Agent official installer | [Quick install](https://github.com/NousResearch/hermes-agent#quick-install) |
| Prime Agent | `prime-agent`, >=0.9.2 | PrimeIntellect versioned release artifact | [Project](https://github.com/PrimeIntellect-ai/prime-agent) |
| Gemini CLI | `gemini`, exactly 0.58.0 | `@google/gemini-cli` | [Project](https://github.com/google-gemini/gemini-cli) |
| Aider | `aider`, exactly 0.86.2 | `aider-chat` | [Installation](https://aider.chat/docs/install.html) |
| Kilo Code | `kilo`, >=7.5.15 | `@kilocode/cli` | [Release v7.5.15](https://github.com/Kilo-Org/kilocode/releases/tag/v7.5.15) |

For project distributions without a verified package command, follow the
linked upstream instructions and pass the resulting executable explicitly.
Launch rejects unsupported native versions before starting a coding session.

```sh
npm install -g @hasna/switcher
switcher --help
switcher doctor
```

## Direct launch

The direct launch flow is available from 0.1.1. The additional OMP, DeepSeek Harness, Cline, Hermes, Prime Agent, legacy OpenCode, Kilo, Gemini CLI and Aider adapters are introduced in 0.1.2. Version 0.1.0 requires explicit API/provider/profile setup.

Supply the provider key through environment injection (`DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`, or an explicit `SWITCHER_PROVIDER_*` reference), or configure a local credential binding below. Switcher never saves the value.

```sh
switcher providers presets
switcher models deepseek
switcher launch claude --provider deepseek
# Deterministic automation: choose an exact ID from the discovered catalog.
switcher launch claude --provider deepseek --model deepseek-v4-pro
switcher launch codex --provider openrouter --model anthropic/claude-sonnet-4.6
```

An interactive terminal can choose or search the catalog when `--model` is omitted. Noninteractive launches require an explicit model. `--dry-run` resolves and saves the provider/profile and fresh catalog, then prints the launch plan without starting the harness or creating a run record. Existing `switcher launch PROFILE` commands remain supported. Direct launches create or reuse records without overwriting customized providers or profiles.

When no remote API configuration is present, each CLI invocation starts an authenticated loopback API on an allocated port, stores SQLite data in `~/.hasna/switcher`, and closes its own listener on completion. Its random operator key remains in memory. Use `HASNA_SWITCHER_HOME` to choose another owner-only home, `HASNA_SWITCHER_SQLITE_PATH` for an explicit database, or `HASNA_SWITCHER_DATABASE_URL` for PostgreSQL. API and SDK data access remains HTTP.

If either remote API variable is configured, both `HASNA_SWITCHER_API_URL` and `HASNA_SWITCHER_API_KEY` are required. An unreachable or misconfigured remote API fails; it never selects a local database instead. The SDK always requires an explicitly configured API.

The registry contains DeepSeek, OpenRouter, Anthropic, OpenAI, xAI, Ollama, LM Studio, Groq, Cerebras, Mistral, Together AI, Fireworks, Moonshot/Kimi, DashScope, Z.AI, MiniMax, SiliconFlow, and generic protocol entries. `switcher providers presets ID` exposes documented routes, aliases and limitations; this is not a claim that every combination has passed live tests. Remaining adapters and acceptance gates are tracked in [TODOS.md](TODOS.md).

## Credential bindings

Bind an existing vault key once, then launch without an external wrapper. Use your vault's URL and the installed `secrets` CLI. On macOS, `--vault-account` selects the operator's `hasna.credentials.secrets.api-key` Keychain item. Without that option, inject `HASNA_SECRETS_API_KEY` for each process.

```sh
switcher credentials bind deepseek \
  --vault-key providers/deepseek/live/api_key --vault-url https://vault.example \
  --vault-account my-station
switcher credentials check deepseek
switcher launch claude --provider deepseek --model deepseek-v4-pro
```

`--vault-cli /absolute/path/to/secrets` selects a particular installation. Vault lookup uses `secrets exec` to inject the value into a short-lived receiver, which delivers it over an authenticated loopback connection. Values stay in process memory. The lookup has a 20-second deadline and owns a separate process group; it finishes before the native harness starts. Each lookup reads the vault again. Conflicting Secrets service URL configuration fails explicitly. Vault CLI bindings currently require POSIX; Windows callers can inject provider environment variables.

For provider keys already stored in macOS Keychain, use `--keychain-service SERVICE --keychain-account ACCOUNT` instead of vault options. Bindings contain only references and authorized origins under `~/.hasna/switcher/config/credential-bindings`, in owner-only files. They remain local even when Switcher uses a remote API. A configured binding takes precedence over environment aliases; an unavailable binding never falls back to another account.

`credentials list` displays bindings; `credentials remove PRESET_OR_REFERENCE` removes only the locator. Replacement requires explicit removal. Custom credential references require `--origin URL` (repeatable); preset bindings authorize their documented origins by default. `credentials check` reports availability, length and hash, not successful provider authentication. Provider credentials needed by a remote API's catalog discovery must still be configured on that server independently.

On Linux, use a vault binding without `--vault-account` and have your approved secret manager inject `HASNA_SECRETS_API_KEY` into each Switcher process. The binding records the vault URL and key locator; it stores no credential value. Alternatively, let the authenticated `secrets` CLI inject a provider credential for one command:

```sh
secrets exec providers/deepseek/live/api_key --as DEEPSEEK_API_KEY -- \
  switcher launch claude --provider deepseek --model deepseek-v4-flash --dry-run
```

Authenticate that Secrets process through your existing secret manager or service environment. `--dry-run` performs authenticated model discovery, creates provider/profile records as needed and returns a launch plan without starting the native harness or inference; remove it to launch. Every new process needs its own runtime injection. `credentials check` inspects configured bindings, not environment aliases. Keychain bindings are macOS-only; on Linux they fail with `keychain_unavailable` and recommend a vault binding or runtime environment. Native subscription/OAuth login is separate from Switcher's provider-key mode; Switcher does not import or reuse it.

## OpenCode 2 configuration

OpenCode 2 requires beta-19157 or newer. Each launch isolates its provider configuration, home, configuration directory and cache. Switcher snapshots native global and project tool permissions, safe agent prompts and permissions, and the global and working-directory ancestor `AGENTS.md` files. Provider/model overrides, agent request headers and bodies, plugins, and live configuration reloads are excluded. Unsupported permission forms, unreadable policy files and malformed JSONC or agent YAML stop the launch instead of dropping rules.

The original `XDG_DATA_HOME` is retained so existing native sessions continue to work. Switcher reads only the native database's remote-configuration registration key and, when needed, migration status; it never edits that database. Registered remote configuration or a pending legacy credential migration blocks launch because those sources could reintroduce provider settings. Use an explicitly isolated `XDG_DATA_HOME` or complete the native migration separately before launching. Path permissions using `~` or `$HOME` retain their original home-directory meaning.

For bounded installed-native checks, set `SWITCHER_TEST_NATIVE_EXECUTABLE` to OpenCode 2 and run `bun run test:native-opencode2-authority openai-chat`, `openai-responses`, or `anthropic-messages` from the package directory. These checks use local fixtures, actual file reads, deleted-file resume, an agent deny rule, and the settled native catalog.

## Pi

Pi 0.85.1 or newer supports all three wire protocols. Use `switcher launch pi --provider deepseek --model deepseek-v4-flash`. Switcher supplies the provider catalog and scopes the native picker and model cycling to that provider. Pi's `--list-models` diagnostic still lists global model definitions. Catalog IDs that differ only by letter case are rejected because Pi cannot select them unambiguously.

Pi sessions persist under Switcher state per profile; pass native `--continue` or `--session PATH` after `--`. Each launch uses a temporary Pi agent directory. Global settings, keybindings, extensions, themes and skills are not loaded, and changes to that temporary configuration disappear at exit. Project customization follows Pi's native behavior.

## OMP

OMP 18.1.11 or newer supports the three Switcher wire protocols through its native `models.yml` provider API. Switcher writes a per-launch provider catalog and `config.yml` under `PI_CODING_AGENT_DIR`, selects the exact provider-qualified model, and keeps the API key in the child environment. OMP's native project instructions, tools and permissions stay enabled. Sessions persist under the profile's Switcher-owned `--session-dir`; model, provider, profile and config overrides are reserved by the launch profile.

## DeepSeek Harness

Use the official [`@deepseek-ai/dsh`](https://github.com/deepseek-ai/deepseek-harness) executable, version 0.1.2-rc.1 or newer, with its supported Node runtime. This is the native DeepSeek Harness, separate from Claude Code using a DeepSeek provider. Switcher supplies the full coding catalog through DSH's native `llm-pi-ai` adapter, supporting Chat Completions, Responses and Messages. The selected model becomes the default for new sessions; native model choices remain available within that catalog.

```sh
# Native browser UI, bound to an allocated loopback port.
switcher launch dsh --provider deepseek --model deepseek-v4-flash
# Print the authenticated local URL without opening a browser.
switcher launch dsh --provider deepseek --model deepseek-v4-flash -- --no-open
# Native one-shot task; headless has no resume flag.
switcher launch dsh --provider deepseek --model deepseek-v4-flash -- --profile headless "Inspect this project"
# Standard ACP over stdin/stdout for a programmatic client.
switcher launch dsh --provider deepseek --model deepseek-v4-flash -- --profile acp
```

DSH sessions and attachments persist under Switcher state per launch profile. Resume through the native browser UI or ACP `session/list` and `session/resume`; a resumed session retains its native conversation and model selection. Each launch uses a temporary DSH home. Existing global profiles, settings, plugins and saved credentials are not loaded, and edits to the temporary configuration disappear on exit. Project customization remains native. Native browser authentication uses a launch URL and a host/port-bound cookie; its own temporary signing grant is removed with that home. Provider keys remain environment references in configuration.

Only the shipped `web`, `headless` and `acp` profiles are supported. SDK initialization can mount a different provider independently of the launch profile, so SDK/custom profiles and arbitrary patches are rejected. Listener overrides are also rejected. Ori's `dsh` command performs setup only and is not accepted as a launch backend.

The opt-in `test:native-dsh` script runs the actual Switcher CLI and installed DSH against local inference fixtures, verifies a real file-read tool and second-process resume after deleting the file, and rejects model choices outside the catalog. `SWITCHER_TEST_DSH_PROTOCOL` selects a wire protocol, `SWITCHER_TEST_DSH_AUTH` selects `bearer`, `x-api-key` or `none`, and `SWITCHER_TEST_DSH_MODE=headless` checks the native one-shot path. `test:native-dsh-web` checks the browser catalog, authentication, Host/Origin protections and shutdown without opening a browser. Set `SWITCHER_TEST_DSH_EXECUTABLE` to the official executable and `SWITCHER_TEST_ROOT` to an owned scratch directory. These checks do not make paid provider calls.

## Aider

The direct Aider adapter is verified with `aider-chat` 0.86.2. Install that native Python application separately and select its executable if needed. Other versions, GUI mode and Ori launching are rejected. The GUI uses a different initialization path that defaults to blanket confirmation; this adapter preserves native CLI confirmations.

```sh
switcher launch aider --provider deepseek --model deepseek-v4-flash
# Native read-only context and a bounded request; confirmations remain native.
switcher launch aider --provider deepseek --model deepseek-v4-flash -- \
  --read CONVENTIONS.md --file app.py --message "Implement the requested change."
# Continue the same profile's last closed conversation.
switcher launch aider --provider deepseek --model deepseek-v4-flash -- \
  --restore-chat-history
```

Aider uses native file context and text edit formats, rather than an autonomous file-read function tool. Text-input/output models can be selected without advertised function-tool support. Switcher registers the full catalog using `openai/ID`, `openai/responses/ID`, or `anthropic/ID`; these are Aider/LiteLLM transport names, and the provider receives its original model ID. All three protocols have installed-native edit/history fixture coverage. Chat and Messages support upstream streaming; Aider/LiteLLM buffers Responses requests even when native streaming is requested. `/models` and `--list-models` also enumerate built-in definitions; this is an available-model listing, not an isolated interactive picker. Use the full generated name with `/model`. Chat catalog IDs beginning `responses/` are rejected because LiteLLM reserves that prefix for a different transport. Responses IDs containing `responses/` are also rejected because LiteLLM removes those segments.

Every launch has a private home, configuration and cache. An authenticated loopback bridge owns the upstream key and admits only catalog model IDs. The native child receives only the temporary bridge token. Dotenv loading, provider credentials, aliases and model transport overrides are excluded; no provider key is written to native files. Original Git global configuration is loaded through Git include directives; global writes target a private file, retaining identity and repository policy. Ordinary global, Git-root and project Aider preferences retain native precedence; read-only paths using `~/` retain their original home meaning.

Preflight rejects conflicting configured startup commands, blanket approval, upgrade/test/lint/commit startup switches, ambiguous YAML/options, unreadable read-only context, custom model transport/callback settings, non-UTF-8 history and editable files belonging to a different Git root. Select the intended repository with `--cwd`. Explicit native task options and confirmations remain available. These checks do not sandbox concurrent project edits; keep native startup configuration unchanged while launching.

Aider has no session ID. Each launch writes a separate owner-only transcript under Switcher state, and `--restore-chat-history` copies the last closed conversation for that profile into a new transcript before native restoration. Concurrent runs keep independent history; diagnostic-only runs do not replace it. This does not import an existing standalone Aider transcript. Set `SWITCHER_TEST_AIDER_EXECUTABLE` and run `bun run test:native-aider` for controlled installed-native protocol, edit, history, catalog, hostile-routing and dry-run checks. Paid-provider, Linux and interactive-terminal acceptance remain separate gates.

## Gemini CLI

The native Gemini adapter supports exactly Gemini CLI 0.58.0 and the `gemini-generate-content` protocol with `x-api-key` authentication (the native wire header is `x-goog-api-key`). Use `switcher launch gemini --provider gemini --model MODEL`, selecting an ID from the discovered catalog. A compatible custom gateway must implement the same Gemini protocol and discovery contract. Chat Completions, OAuth, Vertex/ADC and Ori are separate interfaces and are not provided by this native adapter.

The API retains Gemini's full catalog and its documented `supportedGenerationMethods` metadata. Models that explicitly lack `generateContent`, such as embedding or prediction-only entries, are excluded from coding selections. Absent metadata remains unknown; support for `generateContent` alone does not establish text output or function-tool support. See the [Gemini model catalog contract](https://ai.google.dev/api/models).

Switcher holds the upstream key in an authenticated loopback bridge; the native CLI receives a temporary local token. The bridge accepts only catalog model IDs and the `generateContent`, `streamGenerateContent` and `countTokens` routes, preserves the configured deployment prefix, and cancels unfinished streams on exit. It does not allow a native client to replace the upstream endpoint or headers. Native helper requests for models outside the catalog fail closed.

Each launch gets private user, default and system settings. The complete compatible catalog replaces native picker visibility, and explicit model resolution preserves upstream IDs. Native profile sessions remain durable across fresh launches: pass `-- --resume latest --prompt PROMPT` for headless continuation. Concurrent launches share session storage but have separate configuration and native session IDs.

Workspace trust remains a native user decision; Switcher never enables it automatically. Original system/default/user settings, native user policies, project instructions and project permission handling remain active. Global Markdown context files and nested imports inside the original `.gemini` directory are copied with their import paths preserved. Context imports outside that directory, non-Markdown or nested global context filenames, symlinked configuration, and project policy paths using `~` fail explicitly; use ordinary Markdown names and explicit absolute policy paths. System/default/user and native `--policy` home paths retain their original home meaning. Private user settings, trust and policy changes disappear at exit; project changes remain native. Global extensions, custom agents, skills and keybindings are not copied into the private home.

Inherited nonempty `modelConfigs`, custom agent model transport settings and incompatible enforced authentication policies stop launch before catalog refresh or credential resolution. Keep routing configuration stable during launch; this preflight does not sandbox concurrent project edits. ACP is rejected because its client can replace authentication and routing. Normal native approval flags and literal prompt arguments remain available.

For local acceptance, set `SWITCHER_TEST_NATIVE_EXECUTABLE` to the installed Gemini executable and run `bun run test:native-gemini`. The fixture uses native plan permissions and a narrow trusted-folder entry for its owned project, verifies file reading, deleted-file resume, two concurrent sessions, global/project imports, user deny rules and cleanup. Set `SWITCHER_TEST_GEMINI_PACKAGE` to the official 0.58.0 package directory to run the native settings/catalog loader regression with `bun test`. Real-provider, interactive-terminal and Linux Gemini acceptance remain separate gates.


## Kilo

Kilo 7.5.15 or newer supports Chat Completions, Responses and Anthropic Messages through a scoped parent bridge. Use `switcher launch kilo --provider PROVIDER --model EXACT_MODEL`; pass native arguments after `--`. Switcher supplies the exact provider/model catalog and preserves supported project instructions and permission rules. Each launch uses a private native home/config/cache and profile session directory.

The upstream provider key stays in the Switcher bridge; Kilo receives only a short-lived local token. Kilo 7.5.15 can load legacy project MCP configuration, and those trusted MCP processes may inherit that scoped bridge capability. This adapter does not claim a complete MCP sandbox. Conflicting native provider/model/endpoint/auth flags, unsupported policy forms, remote instruction URLs and system-managed configuration are rejected before native launch.


## Cline, Hermes and Prime Agent

Use `switcher launch cline`, `switcher launch hermes` or `switcher launch prime-agent` with the same `--provider` and `--model` options. These adapters support Chat, Responses and Messages with full provider catalogs and per-profile native history. Cline requires 3.0.61 or newer, Hermes 0.21.0 or newer and Prime Agent 0.9.2 or newer.

Cline uses its native ACP backend with per-launch configuration, durable sessions and native permission requests. Hermes uses its native custom-provider interface and keeps `state.db` and sessions under profile state; its model menu also retains built-in free-provider/MOA entries. Prime keeps its foreground supervisor and workers within the launch lifetime. It automatically chooses a shorter private runtime directory if the system temporary path cannot hold native Unix sockets. Native history and resume remain profile-specific.

## Legacy OpenCode

`switcher launch opencode --provider PROVIDER --model MODEL` selects legacy OpenCode 1.18.0 or newer, tested with 1.18.29. It is distinct from `opencode2` and uses the legacy singular-provider configuration schema. The adapter supplies the provider catalog, preserves supported native instructions and permission rules, and stores sessions per profile. Chat, Responses and Messages have controlled native tool/read/resume coverage. Use native `models` for its full provider-qualified catalog; visual picker acceptance is recorded separately.

## Run a persistent service

Inject a random operator token of at least 24 characters as `HASNA_SWITCHER_API_KEY` through your secret manager. Inject provider credentials separately, using names beginning `SWITCHER_PROVIDER_`. Only environment references are persisted. Explicitly hosted servers read `SWITCHER_PROVIDER_*` references; the local launcher also accepts the standard aliases declared by each built-in preset.

```sh
# SQLite: persistent hosted service and database.
switcher-serve --data-dir ~/.hasna/switcher --port 8080

# PostgreSQL: inject HASNA_SWITCHER_DATABASE_URL, then:
switcher-serve --port 8080
```

Choose exactly one backend. There is no automatic fallback. Both backends run migrations and the same behavioral tests. SQLite HTTP hosting is an explicit switcher-specific product requirement; clients always use HTTP. Use PostgreSQL for multiple service instances.

Set `HASNA_SWITCHER_API_URL=http://127.0.0.1:8080` for clients and inject the operator token into each process. Remote URLs require HTTPS. The service binds loopback by default; put a TLS reverse proxy in front of an explicitly hosted listener. This release has one operator authority per service, not tenant isolation.

For containers, build the package first, then use `docker compose --profile sqlite up --build`. For PostgreSQL, inject `SWITCHER_POSTGRES_PASSWORD` and a matching URI in `HASNA_SWITCHER_DATABASE_URL` using hostname `postgres`, database/user `switcher`; run `docker compose --profile postgres up --build`. URI-encode password characters. Choose one profile. Compose exposes only loopback port 8080 and persists named volumes.

## Add a provider and launch

```sh
switcher providers add openrouter-responses --preset openrouter \
  --protocol openai-responses --credential-env SWITCHER_PROVIDER_OPENROUTER
switcher providers refresh openrouter-responses
switcher models openrouter-responses --search claude --limit 1000
switcher profiles add coding --provider openrouter-responses \
  --harness codex --model anthropic/claude-sonnet-4.6
switcher launch coding -- --help
# Interactive native launch:
switcher launch coding
```

The model ID is an example; choose an exact ID from the current catalog and verify account access. Use `--url https://provider.example/api/v1` instead of the preset for any compatible endpoint. The base URL includes the provider API version/path. Presets declare the appropriate discovery URL separately; DeepSeek discovers models at its root while Messages inference uses its Anthropic path. Select a separate provider profile for each wire protocol. The launch adapters normalize native endpoint conventions.

For Claude use `--harness claude` with `anthropic-messages`; for Grok, Hermes or OpenCode 2 use their supported protocol. Pass native arguments after `--`, such as `switcher launch coding -- exec "Reply with exactly: connected"`. `--backend direct` is the default; the optional `--backend ori` is OpenRouter-only and accepts `--ori-executable PATH`, while `--executable` remains the direct adapter option. `--cwd`, `--state-dir`, and `--timeout SECONDS` are local launcher options. Native approval and sandbox settings remain in effect. See [the Ori backend contract](https://github.com/hasna/apps/blob/main/apps/switcher/docs/ori-backend-integration.md) for its supported target and catalog boundaries.

When the API runs remotely, inject the provider credential into the API process for authenticated catalog discovery and into the local launcher for direct inference. The API never returns a provider key. An external compatible gateway can be the configured provider. Switcher does not translate between wire protocols.

## Catalog refresh and offline use

`switcher models PROVIDER` reads an existing stored catalog without contacting the provider. When no catalog exists, it discovers one. `--refresh` and every `launch` request fetch the upstream catalog. Failed refreshes preserve the previous snapshot, but launch fails instead of silently using that snapshot. API launch plans warn when their catalog is more than five minutes old.

Discovery allows at most two retries per page for network failures and HTTP 408, 425, 429, 500, 502, 503 or 504. A request has a 20-second limit and the refresh has a 60-second aggregate limit. Valid numeric or HTTP-date `Retry-After` values are honored; a delay beyond the remaining budget fails immediately. Otherwise, retry delays are 100 ms and 200 ms. Redirects and other HTTP failures are terminal. Existing limits remain 16 MiB per response, 100 pages and 10,000 unique models. Credentials, origin restrictions and parser validation stay the same on every retry.

## Optional Ori backend

`switcher launch codex --provider openrouter --model MODEL --backend ori` uses installed Ori 0.12.x. Add `--ori-executable PATH` to choose its installation. `--dry-run` validates the Ori contract without resolving a launch credential. The Codex picker uses Switcher's complete compatible catalog. Grok is supported through Ori's Chat route and its entitled OpenRouter catalog. Direct adapters remain the default. Ori launches reject other provider authorities, Claude's global-configuration mutations, and the legacy OpenCode target; use the direct Claude and OpenCode 2 adapters. Ori live acceptance remains tracked separately from fixture checks.

## Models and native pickers

| Harness | Required wire protocol | Native catalog |
| --- | --- | --- |
| Claude Code ≥2.1.242 | Anthropic Messages | Per-launch `modelPicker` on compatible Claude versions |
| Codex ≥0.153.0 | OpenAI Responses | Startup `model_catalog_json` |
| Grok Build ≥1.0.13 | Chat Completions, Responses or Messages | Authenticated loopback remote catalog with upstream model IDs |
| OpenCode 2 (tested beta-19157) | Chat Completions, Responses or Messages | Version 2 provider/model configuration and standalone server |
| Pi ≥0.85.1 | Chat, Responses, Messages | Provider-scoped native picker and model cycling |
| OMP ≥18.1.11 | Chat, Responses, Messages | Native models.yml catalog and model roles |
| DeepSeek Harness ≥0.1.2-rc.1 | Chat, Responses, Messages | Native web/ACP catalog |
| Cline ≥3.0.61 | Chat, Responses, Messages | Native ACP model catalog and session selection |
| Hermes ≥0.21.0 | Chat, Responses, Messages | Selected-provider catalog; built-in menu rows also remain |
| Prime Agent ≥0.9.2 | Chat, Responses, Messages | Native catalog, RPC selection and owned supervisor |
| Legacy OpenCode (tested 1.18.29) | Chat, Responses, Messages | Singular-provider models and native diagnostic |
| Kilo ≥7.5.15 | Chat, Responses, Messages | Native provider catalog with scoped bridge |
| Gemini CLI 0.58.0 | Gemini generateContent | Exact native dynamic model catalog |
| Aider 0.86.2 | Chat, Responses, Messages | Native available-model listing; Responses is buffered |

The CLI catalog includes all provider output modalities. Native coding pickers exclude unavailable models and those explicitly lacking a required generation method, text output or tool support; unknown metadata remains unknown. This is a capability filter, not a guarantee of successful tool use. Catalog refresh happens before every launch. Native pickers are startup snapshots, not promised live reloads. OpenCode requires a complete capability object; missing fields use text-only/tool-enabled native defaults with a warning. Its beta `models --standalone` command may return an early empty snapshot; the native `/api/model` API and interactive picker expose the settled catalog.

The Claude adapter sets `ANTHROPIC_DEFAULT_MODEL` and the default subagent model to the selected provider model. Explicit subagent definitions and managed model restrictions still apply. These follow the [native model precedence rules](https://code.claude.com/docs/en/model-config).

Claude Code with a non-Claude model is experimental and unsupported by Anthropic. Codex requires Responses, not Chat Completions. Upstream reasoning, tool schemas, context limits and stateless Responses behavior still need provider-specific validation. Switcher never silently falls back to a different provider.

For a provider without discovery, use `providers add ID --file provider.json` with `manualModels`. Each model needs `id` and `name`; optional fields are `contextWindow`, `maxOutputTokens`, `inputModalities`, `outputModalities`, `supportedParameters`, and `available`. Use `catalogBaseUrl` and `modelsPath` for a separate discovery root/path; CLI equivalents are `--catalog-url` and `--models-path`. Use `catalogFormat: "ollama"` for `/api/tags`. Mistral presets select a capability-aware parser, including archived status. Together presets select its native bare-array parser. Fireworks requires `--catalog-account-id ID` or an explicit catalog URL and retains count evidence across its paginated account catalog. DashScope requires an explicit region/workspace `--catalog-url` with `--catalog-format dashscope`. Z.AI currently requires an explicit catalog or manual models because its documented API has no model-list contract. MiniMax defaults to its `.cn` Open Platform endpoints; use an explicit authority and credential reference for another product or region. A different authenticated catalog origin requires an explicit `catalogCredentialEnv`; a public catalog can declare `catalogAuthStyle: "none"`. Standard credential aliases are resolved only for the matching built-in provider origin. The default parser follows Anthropic-style `has_more/last_id` pagination and otherwise expects an OpenAI-style `data` array. HTTP redirects are rejected.

Grok uses a per-launch authenticated loopback bridge because its environment overlay cannot define providers. The bridge serves model metadata and forwards the selected protocol unchanged. It holds upstream credentials only in memory; Grok receives an ephemeral local token. The same bridge handles credentialless endpoints and OpenCode auth-header mismatches. Bridged requests are limited to 4 MiB and four minutes. Grok resumes retain the selected profile model. Use `-- --resume SESSION_ID -p PROMPT` for headless continuation, or omit the prompt and type after the interactive session loads. Interactive resume with an inline positional prompt is rejected because the native client can send it before applying the selected model. Grok 1.0.13 passed source and installed development CLI resume checks against a controlled Messages fixture and live DeepSeek Flash. OpenCode's provider identity stays stable across temporary bridge ports; `-- run --session SESSION_ID PROMPT` resumes with fresh launch settings. The installed beta-19157 passed two-process Messages resume checks against a controlled local upstream and live DeepSeek Flash, including a proof-file read and preserved history. Other provider/protocol and registry-release cells remain tracked separately in COMPATIBILITY.md.

Hermes uses the same loopback boundary with its documented `custom` provider. The bridge exposes only the Switcher catalog, translates the selected provider's Bearer, `x-api-key` or literal `api-key` credential, and forwards deployment prefixes unchanged. Hermes `state.db` and `sessions/` are linked to a profile-owned stable directory for resume; generated config and bridge credentials remain per-launch. Focused bridge tests cover all three native protocol routes and auth styles, including cleanup of an active stream without caller cancellation. Run `bun scripts/test-native-hermes.ts` with `SWITCHER_TEST_HERMES_EXECUTABLE` for the installed native CLI fixture proof, which performs a real `read_file` loop and deleted-file resume against a generic preset.

Native history and credentials stay with the harness. Resume only with the same profile/provider/model configuration unless the harness explicitly supports a change; cross-provider reasoning/session migration is not provided. Temporary nonsecret picker/config files are removed when the child exits. Run records contain launch/end metadata and initial model, not transcripts or a claim about later native picker selections.

## SDK and API

```ts
import { SwitcherClient } from "@hasna/switcher/sdk";
const client = new SwitcherClient({
  baseUrl: "http://127.0.0.1:8080",
  apiKey: () => process.env.HASNA_SWITCHER_API_KEY!,
});
const profiles = await client.listProfiles();
const plan = await client.launchPlan(profiles.data[0].id);
console.log(plan.catalog.models.length);
```

The SDK supports Node and Bun. It has no database or launcher imports. Explicit credentials may be supplied as a string or a fresh resolver function; `clientFromEnv()` uses the shared contracts resolver with environment-only inputs and no disk fallback.

SDK and CLI API-error diagnostics validate code/request-ID fields, bound message length, remove terminal control characters, and redact the operator credential actually sent with that request. Redaction covers raw, JSON-string-escaped, URL-encoded and Base64/Base64url representations. Native harness stdout and terminal output remain under the native client's control.

Public lifecycle endpoints: `GET /health`, `/ready`, `/version`. Authenticated OpenAPI: `GET /v1/openapi.json`. Provider/profile CRUD, `/v1/provider-presets`, catalog list/refresh, launch-plan validation and run metadata are under `/v1`. The SDK includes `listProviderPresets()`, `getProviderPreset()`, `health()`, `ready()`, and `version()`. SDK types are generated from that OpenAPI document. API errors include code, message and request ID.

All mutations require `Idempotency-Key`. Reuse the same key and payload after an uncertain response; changing the payload returns 409. Updates/deletes also require the numeric record version in `If-Match`. SDK methods supply these headers and accept a caller-provided idempotency key. Run creation requires the `planToken` from a launch plan; a changed provider, profile or catalog rejects the stale plan with 409 before local execution. List endpoints accept `limit` (1–1000), `offset` and `search`. Referenced providers/profiles cannot be deleted while children exist.

`switcher-mcp` exposes provider/profile management, catalogs, launch plans and run reads using standard MCP stdio. It does not remotely execute native harnesses. Fleet coding agents should use the CLI instead of registering this MCP server.

## Development

```sh
bun install
bun run generate
bun run verify
# Inject a disposable database URL:
bun run test:postgres
```

Tests create a unique PostgreSQL schema and remove only that schema. Test scratch defaults to `~/Workspace/scratch/switcher-tests`; override `SWITCHER_TEST_ROOT` for CI. `bun run check:generated` detects OpenAPI/type drift. Publication uses npm with the repository release gates.
