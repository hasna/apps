---
id: "2026-09-06-hermes-adapter-evidence"
title: "Hermes adapter contract and evidence"
type: "adapter-evidence"
owner: "fixer"
created_at: "2026-09-06T13:22:42+03:00"
updated_at: "2026-09-06T13:11:43.411387+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Hermes adapter

This adapter targets Hermes Agent 0.21.0's documented `custom` provider. The
native runtime uses Bearer for OpenAI-compatible requests and x-api-key for Messages, so Switcher uses
a short-lived loopback bridge to keep its selected catalog authoritative and
to translate the stored provider credential into the provider's declared
Bearer or `x-api-key` header. The bridge supports the Switcher
`anthropic-messages`, `openai-responses`, and `openai-chat` routes and forwards
deployment path prefixes unchanged.

Hermes receives a per-launch `HERMES_HOME` and generated custom-provider
configuration. `state.db` and `sessions/` point to the profile-owned stable
session directory so `--resume` works across launches; config, cache, logs and
the bridge credential remain launch-local. Reserved provider, model, config,
profile, and routing flags are rejected, and catalog IDs that collide only by
case are rejected because native model lookup normalizes letter case.

Evidence comes from the pinned source checkout at
`/Users/hasna/Workspace/scratch/universal-harness-switcher/hermes-source`
(upstream commit `0a195aa4636494812a52ab7068a5ab822d050abf`), the official CLI
reference at <https://github.com/nousresearch/hermes-agent/blob/main/website/docs/reference/cli-commands.md>,
and the provider runtime reference at
<https://hermes-agent.nousresearch.com/docs/developer-guide/provider-runtime/>.
The reproducible `test:native-hermes` fixture runs the installed binary only
against a loopback SSE server. It launches through the Switcher CLI with a
generic OpenAI Chat preset, serves a nested model catalog, drives a real
`read_file` tool call, deletes the fixture, and resumes the same profile to
prove the persisted tool result is used. It also verifies cwd project rules
remain visible to the native process and that the synthetic provider key is
never written to stable session files. It does not make a cloud or paid
request.

The adapter intentionally does not advertise Hermes-native login, hosted
provider discovery, or arbitrary Hermes profiles. Provider and model
discovery remains a Switcher responsibility; an operator must provide a
catalog and an explicit endpoint before launch.

The native picker contains the full selected-provider catalog and can switch between those exact IDs without an inference request. Hermes also displays its built-in free-provider and MOA entries; those entries are not models discovered from the selected Switcher provider. Ordinary `chat --oneshot` keeps a boolean flag, while top-level `--oneshot` takes a prompt. Shared argument validation follows that distinction, short-option values and native profile pre-parsing.
