---
id: "switcher-omp-adapter"
title: "OMP native adapter contract"
type: "adapter-contract"
owner: "codex-fixer"
created_at: "2026-09-06T13:53:39+03:00"
updated_at: "2026-09-06T13:53:39+03:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# OMP native adapter

The adapter targets the installed OMP 18.1.11 contract from [`can1357/oh-my-pi`](https://github.com/can1357/oh-my-pi), package `packages/coding-agent`. OMP reads provider definitions from `PI_CODING_AGENT_DIR/models.yml`; the shipped schema supports OpenAI Completions, OpenAI Responses and Anthropic Messages APIs, provider `authHeader`, environment-resolved `apiKey`, explicit headers and model definitions.

Each Switcher launch writes a temporary provider named `switcher`, scopes `enabledModels` to `switcher/**`, and pins all native model roles to `switcher/<model-id>` in `config.yml`. Provider-qualified selection preserves nested model IDs and rejects case-colliding IDs. Bearer credentials use OMP's `authHeader` path; x-api-key credentials use an explicit environment-resolved header with provider auth disabled so OMP does not add a second bearer header. The generated files contain only the environment variable name.

The stable session directory is passed separately with `--session-dir`, while the generated agent directory is removed after launch. Native project rules remain enabled; Switcher rejects OMP routing, profile, model, config, session and rule suppression flags that would escape the launch authority.

The installed native fixture is exercised by `scripts/test-native-omp.ts` against a loopback OpenAI Chat server. It proves the native `read` tool loop, project instruction delivery, environment-only authentication, exact request model, two-process resume after deleting the read file, and session persistence. Messages and Responses use the same typed OMP config mapping and are covered by focused preparation tests; native paid requests are not part of the fixture.
