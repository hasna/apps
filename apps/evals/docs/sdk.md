# TypeScript SDK

The package root exports types plus runner, assertion, judge, reporter, dataset, and storage functions.

```ts
import { loadDataset, runEvals, toMarkdown } from "@hasna/evals";

const { cases, warnings } = await loadDataset("datasets/smoke.jsonl", {
  tags: ["smoke"],
});

const run = await runEvals(cases, {
  dataset: "datasets/smoke.jsonl",
  adapter: {
    type: "http",
    url: "http://localhost:3000/api/chat",
  },
  concurrency: 5,
});

console.log(warnings);
console.log(toMarkdown(run));
```

## Runner

| Export | Purpose |
|---|---|
| `runEvals(cases, options)` | Run a dataset and return an `EvalRun`; `options.adapter` is required at runtime |
| `runSingleCase(evalCase, adapter, skipJudge?)` | Run one case, including case-level repeats |

`RunOptions` supports `dataset`, `adapter`, `concurrency`, `tags`, `skipJudge`, `repeat`, `outputFormat`, and `verbose`. The SDK returns data; it does not print, save, or apply CLI exit codes automatically.

## Assertions and judging

| Export | Purpose |
|---|---|
| `sortAssertionsCheapestFirst` | Return assertions ordered by execution cost |
| `runAssertion` | Evaluate one assertion with an `AssertionContext` |
| `runAssertions` | Evaluate assertions with short-circuiting |
| `assertionsPassed` / `allAssertionsPassed` | Return whether all results passed |
| `runJudge` | Judge an input/output pair with `JudgeConfig` |
| `judgeOnce` | Convenience wrapper using individual parameters |

See [Datasets and assertions](datasets.md) for supported assertion fields and judge defaults.

## Reporters

| Export | Purpose |
|---|---|
| `printTerminalReport` | Print a compact or verbose run report |
| `formatRunSummary` | Return an agent-friendly text summary |
| `summarizeRun` | Return compact run metadata |
| `formatRunList` | Return paginated run-list text |
| `toJson` | Return redacted, indented run JSON |
| `toMarkdown` | Return a full Markdown run report |
| `compareRuns` | Compute regressions, improvements, and pass-rate delta |
| `printDiffReport` | Print a compact or verbose terminal diff |
| `parseDisplayLimit` / `truncateDisplayText` | Apply reporter display defaults |

## Validation plans and proof bundles

The SDK maps eval cases and runs to the generic `hasna.validation_plan.v1` and
`hasna.proof_bundle.v1` contracts from `@hasna/contracts`:

```ts
import {
  createProofBundle,
  createValidationPlan,
  runEvals,
  validateProofBundle,
} from "@hasna/evals";

const plan = createValidationPlan(cases, {
  dataset: "datasets/smoke.jsonl",
  objective: "Verify the release candidate",
});

const run = await runEvals(cases, options);
const proof = createProofBundle(run, plan, {
  verifier: { kind: "agent", id: "release-verifier" },
  artifactRefs: [{
    id: "ci-log",
    kind: "log",
    uri: "artifact://ci/run-123/log",
  }],
  residualRisks: ["Live provider behavior was not exercised"],
  freshness: "fresh",
});

if (!validateProofBundle(proof).success) throw new Error("Invalid proof bundle");
```

Plans expose required checks; bundles expose executed checks, verdict, artifact
evidence, residual risks, verifier identity, and freshness. Assertion definitions
and results plus LLM judge model/provider/usage metadata are stored under the
`@hasna/evals` metadata key. Judge API keys and reasoning text are not copied.
`createProofBundle` returns an inconclusive bundle when a required plan check was
not executed. `validateValidationPlan` and `validateProofBundle` use the canonical
`@hasna/contracts` validators; the corresponding schemas and TypeScript types are
also exported.

## Dataset loading

`loadDataset(pathOrGlob, options?)` returns `{ cases, warnings, totalLines, skipped }`. `LoadOptions` supports `strict` and `tags`. `streamDataset(path, options?)` yields valid JSONL cases one at a time and silently skips invalid lines unless `strict` is true.

## Storage

The package exports `getDatabase`, `closeDatabase`, `saveRun`, `getRun`, `listRuns`, `countRuns`, `deleteRun`, `setBaseline`, `getBaseline`, `listBaselines`, and `clearBaseline`. See [Storage](storage.md) for persistence and redaction behavior.

## Public types

Public types include `Verdict`, all six adapter configs and `AdapterConfig`, assertion types/results, judge types, `ConversationTurn`, `EvalCase`, `EvalResult`, `EvalRunStats`, `EvalRun`, `RunOptions`, `CiOptions`, `ValidationPlan`, and `ProofBundle`.

Adapter call functions themselves are internal modules and are not exported from the package root.
