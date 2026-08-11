# safe-read — prove a collection read complete, or refuse

`contracts read [options] -- <command> [args...]`

Exit codes: **0** proven complete · **2** REFUSED · **3** usage. The convention matches
`probe-guard`, so an agent does not have to hold two vocabularies.

A text-mode refusal prints **nothing** to stdout. In `--json` form stdout carries a
structured refusal, but the `rows` key is *absent* rather than empty, so a consumer
that reaches for it gets `undefined` and fails instead of reading a plausible zero.

## Why this lives in `@hasna/contracts`

The shape of a collection read — `ok`, `total`, `total_pages`, `has_more`,
`next_cursor`, `store_exists` — is the interface contract between every Hasna CLI and
every consumer of it, and it is the one contract on the fleet with no owning domain.
`@hasna/contracts` exists for exactly that: "shared schemas and validators for Hasna
agent infrastructure contracts."

Four reasons this package rather than another:

1. **It is the only domain-less shared library.** Every other candidate owns a domain
   — `guardrails` is request policy, `controls` is spend authorization, `shield` is
   security scanning, `dispatch` is tmux delivery. A read-completeness contract is
   none of those.
2. **It already ships both shapes this needs.** A library export for TypeScript
   consumers, and a CLI binary for the population that actually hit this — agents
   running commands in a shell, not programs importing a module.
3. **It avoids a 186th package**, a new release-age exclusion entry, and a new thing
   to install on every machine.
4. **The nearest existing abstraction cannot be the home.** `probe-guard` is the
   closest thing already deployed, and it has **no source repository anywhere on this
   box** — a 112 KB script in `~/.local/bin` referenced by five skills. It is also a
   different half of the problem: an assertion over bytes you already captured.

### Relationship to `probe-guard`

`probe-guard complete` asserts over a captured file. It is good and this does not
replace it. It cannot close mechanism 3, and it says so itself. Measured on the live
`repos repos --json` read, 50 rows of a population of 1793:

```
probe-guard complete --json r50.json
  rc=0
  probe-guard complete: 50 row(s) under <top-level list>
    no unfollowed pagination marker found (top level or nested)
    WARNING: %d is a round number and a classic SILENT page cap...
    PASS
```

`rc=0` — a pass, with an honest warning that no automation stops on. The same read
through this helper:

```
contracts read -- repos repos --json
  rc=2
  contracts read: REFUSED [stderr_truncation_notice]
    rows=50 under <top-level array>
    No rows are printed. A refused read is not an empty set.
```

The difference is not cleverness. Establishing completeness requires a **second
observation** — another page, a wider bound, a sibling aggregate, or the other
stream — and a checker handed one captured file has only one.

## The design principle

> **Completeness must be PROVEN. It is never inferred from the absence of a flag.**

A read is accepted only when it carries one of five named proofs:

| proof | how it is established |
|---|---|
| `declared_total_satisfied` | rows equal a total the surface declared itself |
| `cursor_exhausted` | paged until the surface said there was no next page |
| `sibling_aggregate_agrees` | rows equal an aggregate on a sibling verb the caller named |
| `stable_under_widening` | a wider bound returned fewer rows than that bound *and* fewer than any clamp |
| `assumed_complete` | the caller waived proof; always recorded, never silent |

## What this does NOT protect against

