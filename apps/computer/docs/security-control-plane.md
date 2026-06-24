# Security Control Plane

This document defines the control-plane threat model and capability taxonomy for open-computer. The system goal is powerful local and fleet computer control, but model output is never authority by itself. Every high-risk capability must pass through a typed route, policy decision, approval checkpoint when required, audit event, and runtime ledger entry.

## Threat Model

### Actors

- Operator: the human or service account that starts the process, configures API keys, grants OS permissions, and approves high-impact actions.
- Local agent process: the open-computer CLI, MCP server, REST server, or SDK consumer that owns local runtime state.
- AI model provider: OpenAI, Anthropic, or AI SDK provider calls that propose plans, actions, and verifier decisions. Provider output is untrusted input to the policy layer.
- MCP or REST client: local tools, dashboards, agents, or remote callers using stdio, Streamable HTTP, or the REST API.
- Browser extension lane: the open-browser extension and visible browser session used for non-headless browser control.
- Fleet lane: open-machines and machine-local agents used to discover, route to, and validate remote machines.
- Storage lane: local SQLite and optional PostgreSQL sync target.
- Adversary: prompt-injected web content, malicious or compromised MCP/REST clients, hostile local processes, compromised browser tabs/extensions, stale fleet machines, and accidental operator overreach.

### Trust Boundaries

- OS boundary: screenshots, accessibility trees, mouse, keyboard, app launch, and terminal commands can expose or mutate the operator's machine. macOS permissions and open-computer policy both apply.
- Provider boundary: screenshots, prompts, plans, and verification evidence may leave the machine for model inference. Model responses must be treated as recommendations only.
- Transport boundary: stdio inherits the authority of the launching process. HTTP transports require API-key auth by default; unauthenticated mode is only allowed on loopback when explicitly enabled.
- Browser boundary: browser status and snapshots are read-only by default. Navigation, clicking, typing, keypresses, and scrolling in a visible browser require approval routing before execution.
- Fleet boundary: machine discovery and route checks are read-only by default. Remote smoke runs and artifact pulls require approval and machine-scoped evidence.
- Storage boundary: local reads are allowed. Remote push, pull, and sync require explicit sync consent and audit.
- Runtime boundary: workflow runs, steps, leases, approvals, artifacts, policy decisions, audit events, and model usage form the durable ledger for replay and review.

## Default Posture

- REST and Streamable HTTP MCP sensitive endpoints require `COMPUTER_API_KEY` unless `COMPUTER_ALLOW_UNAUTHENTICATED=1` is set on loopback.
- Provider fallback is disabled by default to avoid surprise provider spend or cross-provider data movement.
- Terminal command execution requires an approved workspace directory and explicit operator approval. Destructive command classes are blocked even with approval.
- Password typing is blocked by default through `safety.allowPasswordTyping=false`.
- Keychain Access, System Settings, and System Preferences are blocked by default app targets.
- Remote storage sync requires `HASNA_COMPUTER_STORAGE_SYNC_CONSENT=1`.
- Resource leases enforce a single active controller for shared resources such as `computer_display`, `terminal_session`, `browser_extension_session`, and `fleet_machine`.
- Emergency stop, session pause/resume, and session cancel are run-control gates checked before policy-backed actions.
- Fleet mutations require the secure remote transport contract in `docs/secure-remote-transport.md`; approval alone is not enough to run a remote job.

## Capability Taxonomy

