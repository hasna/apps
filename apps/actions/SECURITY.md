# Security

Report security issues privately to the Hasna maintainers. Do not open public
issues for suspected vulnerabilities.

Keep raw secret values out of manifests, run input, metadata, evidence, and
executor `env` fields because the local store persists those objects as JSON.
Manifest validation does not scan arbitrary values for secrets or enforce
`audit.redactedFields`; hosts must resolve scoped secret references at execution
time and redact sensitive fields before persistence or external audit delivery.

Local-shell actions inherit only `PATH`, `HOME`, and temporary-directory
variables by default. Review any manifest that sets `inheritEnv: true`, because
it forwards the complete parent process environment to the child.
