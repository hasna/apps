# Security policy

Computers is pre-1.0. Do not expose it to untrusted networks until an operator has configured bearer principal hashes, TLS termination, an allowed-origin list, secure filesystem permissions, backup, and an external audit sink.

Report vulnerabilities privately through GitHub Security Advisories for `hasna/computers`. Do not include live credentials, private tenant data, or exploit traffic against systems you do not own.

The core security boundary is the controller, not the guest. A guest agent is arbitrary and untrusted. The guest must have no host/cloud/provider credentials, controller database or signing key, resident key, Sandbox key, sudo/root, Docker socket, hypervisor socket, host SSH agent, or lifecycle authority. Stopping or killing a future resident must not remove external stop, quarantine, revocation, or network isolation.

Known pre-release residuals are documented in `docs/threat-model.md` and `docs/providers.md`. In particular, this slice does not implement mTLS, a privileged resident daemon, provider isolation, or egress enforcement.
