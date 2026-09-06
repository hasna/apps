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

Switcher 0.1.1 targets the installed Cline CLI 3.0.61. It writes Cline's version 1 `settings/providers.json` and `settings/models.json` under a Switcher-owned data directory, preserving the complete coding-eligible catalog and selected model. The provider protocol/client pair is selected from the Switcher protocol: Anthropic Messages uses Cline `anthropic`, OpenAI Responses uses `openai` with `openai-responses`, and OpenAI Chat uses `openai-compatible` with `openai-chat`.

Cline reads `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` from the launch environment. The generated files omit API keys and the launch reserves provider, model, data/config directory, working directory, key, and auto-approval flags. Auto-approval is explicitly disabled so native project instructions and permission prompts remain active. Authentication style mismatches are rejected before launch because this adapter does not silently translate wire credentials.

The adapter is based on the public [Cline repository](https://github.com/cline/cline) at source commit `595f1dbf2ea819e987afeadb4ed4dd9a0ae9a55e`; that 3.0.61 snapshot was inspected for the provider settings and local model registry contracts.
