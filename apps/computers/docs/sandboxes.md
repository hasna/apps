# Computers and Sandboxes

A Computer is a durable lifetime device identity with an owner, home, policy generation, resident identity, and long-lived operation history. A Sandbox is an ephemeral, externally brokered child execution environment.

Sandboxes integration is disabled in this release. No CLI, API, SDK, or MCP call can execute Sandbox mutation. The discoverable REST placeholder returns deterministic `sandbox_disabled`. No Sandbox provider key, cloud credential, Docker socket, hypervisor socket, or controller authority is available to the guest.

Future child creation must use a resident-certificate-derived parent identity, monotonic subset authority, hard TTL/resources/cost, and an atomic idempotent external reservation. It cannot be enabled until the external service passes authentication, tenant isolation, CORS, and secret-persistence gates.
