---
name: define-for-agents
description: Define a product for coding agents before any code is written. Standing rules under 150 lines, a one-page plan, screens on a local design server, tokens as data, a closed component catalog, a tool inventory, one spec per feature with testable criteria, an eval set, and a check wired to a Stop hook. Use when starting a product, a large feature, or when agents keep building the wrong thing.
kind: instruction
---

# Define for agents

Agents build what is written down and improvise the rest. This skill is the order in which to write things down so that a fresh agent session builds the right thing, and a check catches it when it does not. It is prose: reading it is the invocation. Nothing here needs credentials, network, or a runtime beyond Bun.

## Why this shape

Read across the spec-driven methods of 2025 and 2026 (Spec Kit, Kiro, OpenSpec, BMAD, AGENTS.md, Claude Code's own guidance), three things held up and the rest did not:

- Short standing rules are followed; long ones are ignored. 100 to 150 lines was the top performer in Augment's tests. Architecture overviews inside rules files measurably hurt (arXiv 2602.11988). Vercel took a task pass rate from 53% to 100% with a compressed docs index in `AGENTS.md`.
- Every surviving method ends with the same four artifacts: standing rules, a spec with acceptance criteria, a design, a task list. Eight-file specs and spec-as-source-of-truth failed in practice (Marmelab, Thoughtworks; Tessl pivoted).
- A check the agent can run is worth more than any instruction. Hooks are deterministic; rules are advisory. A closed component catalog makes UI violations structurally impossible.

## The artifacts, in this order

Write them in this order. Each one is small. Stop and show the founder after 3 and after 6.

| # | Artifact | File | Rule |
|---|---|---|---|
| 1 | Standing rules | `AGENTS.md` at the root, `CLAUDE.md` containing only `@AGENTS.md` | Under 150 lines. Commands, a "read before you change" table, the rules that get ignored unless written, how work flows, gotchas. No architecture overview. |
| 2 | The product in one page | `docs/v1.md` | What it is, what it is not, the one number that decides whether it continues, the "not now" list. |
| 3 | The screens, to look at before building | `design/` with a Bun server | Static HTML boards first. Every screen the product will have, phone and desktop. Prev/next, pin notes the founder can leave, the kit and the docs on the same server. |
| 4 | The design system as data and rules | `packages/ui/tokens.json` (Design Tokens format), generated `tokens.css`, `components.css`, `motion.css`, `kit.html`, `packages/ui/AGENTS.md` | Agents cannot invent a color that is not a variable. One table of components and where each is and is not used. One table of events and their one motion. |
| 5 | What the model may call and draw | `docs/tools.md` | Every tool with input, output, side effect, what the person sees, and what fails how. The closed catalog of components the model may render. What is refused in words and never a tool. |
| 6 | One spec per feature | `specs/NNN-name/spec.md` | P1, P2, P3 stories, each independently testable. Given/When/Then criteria. Out of scope. `[NEEDS CLARIFICATION: ...]` on anything a human must answer. Written by interviewing the founder. Archived into `docs/` when shipped. |
| 7 | The checks | `design/check.ts`, `evals/cases.jsonl`, screenshot tests, a Stop hook in `.claude/settings.json` | Written with the spec, never after. The hook blocks the agent from stopping while a fast check fails. |
| 8 | The next five things | `docs/decide.md` | Concrete, ordered, each doable by the founder from where they are. |

## The loop, once the artifacts exist

1. Look. Walk every screen on the design server. Pin notes. Fix boards before code.
2. Spec. Interview the founder into `specs/NNN-name/spec.md`. No open `[NEEDS CLARIFICATION]` means ready.
3. Build in a fresh session with `AGENTS.md`, the spec, and the one or two rule files the feature needs. Not the whole repo.
4. Check. The Stop hook runs the fast checks; the eval set and screenshot diffs run before a PR.
5. Review with a fresh subagent that compares the diff to the spec and tries to refute it.
6. Archive. Fold the spec into `docs/`, delete it from `specs/`, add an eval case for every bug found.

## Templates

### AGENTS.md skeleton

```markdown
# Product name
One paragraph: what it does, for whom, what the person pays.

## Commands
(the three to six commands an agent runs: dev server, generate, check, tokens)

## Read before you change something
| You are changing | Read first |
(a table mapping change types to one or two files)

## Rules that get ignored unless written down
(claims, money words, honesty about what the product cannot know, the stack with model names pinned, UI constraints, founder constraints)

## How work flows
(look, spec, build in a fresh session, check, review, archive)

## Gotchas
(generated files, naming, what never ships, branch and PR rules)
```

### spec.md skeleton

```markdown
# NNN · Feature name
One paragraph: who, what, why now, which screens.
## Stories
### P1 · The one thing it must do
As a ..., I ..., so that ...
- Given ..., when ..., then ...
### P2 · ...
### P3 · ...
## Edge cases
## Out of scope
## Checks
(which eval cases, which screenshot tests, which check script)
## Open
- [NEEDS CLARIFICATION: ...]
```

### Stop hook, `.claude/settings.json`

```json
{ "hooks": { "Stop": [ { "hooks": [ { "type": "command",
  "command": "cd \"$CLAUDE_PROJECT_DIR/design\" && command -v bun >/dev/null || exit 0; out=$(bun check.ts 2>&1) || { printf 'check failed:\\n%s\\n' \"$out\" >&2; exit 2; }; exit 0" } ] } ] } }
```

Exit code 2 with the report on stderr is what blocks the stop. Keep the hooked check under two seconds; slow checks run before the PR, not on every stop.

### The design server

Hono on Bun, one file. Serves the boards from `design/boards`, the kit from `packages/ui`, the docs rendered from markdown, and a `GET/POST /notes` pair that writes the founder's pin notes to `design/notes.json`. A `review.html` with page tabs, a screen picker, arrow keys, click-to-pin. Boards are plain HTML with inline styles so they render anywhere; when real components exist, a board becomes a three-line `.tsx` mount served by the same server through Bun's HTML imports. Nothing is thrown away.

A `check.ts` next to it: every board listed in the layout exists, sizes match the frames, no two frames overlap, and no board contains a banned word. This is the first check an agent can run.

### Eval cases

One JSON object per line: `{ "id", "kind", "input", "expect" }`. Code assertions first (limits, counts, banned words, exact tool sets, an Undo on every change), then one model-judged line per case with a pass rule. Thirty to fifty cases beats five polished ones.

## What to skip

- Architecture overviews in the rules file.
- More than one spec file per feature. A `plan.md` only when the spec cannot say how.
- Spec as source of truth with generated code. Code is the source; specs are scaffolding.
- A second toolchain to look at screens. Serve them with the runtime the product already uses.
- Tool names, model names, or "AI is thinking" anywhere the person can see.

## Worked example

`hasna-products/everfoods` has all eight artifacts: `AGENTS.md`, `docs/v1.md`, `design/` (46 boards, server, generator, check), `packages/ui` (tokens.json, components, motion, kit, AGENTS.md), `docs/tools.md` (20 tools, the catalog, what fails how), `specs/001-first-cart`, `evals/cases.jsonl`, `docs/decide.md`, and the Stop hook. `docs/method.md` there carries the sources.

## Sources

GitHub Spec Kit https://github.com/github/spec-kit · Kiro specs https://kiro.dev/docs/specs/ · OpenSpec https://github.com/Fission-AI/OpenSpec · BMAD https://github.com/bmad-code-org/BMAD-METHOD · AGENTS.md https://agents.md/ · Claude Code best practices https://code.claude.com/docs/en/best-practices · Vercel on AGENTS.md https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals · Augment on AGENTS.md https://www.augmentcode.com/blog/how-to-write-good-agents-dot-md-files · arXiv 2602.11988 · Thoughtworks on SDD tools https://martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html · Marmelab https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html · Design Tokens format https://www.designtokens.org/TR/drafts/format/ · Primer primitives AGENTS.md https://github.com/primer/primitives · shadcn registry https://ui.shadcn.com/docs/registry · json-render https://json-render.dev/ · Playwright snapshots https://playwright.dev/docs/test-snapshots · Bun HTML imports https://bun.sh/docs/bundler/html · Hono on Bun https://hono.dev/docs/getting-started/bun
