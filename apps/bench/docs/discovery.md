# Discovery Workflow

Open-bench discovery is manifest-first. The registry should prefer explicit, reviewable metadata over scraping arbitrary benchmark code at runtime.

## Candidate Sources

Use several inputs when looking for new benchmark suites:

- existing Hasna OSS repos and package dependencies
- upstream benchmark repositories
- package registries for benchmark harnesses
- model leaderboard references
- papers, datasets, and benchmark cards
- issue requests from users or agents

Discovery should capture the source URL, license, supported tasks, metrics, runner behavior, and safety requirements before any adapter is promoted.

## Promotion States

- `planned`
- `candidate`
- `dry-run`
- `runnable`
- `verified`
- `deprecated`

These are the exact values accepted by `adapter.status` in `bench.manifest.v1`. All 13 bundled manifests currently use `planned`. Separately, every built-in adapter advertises the `dry-run` and `manual-record` execution modes. The status and execution-mode fields are related but not interchangeable.

## Minimum Metadata

Every promoted benchmark needs:

- stable `id`, `name`, `category`, and `manifestVersion`
- upstream source references with `verifiedAt`
- license name, URL, status, and attribution requirements
- runner kind, capabilities, expected artifacts, and dry-run support
- metrics with value direction and optional units
- safety class, network, sandbox, secret, cost, and note fields
- adapter install, command, parser, and expected output metadata

## Rejection Rules

Do not promote a benchmark when:

- license metadata is unknown
- runner capabilities imply network, sandbox, or secrets but safety metadata does not declare them
- generated-code or repository-test execution lacks sandbox requirements
- metrics cannot be mapped to stable ids
- output artifacts cannot be parsed or checksummed reproducibly
- the adapter would require raw credentials instead of secret refs

## Future Automation

Future discovery automation should write manifest candidates only. It should not execute unknown benchmark packages. Agent or crawler output must go through the same manifest validation, safety review, tests, and adversarial review gates as hand-authored adapters.
