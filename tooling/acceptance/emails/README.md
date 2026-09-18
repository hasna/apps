# Isolated Emails API and worker acceptance

`run.py` exercises preloaded, immutable Linux/amd64 Emails images against a
disposable PostgreSQL 16 Alpine instance and synthetic SQS, S3, SES and Resend
wire fixtures. It starts the real API and `ingest-worker` entrypoints; auxiliary
probe files are mounted under `/fixtures`, never over application code.

```sh
python3 -B tooling/acceptance/emails/run.py --pair /absolute/pair.json --output /absolute/new-proof.json
```

The pair input has exactly these fields:

```json
{
  "schema_version": 1,
  "api": {
    "image": "registry.example/emails@sha256:<64 hex>",
    "source_sha": "<40 hex>",
    "version": "1.2.3",
    "command": ["src/server/index.ts"],
    "manifest_path": "/absolute/api-manifest.json",
    "config_path": "/absolute/api-config.json"
  },
  "worker": {
    "image": "registry.example/emails@sha256:<64 hex>",
    "source_sha": "<40 hex>",
    "version": "1.2.3",
    "command": ["src/server/index.ts", "ingest-worker"],
    "manifest_path": "/absolute/worker-manifest.json",
    "config_path": "/absolute/worker-config.json"
  },
  "postgres": {"image": "docker.io/library/postgres@sha256:<64 hex>"},
  "migrations": {"reviewed-migration-id": "sha256:<64 hex>"}
}
```

Supply the complete reviewed migration map, including dependency migrations.
There is no hardcoded migration count. Both images must report that exact map.
Missing, altered and unknown database ledger entries must stop the actual
worker before its first transport request. A legacy worker without this fence
fails acceptance, even if its API is otherwise compatible.

The raw single-platform OCI or Docker schema-2 manifest and config bytes must
hash to the immutable reference and local Docker config ID. Config, filesystem
diff IDs, source/version labels, runtime package version, architecture and
entrypoints are checked. Compressed layer descriptors are retained; the local
Docker content store is trusted to have verified those layers when it loaded
the image. The runner neither downloads nor independently re-extracts them.
The caller remains responsible for source-to-image build provenance.

The runner uses only the local Unix Docker socket with a fresh credential-free
Docker configuration. It does not pull, build, push or log in. Containers use
an internal bridge, no published ports, read-only roots, dropped capabilities,
bounded resources and no host credential mounts. External DNS forwarding is
disabled. PostgreSQL credentials, API keys and a fixture HTTPS certificate are
generated for the run. Resend requests use the real HTTPS client with internal
DNS and the fixture CA; TLS verification stays enabled. No real provider or
production queue is contacted. The PostgreSQL fixture expects the official
Alpine UID 70 layout; incompatible fixtures fail.

API probes cover authenticated routes, two-tenant isolation and forced RLS,
From display names, Reply-To, parent-derived reply headers, provider success,
definitive rejection, uncertain responses and send idempotency. Worker probes
cover schema refusal, envelope-based tenant routing despite forged MIME
recipients, duplicate delivery, failed acknowledgement and object-read retry,
progress, visible queue sampling and detection/recovery of a stalled read.

The unsigned `emails.isolated-pair-acceptance.v1` proof binds the runner, input,
images, migration map and each observation. `deployment_authorized` and
`production_configuration_verified` are always false. Passing synthetic
fixtures does not prove production secret resolution, task configuration,
real provider delivery, consumer inbox rendering or deployment authority.
A protected producer must authenticate and verify those separate facts before
incorporating this proof into any deployment receipt. The route list is the
explicit tested list, not a claim that every application route was tested.

CI builds its reviewed checkout and pushes only to an ephemeral loopback
registry, resolves the resulting immutable manifest and feeds the already
loaded image to the no-pull runner. Its artifact is explicitly labelled
`locally-built-ci-fixture`; it is not evidence that an existing production
candidate image passed. The workflow runs on ordinary PRs without cloud
credentials, deployment permissions or external image publication.

Local tests (no Docker daemon required):

```sh
python3 -B -m unittest discover -s tooling/acceptance/emails -p '*_test.py'
bun --no-env-file --no-install test tooling/acceptance/emails/transports.test.ts
```
