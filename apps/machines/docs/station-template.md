# Station template v1 (`hasna.station_template.v1`)

The versioned station template turns the 2026-07-28 station01 incident fixes
from hand-applied one-offs into declarative, checkable state. Design:
`designs/station-contract-design.md` §8 (CEO workspace); this is the v1
artifact that P4 (`machines sync` convergence, script absorption) builds on.

**Every item traces to a measured failure.** Each file/convention in
`templates/station/template.json` carries a `lesson` field naming the failure
it prevents. Do not add lines without one.

## Layout

```
templates/station/
  template.json          # hasna.station_template.v1 (semver-versioned)
  files/base/...         # sysctl, tmpfiles, earlyoom drop-in
  files/dgx-spark/...    # 121G physical Spark overlay (slice values)
  files/ec2/...          # 32G Graviton cloud-station overlay (slice values, swap, awscli)
```

## Commands

```bash
# plan (never mutates): base setup steps + template steps
machines setup --template station,dgx-spark

# apply on a physical box (mutation-gated like every setup apply)
machines setup --template station,dgx-spark --apply --yes

# drift check: read-only, JSON verdict — parse the JSON, never the exit code.
# It inspects THIS box; the report carries "machineId" so a fleet sweep can
# attribute it. Passing --machine <other> is rejected, not silently ignored —
# run it over SSH on that station instead.
machines setup --template station,dgx-spark --check

# cloud render: user-data for an EC2 station (same source, second serialization)
machines setup --template station,ec2 --render cloud-init --station station17 > user-data.yaml
```

## Roster controller (station01)

Copy `templates/station/roster.example.json` to
`~/.hasna/machines/roster.json`, replace every placeholder, and keep
`applyMode` set to `manual` through the first kill drill. A manual pass is:

```bash
HASNA_MACHINES_ALLOW_MUTATIONS=1 machines-agent roster reconcile \
  --config "$HOME/.hasna/machines/roster.json" --apply --drill-level tmux-kill
```

The controller reads live tmux panes, its SQLite launch history, and seat
heartbeats; it never treats a tmux-resurrect snapshot as desired state. It
launches only `accounts launch <profile>` seats through `systemd-run` in
`hasna-agents.slice`, never sends prompts or work. After the drill proves
batching, resource refusal, crashloop latching, and functional storage checks,
change `applyMode` to `auto` and enable the shipped user unit. The unit remains
conditioned on the config file existing:

```bash
systemctl --user daemon-reload
systemctl --user enable --now machines-roster.service
systemctl --user status machines-roster.service
```

## What v1 covers

| Item | Lesson (2026-07-28) |
|---|---|
| `/etc/sysctl.d/99-zz-hasna-station.conf` (swappiness=60, min_free_kbytes=1048576, watermark_scale_factor=150, kernel.panic=10) | reclaim-livelock panic; a `99-*` fix lost ordering to vendor `99-dgx-spark.conf`, hence `99-zz-` and the ordering check |
| `/etc/tmpfiles.d/99-zz-hasna-station-mglru.conf` (`min_ttl_ms=1000`) | MGLRU knob was runtime-only, would not survive reboot |
| earlyoom drop-in (`-m 4 -s 25 -r 300`, avoid sshd/tmux-server/systemd/journald, prefer node/bun/rustc/java, StartLimit 300/5) | the old guard computed swap depth and ignored it; kill-drill proven on station02 2026-07-28 |
| `hasna-agents.slice` / `hasna-hq.slice` (per hardware class) | slices existed but nothing ran in them; the roster reconciler launches into them |
| `machines-roster.service` (dgx-spark) | station01's old `/opt/fixture` unit was not the packaged controller and its heartbeat had gone stale |
| unit conventions check (`StartLimitIntervalSec=300`, `StartLimitBurst=5`, `OnFailure=`, absolute `ExecStart`) | 203/EXEC bare-ExecStart bug; ~290k-restart loop; 0/40 units had StartLimit keys |
| tailscale install + join (auth key by secret NAME, `file:` reference, `--ssh`) | cloud stations have no public ingress; the tailnet is the access plane |
| bun + hasna CLI set, secrets bootstrap (names only) | cattle contract: a replacement box must converge unattended |
| ec2 overlay: 8G swapfile, awscli, 20G/24G agent slice | EC2 has no swap by default; 32G class needs real agent bounds |

## Check semantics

`--check` is a pure read: file content (sha256), sysctl runtime values
(`/proc/sys`), MGLRU runtime value, package presence, service state, unit
conventions, and the **ordering rule** — a managed sysctl file must sort last
among all files in its directory that define any of its keys. Verdict is in
the JSON (`"verdict": "clean" | "drift"`); exit codes are not the interface.

It reads the **local** filesystem only. The report names the box it describes
in `"machineId"`, and `--machine <other>` is a hard error rather than a report
of local state under a remote name — a fleet sweep that got the latter would
see the coordinator's own box N times and call the fleet converged.

Unit conventions compare **declared values**, not just key presence:
`StartLimitIntervalSec` is compared as a systemd time span (so `5min` passes
and `300ms` does not), `StartLimitBurst` numerically, and `OnFailure` as a
systemd list — accumulating across drop-ins, honouring the empty-value reset,
and requiring the convention target to survive it. A unit carrying the
default-class `10s`/burst window is the exact 2026-07-28 restart-loop shape and
is reported as a violation.

Positive controls live in `test/station-template.test.ts`: planted content
drift, a planted later-sorting conflicting sysctl file, planted runtime drift,
a planted convention-violating unit, a unit whose keys are all present but
whose values are the incident's (`10`/`99999`/wrong `OnFailure`), a drop-in
that lowers the window under a compliant unit file, and a rejected
`--check --machine <other>` must each be detected — a check that cannot fail is
not evidence.

## Versioning

Template version is semver inside `template.json`, ships with the
`@hasna/machines` package, and is stamped into
`~/.hasna/machines/template-state.json` on cloud-init apply. Rolling a change:
bump version → publish → `machines sync --apply` per station (P4) / AMI or
user-data refresh for cloud stations.
