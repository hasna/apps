---
id: "switcher-model-policy"
title: "Automatic model guidance and routing policy"
type: "user-guide"
owner: "codex-fixer"
created_at: "2026-09-06T20:15:46.138691+00:00"
updated_at: "2026-09-06T20:15:46.138691+00:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Automatic model guidance

Starting with 0.1.3, every Switcher launch automatically adds model guidance to managed inference requests. The ordinary command needs no extra setup:

```sh
switcher launch claude --provider deepseek --model deepseek-v4-flash
```

The guidance identifies the main session model, the current request model, role assignments, permitted IDs, and the full catalog file. It tells the model to use exact provider IDs instead of remembered harness defaults such as Opus. Switcher appends its own block to native instructions; it preserves user messages, tool turns, media, and existing instruction metadata. It refreshes that block on resumed requests and supported token-count/compaction operations.

Prompt following is probabilistic. Switcher also enforces the model policy at a per-launch authenticated loopback gateway. A request for an unapproved model fails before it reaches the provider. The default permitted set contains only the selected main model. Native child/utility model slots are pinned where supported, so ordinary launches do not require manual environment variables.

# Assigning roles

Use exact IDs returned by `switcher models PROVIDER`. For example, assigning Claude's child-agent role to another model in the same eligible catalog:

```sh
switcher launch claude --provider deepseek --model deepseek-v4-flash \
  --role-model subagent=deepseek-v4-pro
```

For reusable profiles, `profiles add` accepts the same role flag or `--model-policy-file policy.json`. A saved profile can also carry `modelPolicy` through the API/SDK. Saved-profile launches use that saved policy; change the profile to change its routing contract.

A policy file has this shape; replace the example IDs with your provider's exact IDs:

```json
{
  "version": 1,
  "roles": {"subagent": "vendor/child"},
  "allowedModels": ["vendor/alternate"],
  "aliases": {"alternate": "vendor/alternate"},
  "fallbacks": {"vendor/main": ["vendor/alternate"]}
}
```

Unassigned roles default to the main model. The permitted set combines main, assigned roles, explicit allowed IDs, and fallback targets. All must be present in the eligible catalog. Aliases must point into that permitted set and cannot shadow another real model ID.

The complete provider catalog remains visible in each supported native catalog interface. Visibility does not grant permission to use every entry: add intended alternatives to `allowedModels` or launch again with `--model`. This prevents an agent from choosing a familiar but unintended model from a large provider catalog.

# Native controls

| Harness | Separate native roles wired by Switcher |
| --- | --- |
| Claude Code ≥2.1.257 | Forced subagent model; fast model through the Haiku default; main/default/Opus/Sonnet/Fable aliases pinned. |
| Codex ≥0.153 | Default subagent and review models; named role files receive the selected model/provider while preserving their ordinary instructions/settings. Memory extraction/consolidation model defaults are pinned to main. Custom role names must use letters, digits, underscores or hyphens because of native CLI override parsing. |
| Grok | Session summary model. |
| OpenCode 2 | General/explore and custom subagents; plan model. Explicit `--agent` launches use the assigned role model. Other primary/custom agents use main. |
| Legacy OpenCode | General/explore/custom subagents, plan, title/summary, compaction, and the small/fast model. |
| OMP | Fast (`smol`), planning (`slow` and `plan`). |
| Hermes | Delegation plus verified auxiliary tasks: compression, title/profile description, review, planning triage, approval, skills, MCP, session search and web extraction. Auxiliary custom-provider settings use the selected protocol and loopback credential. |
| Gemini CLI 0.58 | Codebase investigator, fast helpers, summarizers, compression, classifier and edit helpers; native default fallback chains terminate at the selected model. Existing generation/tool settings are retained. |
| Aider | Weak and editor models. |
| Kilo | Weak/small and subagent models. |
| Pi, DeepSeek Harness, Cline, Prime Agent | Selected main model and gateway enforcement; no separate role assignments are advertised. |
| Ori Codex/Grok | The same direct native policy, executed through a per-launch executable shim after Ori's OpenRouter setup. |

A role assignment differing from main is rejected when the adapter has no verified native slot for it. Native permissions and managed settings may further restrict a launch. Codex loads trusted project roles only; Switcher does not grant workspace trust. Gemini planning/review and OpenCode 2 utility role overrides are not advertised for the pinned versions.

# Fallbacks and evidence

Fallbacks are opt-in and ordered. The gateway tries the configured targets only after HTTP 429, HTTP 5xx, or a network failure before a response begins. It does not retry 400/401/403 or retry after a stream starts. Harness-native retries may still repeat the same request. Hermes may try its main-agent model after an auxiliary error; that request remains subject to the same gateway policy.

`switcher runs list` and the API/SDK expose `routingEvents` and `routingEventsDropped`. Events record requested and resolved IDs, allow/alias/reject/fallback decisions, safe reason codes, upstream status, and a provider-reported model when observable. Unknown reported IDs are redacted. Each run retains at most 1,000 events and 512 KiB of routing evidence; additional events increase the dropped counter. Events are finalized when a managed request ends, and launch cleanup flushes them before saving final run status.

The API requires `modelPolicyVersion: 1` on run creation; the current SDK supplies it. Older launchers receive an upgrade error from an upgraded server. An older local CLI running its own older server cannot enforce the new policy: keep the launcher and server upgraded.

# Scope

The gateway controls requests sent through Switcher's managed endpoint. It does not sandbox arbitrary shell tools, user extensions, unmanaged network clients, or provider-side routing. Ori still makes its own OpenRouter catalog/auth requests. Provider-reported model IDs are evidence, not an attestation of the provider's internal execution.

The native child receives an ephemeral gateway token; the actual provider credential stays in the launcher. Policy files, injected guidance and routing events do not contain provider credential values. Prompt guidance and gateway enforcement are both enabled automatically; there is no prompt-only mode presented as equivalent enforcement.
