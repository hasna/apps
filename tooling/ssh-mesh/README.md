# ssh-mesh — fleet SSH access management (SSH CA model)

Central SSH certificate authority signing short-lived certificates for
per-station keypairs. No private key ever leaves its station; hosts trust one
root-level CA key.

## Architecture

    station03 (control host)                 every station
    ───────────────────────                  ──────────────
    ~/.ssh/hasna_fleet_ca    (CA, 0600)      ~/.ssh/id_ed25519_fleet           (own key)
    vault: hasna/fleet/ssh/ca/private-key    ~/.ssh/id_ed25519_fleet-cert.pub  (90d cert)
    ~/.ssh/fleet-pubkeys/ (pubkeys + certs,  /etc/ssh/sshd_config.d/30-hasna-fleet-ca.conf
                           one pair per      TrustedUserCAKeys /etc/ssh/ca.hasna-fleet.pub
                           station)

- **Trust anchor: `TrustedUserCAKeys`** (root-level config, applied by
  `ssh-mesh trust <nn> | trust-local`). The user-level `@cert-authority` line
  in `authorized_keys` is kept for legacy servers but is empirically IGNORED
  by the sshd builds in this fleet (Ubuntu 9.6p1 and Apple macOS builds) —
  do not rely on it.
- Certificates: 90d validity, principals `hasna,andreihasna`, key ID
  `station<nn>-2026-09`, serial = epoch-based, unique per sign.
- Station login users: `hasna` on 01-05 and 17-22; `andreihasna` on macOS
  06-16 (see the user map in `bin/ssh-mesh` and the config block written by
  `lib/install-remote.sh`).
- Bootstrap: stations without keys yet are reached with their passwords
  (env `PW14` = stations 01-04, `PWFL` = stations 05-22; injected per
  invocation, never stored or logged) via `lib/pwssh.exp` / `lib/pwscp.exp`.
- AWS stations 17-20 are EC2 (`stations-prod-*`, profile
  `hasna-internal-stations`, us-east-1a). 18-20 run password-less sshd:
  bootstrap via EC2 Instance Connect (`send-ssh-public-key` + the agent fleet
  key), then `provision <nn> key`.

## Usage

    ssh-mesh provision <nn> [key|pw]   # generate key on station, sign, install
    ssh-mesh provision-all             # every reachable station
    ssh-mesh provision-local           # this host (control host)
    ssh-mesh trust <nn>                # root TrustedUserCAKeys install (piped sudo)
    ssh-mesh trust-local               # control host itself
    ssh-mesh renew-all                 # re-sign + re-ship before expiry
    ssh-mesh revoke <nn>               # @revoked deny line + cert removal
    ssh-mesh status                    # cert inventory (serial + validity)
    ssh-mesh verify                    # reachability matrix from this host

`trust` runs the sudo password through the expect session with a printable
prompt marker and scrubs the password from output; the sudo input pipeline
must never be the script's pipe (sudo would read script bytes as the
password — `lib/trust-root-remote.sh` is staged to /tmp first).

## Naming

- Per-station key: `~/.ssh/id_ed25519_fleet` (same path everywhere, unique
  keypair per machine).
- CA keypair: `~/.ssh/hasna_fleet_ca` / `hasna_fleet_ca.pub`.
- Cert key ID: `station<nn>-2026-09`.
- Config block per host: `# BEGIN STATION MESH` ... `# END STATION MESH`.

## Station inventory (2026-09-03, after rollout)

- Provisioned + trusted + verified: 01, 02, 03, 04, 06-20 (certs authenticate
  both directions; matrices from 01-04 reach all of 01-04 and 06-20).
- Pending: 05, 22 (offline); 21 is iOS (no sshd). Provision with
  `ssh-mesh provision <nn>` when they return.
- Legacy cleared: shared `id_ed25519_station_mesh` deleted everywhere (kept
  only as a documented anti-pattern to avoid repeating).

## Ops notes

- Renew before expiry (90d): `renew-all` is idempotent (re-sign + re-ship,
  keys stay stable). `ssh-keygen -s` overwrites existing certs.
- Compromise: `revoke <nn>` (instant), then `provision <nn>` for a fresh key.
- CA private key: 0600 on station03 + vault backup
  `hasna/fleet/ssh/ca/private-key`. CA rotation = new keypair + `trust`
  everywhere + re-sign all.
- Phase 2 (recommended, needs Tailscale admin console): Tailscale SSH
  (`tailscale up --ssh` + ACL `ssh` grants); keep the CA/sshd layer as the
  break-glass path — never remove it (belt & braces).
- There is one known pty-echo exposure of a station password during rollout;
  trust output is scrubbed since.

## Env

`PW14` / `PWFL` (bootstrap passwords, stations 01-04 / 05-22).
Control-host ssh-agent socket: `/var/run/com.apple.launchd.*/Listeners`.