# Security

Benchmark runners often execute third-party code, download datasets, call model providers, and process untrusted outputs.

Rules for this package:

- Do not store raw API keys or tokens in manifests, results, logs, or task evidence.
- Store only `secretRef` values or environment variable names.
- Treat runnable adapters as unsafe until they declare sandbox, network, timeout, and cost requirements.
- Prefer dry-run plans before executing a benchmark harness.
- Persist evidence with redaction and checksums.
- Do not pass credentials as `--model`, `--provider`, metric metadata, artifact paths, payload fields, or JSON fixtures. Use environment variable names and external secret stores.
- Do not enable real external execution without an isolated sandbox, network policy, cost budget, timeout, and cleanup evidence.

Default CLI smoke commands do not require secrets. Commands that acknowledge remote providers should use `--secret-ref ENV_VAR_NAME`, not the secret value.

The package creates local state by default. `postinstall` creates `~/.hasna/bench`, and commands such as `doctor`, `runs record`, and `runs fixture` can create SQLite databases and JSONL evidence under that directory. Set `HASNA_BENCH_HOME` and `HASNA_BENCH_DB_PATH` to isolate smoke tests.

`--network` is an acknowledgement recorded in evidence policy. It is not permission for this release to execute external benchmark code, because no external runner is implemented.

Report security issues privately to the repository maintainers once the GitHub repository is available.
