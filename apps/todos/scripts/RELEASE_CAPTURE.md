# Release command capture

The release gate preserves its synchronous helper API and executes each command
once. A private Bun worker uses asynchronous pipes and waits for both stream EOFs
and the child exit before writing a completion receipt. The supervisor does not
capture worker output through pipes. It checks receipt size, output byte counts,
SHA-256 hashes and regular private files before accepting a result.

Each stream is limited to 256 MiB, including a byte-bounded file read in the
supervisor. Exceeding either limit kills the command and fails the capture.
Missing or malformed evidence, stream errors and worker death also fail closed.
Nonzero command exits retain their status and stderr; no command is retried.

Commands and arguments travel over bounded stdin, not a request file. The worker
inherits the requested environment in memory. Capture files are mode 0600 in an
exclusive mode 0700 temporary directory, removed after verification. Command
output may contain sensitive values, so diagnostics do not print request data or
worker errors. The files are transient verification evidence, not a durable
release journal or an authorization boundary against the invoked command itself.

This is defensive hardening for a CI observation: Bun 1.3.14 returned status zero
with a short binary capture. Local Mac and Linux ARM64 pressure probes did not
reproduce the truncation. The node compatibility implementation delegates to
native Bun.spawnSync, so switching between those APIs alone does not avoid the
same synchronous capture engine. Actual CI AMD64 verification remains required;
these tests do not establish the runtime defect's root cause.
