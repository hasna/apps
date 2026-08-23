# Corpus Policy And The 27-Slug Dual-Runtime Set — Decision Record

Status: DECIDED (prerequisite). Recorded 2026-08-23. This record fixes the
corpus policy and the dual-runtime set that the sandboxed-execution decision
([docs/architecture/sandbox-execution-decision.md](./sandbox-execution-decision.md))
treats as its prerequisite. The routing reactivation makes the same-slug
ambiguity this record names operational, which is why the two records exist
separately: this one fixes the corpus semantics, the sandbox record fixes the
substrate and credential delivery.

## Decision in one paragraph

The corpus is one corpus: every skill ships its OSS source and stays runnable
free, locally. A reviewed set of **27 slugs** additionally carries a hosted
premium runtime: the same slug resolves to free local execution or hosted
premium execution depending on the runtime route. Because the routing
reactivation turns that same-slug dual-runtime ambiguity from a documentation
fact into an operational one, resolution must be server-owned — the client
must not infer the runtime from local state.

## Corpus policy

- One corpus, no second-class citizens at rest: every catalog entry ships
  bundled source or instruction prose. This is the property the current
  `hosted-skill-set.ts` state enforces — today the hosted metadata set is
  empty and `catalog-runnable.test.ts` asserts it stays empty.
- Free/local execution remains available for every slug in the corpus,
  including the 27 dual-runtime slugs, per the README's server-side contract:
  a premium skill runs through the configured Skills API and does not fall
  back to bundled local execution when auth is missing — the local path is
  the user's own execution, never a silent substitute for the hosted one.

## The 27-slug dual-runtime set

- A reviewed set of 27 slugs is declared dual-runtime. Each carries the free
  local execution every skill has, plus a hosted premium runtime served
  through the Skills API.
- The set is declared once, authoritatively, by the routing lane's
  server-owned marker — not derived by each client from its own
  configuration. The existing marker machinery (`skills.runtime` /
  `skills.source` in each skill's `package.json`, read by
  `hosted-skill-set.ts`) is the pattern the set follows.
- The set is a corpus decision: it is data about the corpus, changed through
  the corpus, and every consumer derives from the same declaration.

## Why the ambiguity is operational, and why resolution is server-owned

With the routing reactivation, the same slug is no longer just documented as
"premium" — a client holding that slug must decide, per run, whether the run
is the free local execution or the hosted premium execution. That decision is
not inferable from local state:

- local auth absence does not mean "use local" (the premium contract forbids
  falling back when auth is missing);
- local auth presence does not mean "use local" either, because the premium
  route is the intended route for the 27;
- and the client's cached registry may be stale about which runtime a slug
  carries.

So the runtime designation is server-owned: the server declares which slug is
premium, the resolver in the routing lane consumes that declaration, and the
client resolves per run rather than caching a local truth.

## Relationship to the sandboxed-execution decision

The sandbox decision fixes the substrate: the hosted half of the dual-runtime
set executes in the sandboxed lane (Fargate first, E2B second, Workers only
as a JS-only substrate, WASM rejected as primary). This record fixes what the
substrate executes. A routed run must land on the substrate its runtime
declares — which is the join point between the two records and the reason the
sandbox record cites this one as a prerequisite.

## Consequences

- The empty hosted-set guard is superseded for the 27: the routing lane
  introduces the server-owned marker and the resolver; the empty-set
  assertion in `catalog-runnable.test.ts` is replaced by an assertion against
  the declared set, in the same change, so the guard never passes vacuously.
- Same-slug ambiguity is resolved at routing time by the server-owned
  declaration, never by client inference.
- The credential-delivery rules of the sandbox decision apply to the hosted
  half of every dual-runtime run.
