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
  files/ec2/...          # 32G Graviton cloud-station overlay (slice values, swap, aws CLI, SSM floor)
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

## What v1 covers

| Item | Lesson (2026-07-28) |
|---|---|
| `/etc/sysctl.d/99-zz-hasna-station.conf` (swappiness=60, min_free_kbytes=1048576, watermark_scale_factor=150, kernel.panic=10) | reclaim-livelock panic; a `99-*` fix lost ordering to vendor `99-dgx-spark.conf`, hence `99-zz-` and the ordering check |
| `/etc/tmpfiles.d/99-zz-hasna-station-mglru.conf` (`min_ttl_ms=1000`) | MGLRU knob was runtime-only, would not survive reboot |
| earlyoom drop-in (`-m 4 -s 25 -r 300`, avoid sshd/tmux-server/systemd/journald, prefer node/bun/rustc/java, StartLimit 300/5) | the old guard computed swap depth and ignored it; kill-drill proven on station02 2026-07-28 |
| `hasna-agents.slice` / `hasna-hq.slice` (per hardware class) | slices existed but nothing ran in them; the roster reconciler launches into them |
| unit conventions check (`StartLimitIntervalSec=300`, `StartLimitBurst=5`, `OnFailure=`, absolute `ExecStart`) | 203/EXEC bare-ExecStart bug; ~290k-restart loop; 0/40 units had StartLimit keys |
| tailscale install + join (auth key by secret NAME, `file:` reference, `--ssh`; **non-fatal** — see criticality doctrine) | cloud stations have no public ingress; the tailnet is the access plane — but never a boot dependency (station17, 2026-07-29) |
| bun + hasna CLI set, secrets bootstrap (names only) | cattle contract: a replacement box must converge unattended |
| ec2 overlay: 8G swapfile, aws CLI command, SSM access floor, 20G/24G agent slice | EC2 has no swap by default; 32G class needs real agent bounds; SSM is the no-secret floor that kept station17 recoverable |

## Criticality doctrine (owner ruling 2026-07-29)

**Tailscale is an access path, not a boot dependency.** A failed tailscale
install or join must never produce an unreachable station: the box still comes
up, stays reachable by its floor path, and reports the failure as drift
(`tailscale:join`). The general form: *nothing that requires fetching a secret
at boot may sit on the critical path to a machine's reachability.*

Measured trigger: station17 (`i-0d2bc38f8a7496bda`), first render of the ec2
layer, stranded itself when the join's `aws` call ran before awscli existed —
zero SG ingress, no keypair, not on the tailnet. SSM (instance profile only,
no boot-time secret) was the only way back in.

How the template implements it:

- **`accessFloor`** (per layer): the guaranteed access service for the class.
  The ec2 overlay declares the SSM agent (`snap.amazon-ssm-agent.amazon-ssm-agent`,
  preseeded in Ubuntu AMIs, authorized purely by the instance profile). Both
  renders emit its ensure FIRST and non-fatally; the drift check reports a down
  floor as a **violation** (`access-floor:<service>`), because that box is one
  tailscale failure from unreachable. Physical classes declare no floor
  service — their floor is an out-of-band path (console/physical port), which
  the template cannot render.
- **Non-fatal tailscale entries**: install and join in both renders end in a
  loud `NON-FATAL` warning instead of a failing exit — cloud-init's runcmd and
  `runSetupPlan` (which aborts on the first non-zero step) both survive a vault
  hiccup, an IMDS hiccup, or a missing binary. Silent success-masking is
  equally forbidden: the warning plus the `tailscale:join` drift item are the
  record.
- **Required-command installs degrade to drift**, never a dead boot: a failed
  `commands[]` install warns and leaves `command:<id>` to the drift check.

Tailscale stays in `base`: it is the uniform access plane across all station
classes (physical boxes behind NAT have no alternative) and does peer-to-peer
work SSM cannot. Only its *criticality* changed.

Positive controls: the rendered floor/install/join entries are executed under
`sh -e` with the join forced to fail (station17 mode: `aws` absent) and must
exit 0, reach the entry after the join, warn on stderr, and have enabled the
floor first; the harness itself is proven able to fail on a planted fatal
entry; a down floor and an unjoined station are each planted and must be
reported.

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