| Capability | Owner | Transport or Entry | Default State | Auth Requirement | Approval and Policy | Audit or Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `computer.screenshot` | open-computer | CLI, SDK, MCP, REST, planner `computer` tool | Allowed as read-only, subject to run control | HTTP requires API key unless loopback unauth is explicit | No operator approval by default; still policy-backed for run control and audit | `action.policy_decision`, screenshot observation/artifact when part of a run |
| `computer.accessibility_tree` | open-computer | MCP `computer_accessibility`, future observation tool | Allowed as read-only | HTTP MCP requires API key unless loopback unauth is explicit | No mutation approval, but output must be treated as sensitive screen data | MCP response plus optional observation evidence |
| `computer.click` and `computer.scroll` | open-computer | CLI run loop, SDK, MCP, REST, planner `computer` tool | Allowed when safety policy permits | HTTP requires API key unless loopback unauth is explicit | `confirmClicks=true` upgrades clicks to approval-required; run control and display lease always apply | `action.policy_decision`, `action.executed`, run step result, screenshot evidence |
| `computer.type` and `computer.key` | open-computer | CLI run loop, SDK, MCP, REST, planner `computer` tool | Allowed when safety policy permits; password typing blocked by default | HTTP requires API key unless loopback unauth is explicit | Sensitive typing is blocked by safety; approval may be required by caller policy; typed text is redacted in route audit | `action.policy_decision`, redacted planner route input, run step result |
| `computer.open_url` | open-computer | CLI run loop, SDK, MCP, REST, planner `computer` tool | Allowed for `http` and `https` planner URLs; driver execution still goes through policy | HTTP requires API key unless loopback unauth is explicit | Blocked domains can deny; browser mutation should prefer the browser lane when a session exists | `action.policy_decision`, run step result |
| `app.open` | open-computer | CLI app command, MCP `computer_open_app`, planner `app` tool | App launch allowed when target app is not blocked | HTTP MCP requires API key unless loopback unauth is explicit | Blocked apps deny. Deterministic app-driver options with commands enter `terminal.exec` policy | `action.policy_decision`, route audit |
| `terminal.exec` / `computer.terminal` | open-computer Ghostty driver | MCP `computer_open_app`, planner `terminal` tool, app driver SDK | Requires confirmation for commands or working directory mutations | HTTP MCP requires API key; terminal command approval token is separate | Requires approved workspace root and operator approval; command blocklist denies sudo, raw disk, broad destructive, and download-execute patterns | Redacted `terminal.policy_decision`, transcript manifest, command count, pane count |
| `browser.status` and `browser.snapshot` | open-browser | Planner `browser` tool, future extension bridge | Allowed as read-only | Browser bridge must authenticate to its local control endpoint when exposed | No approval by default; snapshots are sensitive and should be scoped to active session | `planner.route_decision`, future browser snapshot observation |
| `browser.navigate`, `browser.click`, `browser.type`, `browser.key`, `browser.scroll` | open-browser | Planner `browser` tool, future extension bridge | Requires confirmation | Browser bridge must authenticate to its local control endpoint when exposed | Browser mutations require approval and a live non-headless extension session; typed text is redacted in route audit | `planner.route_decision`, browser snapshot/trace artifact |
| `fleet.capabilities` and `fleet.route` | open-machines | Planner `fleet` tool, live-machine validation scripts | Allowed as read-only | Fleet control endpoint or machine credential required by open-machines | No mutation approval by default; machine IDs and routes are scoped resource IDs | `planner.route_decision`, fleet status observation |
| `fleet.run_smoke` and `fleet.pull_artifact` | open-machines | Planner `fleet` tool and future execution adapters; live-machine validation is a lab-only opt-in gate | Requires confirmation and then secure transport binding | SSH agent, open-machines MCP API key over loopback or HTTPS, or resident-agent auth; plain remote HTTP is blocked | Requires approval, explicit transport opt-in, matching machine binding, verified machine/action/transport capability token, and `fleet_machine` resource lease before remote mutation or artifact extraction. Artifact pulls also require approved namespace/source scope, max size, private-name rejection, hash-only default, expected digest for materialization, and matching materialized-pull approval before bytes are copied. | `planner.route_decision` with redacted `fleet_transport` and `artifact_pull`, fleet status/artifact evidence |
| `storage.status` | open-computer storage lane | CLI, MCP, planner `storage` tool | Allowed as read-only | HTTP MCP requires API key unless loopback unauth is explicit | No approval by default | storage status output, route audit |
| `storage.push`, `storage.pull`, `storage.sync` | open-computer storage lane | CLI, MCP, planner `storage` tool | Requires confirmation and explicit remote sync consent | HTTP MCP requires API key unless loopback unauth is explicit | Denied unless storage consent env is set; table list is validated by storage layer | `storage.policy_decision`, sync result, storage history |
| `memory.record` and `observation.record` | open-computer runtime | Planner `memory` and `observation` tools | Allowed as local ledger writes | Same auth as caller transport | No approval by default; content should avoid secrets and use source refs for artifacts | Runtime observation row, artifact reference, route audit |
| `approval.request` | open-computer runtime | Planner `approval` tool, run loop | Allowed | Same auth as caller transport | Creates a durable checkpoint; does not grant execution by itself | `approvals` row, route audit |
| `computer.run_task` | open-computer | CLI, MCP, REST | Allowed only through authenticated or local process authority | HTTP requires API key unless loopback unauth is explicit | Each proposed action still passes safety, run-control, lease, and approval gates | Session, workflow run, steps, observations, model usage |
| `computer.delete_session` | open-computer | CLI, MCP, REST | Allowed to authorized caller | HTTP requires API key unless loopback unauth is explicit | No model approval; should be treated as an administrative mutation | `session.delete` audit |
| `computer.pause_session`, `computer.resume_session`, `computer.cancel_session`, and `computer.emergency_stop` | open-computer | CLI control, MCP, REST | Allowed to authorized caller | HTTP requires API key unless loopback unauth is explicit | No model approval; operator/run-control administrative action. Pause is non-terminal and non-aborting; cancel and emergency stop abort active signals | `run_control.*` audit |
| `provider.analyze`, planner, and verifier model calls | open-computer providers / AI SDK | CLI run loop, `computer plan`, verifier loop | Allowed when configured provider credentials exist | Provider API key required by provider SDK | Provider output cannot bypass local policy; fallback is opt-in and failure-class scoped | `model_usage`, provider fallback audit, prompt metadata |

## Required Invariants

- A model can request an action, but only policy code can authorize it.
- Every transport that can mutate machine, browser, fleet, terminal, storage, or session state must have an auth story and an audit event.
- Read-only data can still be sensitive. Screenshots, accessibility trees, browser snapshots, terminal transcripts, and pulled artifacts must be retained only as explicit observations or artifacts.
- Approval is capability-scoped. Approval to plan, inspect, or request a checkpoint is not approval to execute terminal, browser, fleet, storage, or OS mutation.
- Terminal audit must not store raw command text. It records app, command count, directory presence, transcript identifiers, and policy outcome.
- Browser and fleet adapters must preserve the open-computer runtime boundary: route first, acquire resource lease, execute through the owning app, then attach evidence.
- Fleet adapters must preserve the secure remote transport order: route, artifact contract, approval, explicit authenticated transport, capability token, machine binding, lease, execution, artifact audit.
- Release candidates must package this document and keep it aligned with the policy/router/runtime schema.

## Known Gaps For The Roadmap

- The browser rows describe the intended open-computer route contract; open-computer still needs execution adapters that call open-browser with the same approval, lease, and artifact rules.
- The fleet execution adapter is still future work, but the planner route already fails closed for approved fleet mutations unless a secure remote transport record is provided.
- REST `/action` exposes low-level action execution to authorized callers. It is policy-backed, but it does not currently create a durable workflow run for every single direct action unless the caller uses the higher-level run loop.
- MCP stdio assumes the launching process is trusted. Operators should prefer HTTP auth boundaries for shared agent environments.
- Per-domain browser policies and per-machine fleet trust profiles are not yet persisted in the open-computer runtime.
