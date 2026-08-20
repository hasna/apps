---
"@hasna/loops": patch
---

loops-runner bound-scope claim fixes (BUG e22f6727): (1) `logRunnerCommandFailure` now surfaces the error message (scrubbed of credential material, including URL userinfo in connection strings) instead of emitting only the event envelope, and `runRunnerLoop` logs the failure reason when no `onError` is wired — so a bound runner whose control plane cannot enforce the scope reports the exact refusal to the journal instead of spinning silently. (2) Runner claim pin matching restored to the pre-0.5 candidate set ({runner.id, machineId, hostname} against the pin's canonical id) so a bound runner whose identities diverge from the pin's id (machines->stations rename class) can claim its own pins; `requestedId` alias matching stays excluded (closed-world alias-collision protection unchanged).
