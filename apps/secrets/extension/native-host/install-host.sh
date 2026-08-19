#!/usr/bin/env bash
# Install (or update) the com.hasna.secrets native messaging host manifest for
# Chrome. Run from anywhere; the extension directory is resolved relative to
# this script. Usage:
#   ./install-host.sh [--chrome-user-data-dir <dir>] [--dry-run]
#
# The manifest is written to the per-user NativeMessagingHosts directory so no
# root is needed:
#   Linux:  ~/.config/google-chrome/NativeMessagingHosts/
#   macOS:  ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
#
# The host path recorded is the ABSOLUTE path of native-host/host.cjs in this
# checkout, and the extension id is pinned in the extension manifest (the key
# field), so the allowed_origins entry is stable.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOST_CJS="$SCRIPT_DIR/host.cjs"
EXTENSION_ID="ndiliggbckgnekphfmdmbcmbjfceajfk"

DRY_RUN=0
CHROME_DIR=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --chrome-user-data-dir) CHROME_DIR="" ;;
    --chrome-user-data-dir=*) CHROME_DIR="${arg#*=}" ;;
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

if [[ ! -x "$HOST_CJS" ]]; then
  chmod +x "$HOST_CJS"
fi

if [[ ! -f "$HOST_CJS" ]]; then
  echo "host script not found: $HOST_CJS" >&2
  exit 1
fi

mkdir -p "$HOSTS_DIR"

cat > "$MANIFEST" <<EOF
{
  "name": "com.hasna.secrets",
  "description": "Secrets Vault native messaging host — shells the user's own secrets CLI",
  "path": "$HOST_CJS",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXTENSION_ID/"]
}
EOF

echo "installed host manifest: $MANIFEST"
echo "host script:            $HOST_CJS"
echo "extension id:           $EXTENSION_ID"

if command -v secrets >/dev/null 2>&1; then
  echo "secrets CLI:            $(command -v secrets)"
else
  echo "WARNING: the 'secrets' CLI is not on PATH for this shell; the host will report E_CLI_NOT_FOUND until it is." >&2
fi

if [[ "$DRY_RUN" == "1" ]]; then
  rm -f "$MANIFEST"
  echo "(dry-run: manifest removed again)"
fi
