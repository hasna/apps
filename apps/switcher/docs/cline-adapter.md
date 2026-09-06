---
id: "cline-adapter-contract"
title: "Cline native adapter contract"
type: "compatibility-note"
owner: "fixer"
created_at: "2026-09-06T14:08:30+03:00"
updated_at: "2026-09-06T14:08:30+03:00"
status: "active"
source_task: "01a07181-ca8d-70c1-99a2-b276dc5770f3"
---

# Cline native adapter

Switcher 0.1.1 targets the installed Cline CLI 3.0.61. It writes Cline's version 1 `settings/providers.json` and `settings/models.json` under a Switcher-owned data directory, preserving the complete coding-eligible catalog and selected model. Anthropic Messages uses Cline `anthropic`; OpenAI Chat uses `openai-compatible`. Cline 3.0.61 routes an `openai-responses` provider through its hosted OpenAI path and ignores an operator endpoint, so Switcher rejects that cell with an actionable error instead of silently changing protocol or authority.

Cline reads `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` from the launch environment. The generated files omit API keys and the launch reserves provider, model, data/config directory, working directory, key, and auto-approval flags. Auto-approval is explicitly disabled so native project instructions and permission prompts remain active. Authentication style mismatches use Switcher's short-lived loopback bridge so the native header is translated only at the local boundary and the upstream receives the declared provider credential.

The adapter is based on the public [Cline repository](https://github.com/cline/cline) at source commit `595f1dbf2ea819e987afeadb4ed4dd9a0ae9a55e`; that 3.0.61 snapshot was inspected for the provider settings and local model registry contracts.