This section is the most useful part of the document, because it says where the
guarantee stops. Each item is labelled **M** (live behaviour exercised) or **S/U**
(established from a source read or another agent's measurement, not exercised here).

**1. A wrong predicate on a complete read. (M, by others)**
The read can be complete, the pagination followed and the total honest, while the
filter expression means something other than what its author intended. The measured
case is a regex flag whose letter survives a port and whose meaning does not:

```
jq      test("^SECOND";"m")      -> false    "m" does NOT anchor per line
jq      test("first.SECOND";"m") -> true     "m" IS dotall
python  re.search(r'^X', s, re.M) -> True    same letter, opposite meaning
```

In Python and JavaScript, `m` is per-line anchors and `s` is dotall. In jq, `m` **is**
dotall and there is no per-line anchor flag at all. A pattern carried from a Python
script into a jq filter keeps its letter, silently changes meaning, and returns
`false` on text that plainly contains the match. A read helper cannot see this without
evaluating the caller's intent, and one that tried would become a regex linter.

*This helper's own exposure to it:* **jq invocations = 0, anchored patterns = 0**
across all four source files, with a positive control confirming the probe finds a
token that is present (`RegExp` = 1) and not one that is absent (0). Both numbers are
reported because a zero alone cannot distinguish "clean" from "the check could not
have fired" — this is the second case, so the check is honestly **out of scope** here
rather than an all-clear. The two regex flags actually used are both `/i`.

**2. A defaulted scope, beyond naming it. (M, by others)**
The read is complete, the predicate correct, pagination followed, and the declared
total honest — only the scope is defaulted, and nothing in the output is wrong:

```
knowledge list --limit 1 --json                     total=1526
knowledge list --limit 1 --include-archived --json  total=1567   41 items invisible
todos list --json --limit 9000                      7301, converged, and a SUBSET
todos list --all --json --limit 40000               40000
```

**The envelope's `total` is scope-relative**, so reconciling rows against it *confirms*
a defaulted scope with a clean three-way agreement rather than catching it. The
helper's strongest proof is structurally blind here.

What it does instead: a small census (`SCOPE_WIDENERS`) refuses two known surfaces
unless the widening flag is passed or `--scope-ack` records the narrow scope as a
deliberate choice, and **every count carries the scope that produced it**. `1526
(default)` and `1567 (--include-archived)` are different facts and neither is "the
population" alone. The census is deliberately tiny; auto-discovering every scope flag
on every CLI is a per-surface fact that rots, and guessing it is worse than declaring
the limit.

**3. A probe that is structurally incapable of matching its subject. (M, by others)**
A caller can hand this helper a command whose own matcher cannot work. The measured
case: `basename(argv[0]) == "search"` returns zero for every Hasna CLI, because they
are all bun shims and the live `argv[0]` is `bun`. That is a method that cannot fire,
not a near-miss, and it was introduced *as a fix* for a self-matching full-cmdline
matcher — trading a false positive for a false negative, which is the one that gets
published. This helper guards the completeness of a read; it cannot see that the
command it was handed asks the wrong question.

**4. An unknown hidden clamp. (M, here)**
`stable_under_widening` is the weakest proof and is unsound against a silent
server-side cap. `conversations read` returns 500 rows for any request above 500, so
`count < requestedBound` proves nothing when the bound was never honoured. Two-step
widening does not rescue it: a true population of 300 and a hidden clamp of 500 both
yield equal counts below both bounds at any number of steps. The helper refuses when
the widened count meets a censused cap or lands on a round number, which is
conservative in the safe direction — a real population of exactly 500 on an
uncensused surface is falsely refused, and the fix is one `--known-clamp` flag.
`KNOWN_CLAMPS` is an optimisation, not the safety property.

**5. A moving population.** Two observations taken at different instants can
legitimately disagree. Growth between the first read and the widening probe is
reported and the wider read returned; a sibling aggregate that moves under a long
page walk produces a refusal that a re-run may clear.

**6. Anything about whether the rows are CORRECT.** This establishes that you are
holding the whole set. It says nothing about whether the set is the one you wanted,
whether the fields mean what you think, or whether the values are true.

## Evidence grades in the censuses

`KNOWN_CLAMPS` and `SCOPE_WIDENERS` carry a per-row grade, copied from the discipline
of knowledge item `k_mso1r678_fhgm1o` (Conversations Readbounds Census Matrix,
measured 2026-08-11 against `@hasna/conversations` 0.5.43):

- **M** — live behaviour exercised.
- **S/U** — established from installed client or bundled server source; live behaviour
  not safely measurable.

A source-read bound and an exercised bound are different claims, and merging them is
how a table starts asserting more than anyone measured.

## Examples

```bash
# Refuse a bounded read whose only notice is on stderr
contracts read -- repos repos --json

# An envelope-less bare array, proven by a sibling aggregate
contracts read --limit-flag=--limit --limit 2000 \
  --sibling-arg mementos --sibling-arg stats --sibling-arg --json \
  --sibling-path by_scope.global \
  -- mementos list --scope global --json

# Page a cursor surface to exhaustion
contracts read --cursor-flag --cursor -- conversations digest board --json

# Catch a query verb that ignores its predicate
contracts read --probe-negative-arg zzz-no-such-token -- faketool search widget
```
