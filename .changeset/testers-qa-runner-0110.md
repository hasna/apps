---
"@hasna/testers": patch
---

Fix the OpenAI-compatible runner path (canonical assistant-message shape for tool_calls, tool results emitted immediately after the tool_calls message they answer) and inject TEST_* environment values into scenario prompts per the resolveCredential convention, so login-gated QA lanes can complete. Unblocks the alumia merge QA gate (todos 962c6907).
