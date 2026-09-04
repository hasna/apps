# Cross-machine dispatch

`dispatch` can deliver a prompt to a tmux window on **another machine** — the same
delivery/auto-submit/confirmation logic, just executed over SSH.

```bash
dispatch send --machine spark01 --to work:agent --prompt "build it"
dispatch targets --machine spark01            # discover panes on the remote host
```

## How it routes

The `Runner` abstraction is the only thing that changes between local and remote:

- **Local** (`--machine` omitted, `local`, `localhost`, or this hostname) → `LocalRunner`
  runs tmux via `spawnSync`.
- **Remote** → `RemoteRunner` quotes the tmux argv into a single shell command and resolves
  how to reach the host through a `MachineCommandResolver`. The built-in resolver is plain,
  non-interactive `ssh <machine> '<cmd>'`, with the host resolved by your SSH config / DNS
  (a Tailscale MagicDNS `Host` entry works well here):

  ```ts
  import { sshMachineCommandResolver } from "@hasna/dispatch";
  sshMachineCommandResolver("spark01", "tmux send-keys ...");
  // → { source: "ssh", shellCommand: "ssh -o BatchMode=yes ... 'spark01' 'tmux send-keys ...'" }
  ```

  Route resolution is pluggable: pass your own resolver to `createRunner(machine, resolve)`
  to route over LAN addresses, Tailscale MagicDNS, or any other transport.

  ```ts
  import { createRunner, type MachineCommandResolver } from "@hasna/dispatch";

  const viaTailscale: MachineCommandResolver = (id, command) => ({
    source: "tailscale",
    shellCommand: `ssh ${id}.<tailnet>.ts.net ${JSON.stringify(command)}`,
  });
  const runner = await createRunner("spark01", viaTailscale);
  ```

  > `@hasna/machines` used to provide this resolution and was deleted from the registry
  > (2026-09-03, issue #1603). `@hasna/dispatch` no longer depends on it: the topology
  > types are vendored in `src/lib/runner.ts` and remote routing defaults to plain SSH.

Because tmux text payloads travel as a properly-quoted single argument and large prompts
are piped via stdin (`load-buffer -`), long and multi-line prompts cross the SSH boundary
without corruption — bracketed paste still applies on the remote pane.

Remote commands default to a 20s timeout because real tmux operations over SSH/Tailscale
can take several seconds during route setup. Override it with
`DISPATCH_REMOTE_TIMEOUT_MS=<ms>` when you need faster failure behavior, especially for
bulk runs against machines that may be down.

## Requirements

- Passwordless SSH to the target host (key/agent), reachable over LAN or Tailscale.
- `tmux` installed on the target host.
- For Tailscale/LAN routes: an SSH `Host` entry (or MagicDNS name) for the machine, or a
  custom `MachineCommandResolver` passed to `createRunner`. `dispatch` has no optional
  topology dependency; name resolution falls to your SSH config by default.

## Scheduling + cross-machine

A scheduled dispatch carries its `machine`, so the daemon fires cross-machine dispatches
too:

```bash
dispatch schedule --machine spark01 --to work:agent --prompt "nightly" --cron "0 2 * * *"
dispatch schedule --machine spark01 --to work:agent --prompt "follow up" --in 30m
dispatch loop --machine spark01 --to work:agent --prompt "summarize status" --every 5m --name spark01-status
```

Keep the daemon always live on the machine where the schedule is stored. On Linux hosts:

```bash
dispatch daemon service install --start
dispatch daemon service status
dispatch daemon status --json
```

The daemon status includes the next due item and recent schedule/loop failures. Cross-machine
delivery failures are recorded on the schedule/loop as `lastFailureAt`,
`lastFailureReason`, and `failureCount`; interval loops retry at their next interval.
