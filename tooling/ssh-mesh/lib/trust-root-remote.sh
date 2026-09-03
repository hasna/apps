#!/bin/sh
# Root-context install of TrustedUserCAKeys, run as:
#   sudo -S -p '' bash -s '<ssh-ed25519 CA pub line> <comment>'
# Safe: `sshd -t` validates before reload; on failure nothing is restarted.
set -e
CAKEY="$1"
[ -n "$CAKEY" ] || { echo "usage: bash -s '<ca pub line>'"; exit 2; }

mkdir -p /etc/ssh/sshd_config.d
printf '%s\n' "$CAKEY" > /etc/ssh/ca.hasna-fleet.pub
chmod 644 /etc/ssh/ca.hasna-fleet.pub

if grep -q 'Include.*sshd_config\.d' /etc/ssh/sshd_config 2>/dev/null; then
  printf 'TrustedUserCAKeys /etc/ssh/ca.hasna-fleet.pub\n' > /etc/ssh/sshd_config.d/30-hasna-fleet-ca.conf
  chmod 644 /etc/ssh/sshd_config.d/30-hasna-fleet-ca.conf
else
  if ! grep -q 'TrustedUserCAKeys /etc/ssh/ca.hasna-fleet.pub' /etc/ssh/sshd_config 2>/dev/null; then
    printf '\n# hasna-fleet-ca (ssh-mesh)\nTrustedUserCAKeys /etc/ssh/ca.hasna-fleet.pub\n' >> /etc/ssh/sshd_config
  fi
fi

/usr/sbin/sshd -t 2>/tmp/sshd-t.err || { echo SSHD-CONFIG-INVALID; cat /tmp/sshd-t.err; exit 1; }

if command -v systemctl >/dev/null 2>&1; then
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || true
else
  launchctl kickstart -k system/com.openssh.sshd 2>/dev/null \
    || kill -HUP "$(cat /var/run/sshd.pid 2>/dev/null)" 2>/dev/null || true
fi
sleep 1
echo TRUST-OK