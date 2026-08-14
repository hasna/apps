#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

tool_inventory="$tmp_dir/tool-inventory.json"
python3 /opt/open-files/scripts/extraction_tool_inventory.py > "$tool_inventory"

python3 - "$tool_inventory" <<'PY'
import json
import sys
from pathlib import Path

inventory = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
archive = inventory["lanes"]["needs_archive_inventory"]
missing = set(archive.get("missing_blocks") or [])
if archive.get("status") != "ready":
    raise SystemExit(f"archive lane is not ready: {archive.get('status')}")
if {"7z_inventory", "rar_inventory"} & missing:
    raise SystemExit(f"archive lane still has missing blocks: {sorted(missing)}")
PY

member="$tmp_dir/synthetic-member.txt"
printf 'synthetic archive member for open-files worker smoke\n' > "$member"

zip_archive="$tmp_dir/synthetic.zip"
python3 - "$zip_archive" "$member" <<'PY'
import sys
import zipfile
from pathlib import Path

archive = Path(sys.argv[1])
member = Path(sys.argv[2])
with zipfile.ZipFile(archive, "w") as handle:
    handle.write(member, arcname="synthetic-member.txt")
PY

python3 /opt/open-files/scripts/archive_inventory.py \
  "$zip_archive" \
  --output "$tmp_dir/zip-inventory.json" \
  > "$tmp_dir/zip-summary.json"

seven_zip_archive="$tmp_dir/synthetic.7z"
7z a -bd -y "$seven_zip_archive" "$member" >/dev/null

python3 /opt/open-files/scripts/archive_inventory.py \
  "$seven_zip_archive" \
  --output "$tmp_dir/7z-inventory.json" \
  > "$tmp_dir/7z-summary.json"

python3 - "$tmp_dir/zip-inventory.json" "$tmp_dir/7z-inventory.json" <<'PY'
import json
import sys
from pathlib import Path

for path in map(Path, sys.argv[1:]):
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("status") != "ready":
        raise SystemExit(f"{path.name} inventory status is {payload.get('status')}")
    if payload.get("entry_names") != "sha256_redacted":
        raise SystemExit(f"{path.name} did not redact entry names")
    if "synthetic-member" in json.dumps(payload):
        raise SystemExit(f"{path.name} leaked a member name")
PY

printf '{"status":"ok","archive_tool_smoke":"passed"}\n'
