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
| tailscale install + join — **physical overlays only** (auth key by secret NAME, `file:` reference, `--ssh`; **non-fatal** — see criticality doctrine) | physical boxes behind NAT need a mesh access path; AWS stations carry NO tailscale at all (owner ruling 2026-07-30) — SSM is their whole access path |
| bun + hasna CLI set, secrets bootstrap (names only) | cattle contract: a replacement box must converge unattended |
| ec2 overlay: 8G swapfile (space-guarded, convergent), aws CLI command, SSM access floor, 64G root-volume floor, 20G/24G agent slice | EC2 has no swap by default; 32G class needs real agent bounds; SSM is the no-secret access path; build 2 (2026-07-29) filled an 8G AMI-default root volume with the swapfile and lost cloud-final |

## No tailscale on AWS stations (owner ruling 2026-07-30)

**AWS stations do not run tailscale — at all — and the cloud fleet is not
connected to the physical fleet.** Joining EC2 hosts to the tailnet that
carries the operator's home and office machines makes every cloud instance a
peer of every physical station; that blast radius outweighs the uniformity
convenience the 2026-07-29 design chose. This supersedes the "uniform access
plane across all station classes" doctrine below on the placement axis:

- The `tailscale` block and the `tailscaled` service live only in **physical
  overlays** (`dgx-spark`). The base layer carries neither, so
  `base.tailscale.authKeySecretName` is structurally unreachable from a
  `station,ec2` render.
- The rendered `station,ec2` cloud-init contains **no tailscale install, no
  join, no auth-key fetch** — asserted in `test/station-template.test.ts` with
  a positive control that plants tailscale into a copied template and proves
  the assertion goes red.
- The EC2 drift report carries **no `tailscale:join` item in any status** — a
  check for a thing we deliberately do not run is noise, and noise is how real
  drift gets ignored. Physical classes keep theirs.
- **SSM is the whole access path for cloud stations**, not a floor beneath a
  mesh. The `accessFloor` machinery and the aws-CLI-v2 command fix from 0.2.4
  survive unchanged and are now load-bearing.
- A *single* AWS box may later be granted tailscale as a deliberate,
  argued-for exception via its own overlay — never the default, never base.
  The render/check code paths stay data-driven for that case and their
  non-fatality remains proven via a planted opt-in overlay test.

## Criticality doctrine (owner ruling 2026-07-29 — placement superseded 2026-07-30, criticality still in force for physical classes)

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

Tailscale placement: **physical overlays only** since 2026-07-30 (see the
section above). The 2026-07-29 "stays in base as the uniform access plane"
reasoning is superseded — the criticality rules in this section still govern
wherever a physical layer (or a future argued-for exception overlay) declares
tailscale.

Positive controls: the rendered floor/install/join entries are executed under
`sh -e` with the join forced to fail (station17 mode: `aws` absent) and must
exit 0, reach the entry after the join, warn on stderr, and have enabled the
floor first — driven from a planted opt-in overlay since no shipped cloud
layer joins; the harness itself is proven able to fail on a planted fatal
entry; a down floor and an unjoined physical station are each planted and must
be reported.

## Root-volume floor and convergent swap (station17 build 2, 2026-07-29)

Build 2 (`i-0f522f0138a0411e1`) launched with no `BlockDeviceMappings`, so the
AMI-default **8G** gp3 root volume shipped under an overlay demanding an **8G
swapfile**. Measured over SSM: `fallocate -l 8G` allocated 4.2G of extents
until ENOSPC, `/` hit 100% with 364K free, journald could not create a system
journal, and `cloud-final.service` FAILED 43.8s into `modules-final` — while
the old `test -f /swapfile ||` guard treated the partial file as done forever
(`swapon --show` empty). Two changes:

- **`disk.rootMinGb`** (ec2: 64): the launcher must request at least this root
  volume explicitly; the drift check reads `df -kP` and reports an undersized
  root as a **violation** (`disk:root`) because setup cannot converge it — the
  fix is a relaunch.
- **Convergent, space-guarded swap**: both renders guard on *active* swap
  (`swapon --show`), remove a stale/partial file before retrying, refuse to
  allocate without `sizeGb + 2G` of free headroom (loud `NON-FATAL` warning,
  `swap:size` drift), and deduplicate the fstab entry.

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
