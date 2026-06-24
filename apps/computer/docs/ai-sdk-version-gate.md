# AI SDK Version Gate

Last checked: 2026-06-18.

The AI SDK planner layer is intentionally pinned to stable, age-safe package versions. The workspace currently enforces Bun minimum-release-age resolution, so the gate excludes canary builds and freshly published versions that Bun will not resolve in a clean install.

## Selected Packages

| Package | Selected version | Why |
| --- | ---: | --- |
| `ai` | `6.0.200` | Stable AI SDK 6 core package older than the workspace minimum-release-age gate. Provides `generateText`, `Output.object`, tools, approval metadata, and loop primitives used by the planner layer. |
| `@ai-sdk/openai` | `3.0.69` | Stable provider package older than the age gate. Reserved for the AI SDK planner/provider lane; provider-native desktop execution still uses the existing `openai` SDK adapter until P3 modernization. |
| `@ai-sdk/anthropic` | `3.0.82` | Stable provider package older than the age gate. Reserved for the AI SDK planner/provider lane; provider-native desktop execution still uses the existing `@anthropic-ai/sdk` adapter until P3 modernization. |
| `zod` | `^3.25.76` | Satisfies the AI SDK peer dependency range `^3.25.76 || ^4.1.8` while preserving current repo compatibility. |

The latest npm versions observed on 2026-06-18 were newer, but they were blocked by the workspace minimum-release-age policy. The selected versions are the newest stable versions that can be resolved without bypassing that policy.

Commands used:

```bash
npm view ai version
npm view @ai-sdk/openai version peerDependencies --json
npm view @ai-sdk/anthropic version peerDependencies --json
npm view ai time --json
npm view @ai-sdk/openai time --json
npm view @ai-sdk/anthropic time --json
```

## Provider Matrix

| Lane | SDK package | Current model baseline | Execution boundary |
| --- | --- | --- | --- |
| Planner/orchestrator | `ai` | Model is injected by the caller; offline tests use injected generators. | Produces structured plans and route decisions only. It does not execute OS input. |
| AI SDK OpenAI lane | `@ai-sdk/openai` | To be bound in P3 after provider-native OpenAI computer-use modernization. | May plan/evaluate through AI SDK, but local execution remains routed through open-computer policy and runtime gates. |
| AI SDK Anthropic lane | `@ai-sdk/anthropic` | To be bound in P3 after provider-native Anthropic computer-use modernization. | May plan/evaluate through AI SDK, but local execution remains routed through open-computer policy and runtime gates. |
| Existing OpenAI executor | `openai` | `computer-use-preview` until P3 replaces it with the current Responses computer tool. | Provider-native action translation feeds the existing open-computer driver and policy loop. |
| Existing Anthropic executor | `@anthropic-ai/sdk` | `claude-sonnet-4-5-20250514` with the existing beta header until P3 updates current provider docs. | Provider-native action translation feeds the existing open-computer driver and policy loop. |

## Gate Rules

- Keep `ai`, `@ai-sdk/openai`, and `@ai-sdk/anthropic` pinned to exact versions in `package.json`.
- Do not use canary AI SDK packages for release candidates.
- Do not bypass Bun minimum-release-age policy for dependency selection.
- Keep `zod` inside the AI SDK peer dependency range.
- Re-run `bun run typecheck`, focused AI SDK tests, full `bun test`, and `bun run build` after changing any selected version.
