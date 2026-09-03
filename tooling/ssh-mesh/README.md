# ssh-mesh — fleet SSH access management (SSH CA model)

Replace shared-key sprawl with the standard fleet pattern: a central SSH
certificate authority that signs short-lived certificates for per-station
keypairs. No private key ever leaves its station.

## Architecture

    station03 (control host)                 every station
    ───────────────────────                  ──────────────
    ~/.ssh/hasna_fleet_ca        (CA, 0600)
    vault: hasna/fleet/ssh/ca/private-key    (backup)
    ~/.ssh/fleet-pubkeys/        (pubkeys +        ~/.ssh/id_ed25519_fleet      (own key)
                                 signed certs,     ~/.ssh/id_ed25519_fleet-cert.pub (90d cert)
                                 per station)      authorized_keys:
                                                       @cert-authority <ca.pub> hasna-fleet-ca

- Certificates: principal `hasna`, validity 90d (renew before expiry).
- One trust line per host — no per-user key distribution, no key sprawl.
- Revocation: `ssh-mesh revoke <nn>` → `@revoked <key>` deny line on the host
  + cert removed + key dropped from the store. Expiry is enforced by OpenSSH
  regardless.
- Bootstrap: stations that don't accept our keys yet are reached with the
  station passwords (env `PW14` / `PWFL`, injected per invocation, never
  logged) via `lib/pwssh.exp` / `lib/pwscp.exp`.

## Usage

    ssh-mesh provision <nn> [key|pw]   # generate key on station, sign, install
    ssh-mesh provision-all             # every reachable station (01-20)
    ssh-mesh provision-local           # this host (control host)
    ssh-mesh renew-all                 # re-sign + re-ship before expiry
    ssh-mesh revoke <nn>               # instant revocation
    ssh-mesh status                    # cert inventory (serial + validity)
    ssh-mesh verify                    # from control host: reachability matrix

## Naming

- Per-station key: `~/.ssh/id_ed25519_fleet` (same filename everywhere, unique
  keypair per machine).
- CA keypair: `~/.ssh/hasna_fleet_ca` / `hasna_fleet_ca.pub`.
- Cert key ID: `station<nn>-2026-09`; serial = epoch-based, unique per sign.
- SSH config block on each host: `# BEGIN STATION MESH` ... `# END STATION MESH`.

## Station inventory

- 01-04 macOS/Linux control-capable workstations (01, 02 Linux; 03 macOS;
  04 macOS).
- 05 offline (44d+), 06-16 macOS, 17-20 Linux on AWS, 21 iOS (no sshd),
  22 offline (54d+). Offline stations get provisioned when they return.

## Ops notes

- Renew before expiry: certs are 90d; `renew-all` is idempotent and only
  re-signs + re-ships (no key regeneration — keys are stable, certs rotate).
- If a station's key is compromised: `revoke <nn>` (instant), then
  `ssh-mesh provision <nn>` again to generate a fresh keypair + cert.
- CA private key protection: file 0600 on station03 + vault backup
  (rotation = new CA keypair + re-sign everything; documented in knowledge).
- Phase 2 (recommended, needs Tailscale admin console): enable Tailscale SSH
  (`tailscale up --ssh`) and ACL `ssh` grants for identity-based access; keep
  this CA/sshd layer as the break-glass path — never remove it (belt & braces).
- Legacy cleared: the shared `id_ed25519_station_mesh` keypair (bootstrap-only)
  is deleted from every station by `lib/install-remote.sh`.

## Env

`PW14` / `PWFL` for password bootstrap of not-yet-keyed stations (stations
01-04 / 05-22). The control host's ssh-agent socket at
`/var/run/com.apple.launchd.*/Listeners` is used when present.