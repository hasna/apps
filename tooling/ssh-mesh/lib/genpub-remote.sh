#!/bin/sh
# Runs ON the station (via `bash -s stationNN`), NOT on the control host.
# Generates the station's own fleet keypair if absent and prints its pubkey.
set -e
mkdir -p ~/.ssh && chmod 700 ~/.ssh
if [ ! -f ~/.ssh/id_ed25519_fleet ]; then
  ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_fleet -N "" -C "station${1}-fleet-2026-09" >/dev/null 2>&1
  chmod 600 ~/.ssh/id_ed25519_fleet
fi
cat ~/.ssh/id_ed25519_fleet.pub