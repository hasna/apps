# Security

Report security issues privately to the Hasna maintainers. Do not open public
issues for suspected vulnerabilities.

Do not put raw credentials in manifests, action inputs, executor arguments, or
executor environment values. The current structural manifest validation does
not detect or reject secrets, and `audit.redactedFields` is declarative metadata
rather than an automatic redaction pass.

Local-shell actions inherit only `PATH`, `HOME`, `TMPDIR`, `TEMP`, and `TMP` by
default, plus the binding's explicit `env` values and `OPEN_ACTIONS_*` context
variables. Setting `inheritEnv: true` forwards the full process environment and
should be reserved for trusted commands. See [Storage and security](docs/storage.md)
for the complete boundary.
