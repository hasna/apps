---
"@hasna/machines": patch
---

fix(machines): every api-mode fleet flip (re)provision verifies the written env file carries the full per-app env contract (default [apiUrlEnv, apiKeyEnv], overridable via clientEnvRequiredKeys) and aborts with FLIP_ERROR (exit 3) BEFORE the file becomes the provisioned state when any required key is missing. Incident 715712 (BUG 7d5f08a1): a harness session-env re-provision dropped the hosted API env for TODOS/KNOWLEDGE/EMAILS and the CLIs silently fell back to empty on-box SQLite stores at rc=0 — a re-provision can never emit a reduced env again.
