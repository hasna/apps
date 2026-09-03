#!/bin/sh
# Runs ON the station, AFTER ~/.ssh/id_ed25519_fleet-cert.pub has been shipped
# by the control host. Idempotent. __CA_PUB__ is substituted on the control
# host at ship time and never stored on disk.
set -e
cd ~/.ssh || exit 1
[ -f id_ed25519_fleet-cert.pub ] || { echo CERT-MISSING; exit 1; }
chmod 644 id_ed25519_fleet-cert.pub

# authorized_keys := @cert-authority line, legacy keys kept, mesh key dropped
tmp=$(mktemp) || exit 1
echo "@cert-authority __CA_PUB__ hasna-fleet-ca" > "$tmp"
if [ -f authorized_keys ]; then
  grep -v '^@cert-authority' authorized_keys | grep -v 'station-mesh-access' >> "$tmp" || true
fi
mv "$tmp" authorized_keys
chmod 600 authorized_keys

# ssh config: one fleet block, pointing at the per-station key
touch config; chmod 600 config
if grep -q '# BEGIN STATION MESH' config && ! grep -q 'IdentityFile ~/.ssh/id_ed25519_fleet' config; then
  grep -v '# BEGIN STATION MESH' config > c.tmp && mv c.tmp config
fi
if ! grep -q 'IdentityFile ~/.ssh/id_ed25519_fleet' config; then
  printf '\n# BEGIN STATION MESH\n' >> config
  cat <<'CFG' >> config
Host station01 station02 station03 station04 station05 station06 station07 station08 station09 station10 station11 station12 station13 station14 station15 station16 station17 station18 station19 station20 station21 station22
  HostName %h.taild59be2.ts.net
  User hasna
  IdentitiesOnly yes
  IdentityFile ~/.ssh/id_ed25519_fleet
  StrictHostKeyChecking accept-new
CFG
  printf '# END STATION MESH\n' >> config
fi
sed -i.bak 's/id_ed25519_station_mesh/id_ed25519_fleet/g' config

rm -f id_ed25519_station_mesh id_ed25519_station_mesh.pub
echo CA-INSTALL-OK