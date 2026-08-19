#!/usr/bin/env bash
# Install (or update) the com.hasna.secrets native messaging host manifest for
# Chrome. Run from anywhere; the extension directory is resolved relative to
# this script. Usage:
#   ./install-host.sh [--chrome-user-data-dir <dir>] [--dry-run]
#
# WHAT THIS INSTALLS (idempotent — re-run to refresh after updating the
# extension):
#
#   1. The Chrome per-user manifest at
#      NativeMessagingHosts/com.hasna.secrets.json, whose "path" points at the
#      MATERIALIZED host copy (2), not at this checkout.
#   2. A host copy at $HASNA_SECRETS_NATIVE_HOST_DIR/host.cjs (default
#      ~/.hasna/secrets/native-host/host.cjs) whose FIRST LINE is the absolute
#      node binary resolved from this shell. Chrome launches the host through
#      the manifest with the environment launchd gives it, and launchd's PATH
#      is EMPTY (measured on station03: launchctl getenv PATH returns nothing;
#      node lives only at /Users/hasna/.bun/bin). A '#!/usr/bin/env node'
#      shebang therefore fails rc=127 "env: node: No such file or directory"
#      exactly as Chrome would launch it. The absolute shebang needs no PATH.
#   3. host-config.json next to the installed host, embedding the ABSOLUTE
#      path of the user's `secrets` CLI (HASNA_SECRETS_CLI override, else
#      `command -v secrets`). The host spawns that exact binary and prepends
#      its directory to the child PATH, so the CLI's own interpreter (bun,
#      which lives in the same directory) resolves with no inherited PATH.
#
# The extension id is pinned in the extension manifest (the key field), so the
# allowed_origins entry is stable.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST_CJS="$SCRIPT_DIR/host.cjs"
EXTENSION_ID="ndiliggbckgnekphfmdmbcmbjfceajfk"
INSTALL_DIR="${HASNA_SECRETS_NATIVE_HOST_DIR:-$HOME/.hasna/secrets/native-host}"
INSTALLED_HOST="$INSTALL_DIR/host.cjs"
CONFIG_FILE="$INSTALL_DIR/host-config.json"

DRY_RUN=0
CHROME_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --chrome-user-data-dir) CHROME_DIR="${2:-}"; shift 2 ;;
    --chrome-user-data-dir=*) CHROME_DIR="${1#*=}"; shift ;;
    *) shift ;;
  esac
done

if [[ -z "$CHROME_DIR" ]]; then
  case "$(uname -s)" in
    Darwin) CHROME_DIR="$HOME/Library/Application Support/Google/Chrome" ;;
    Linux) CHROME_DIR="$HOME/.config/google-chrome" ;;
    *)
      echo "unsupported OS: $(uname -s)" >&2
      exit 1
      ;;
  esac
fi

HOSTS_DIR="$CHROME_DIR/NativeMessagingHosts"
MANIFEST="$HOSTS_DIR/com.hasna.secrets.json"

if [[ ! -f "$HOST_CJS" ]]; then
  echo "host script not found: $HOST_CJS" >&2
  exit 1
fi

# Resolve the runtimes THIS shell can see. Chrome cannot (its launchd-inherited
# PATH is empty), so their absolute paths are materialized into the install.
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "ERROR: 'node' is not on this shell's PATH. Run this installer from a" >&2
  echo "       shell that has node — the host needs its ABSOLUTE path, because" >&2
  echo "       Chrome launches the host with an empty PATH." >&2
  exit 1
fi

SECRETS_BIN="${HASNA_SECRETS_CLI:-}"
if [[ -z "$SECRETS_BIN" ]]; then
  SECRETS_BIN="$(command -v secrets || true)"
fi
if [[ -z "$SECRETS_BIN" ]]; then
  echo "ERROR: the 'secrets' CLI is not on this shell's PATH. Run this" >&2
  echo "       installer from a shell that has it — its absolute path is" >&2
  echo "       embedded into the host so Chrome does not need a PATH either." >&2
  exit 1
fi

if [[ "$DRY_RUN" == "1" ]]; then
  echo "dry-run: would install the manifest at: $MANIFEST"
  echo "dry-run: materialized host:            $INSTALLED_HOST (shebang '#!$NODE_BIN')"
  echo "dry-run: host config:                  $CONFIG_FILE (secretsCli '$SECRETS_BIN')"
  exit 0
fi

mkdir -p "$HOSTS_DIR"
mkdir -p "$INSTALL_DIR"

# Materialize the installed host with an absolute node shebang. The repo
# host.cjs keeps its portable '#!/usr/bin/env node' for dev shells; the
# installed copy carries the absolute path Chrome cannot resolve on its own.
{ printf '#!%s\n' "$NODE_BIN"; tail -n +2 "$HOST_CJS"; } > "$INSTALLED_HOST"
chmod +x "$INSTALLED_HOST"

printf '{\n  "secretsCli": "%s"\n}\n' "$SECRETS_BIN" > "$CONFIG_FILE"

cat > "$MANIFEST" <<EOF
{
  "name": "com.hasna.secrets",
  "description": "Secrets Vault native messaging host — shells the user's own secrets CLI",
  "path": "$INSTALLED_HOST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

echo "installed host manifest: $MANIFEST"
echo "installed host:          $INSTALLED_HOST (shebang '#!$NODE_BIN')"
echo "host config:             $CONFIG_FILE (secretsCli '$SECRETS_BIN')"
echo "extension id:            $EXTENSION_ID"
echo "NOTE: re-run this script after updating the extension to refresh the installed host copy."
