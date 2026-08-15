#!/usr/bin/env python3
"""
Programmatically load the Secrets Vault extension into Chrome on macOS.
Equivalent to: Developer Mode → Load Unpacked.

Run this while Chrome is CLOSED. Chrome will pick up the changes on next launch.
"""

import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

EXT_PATH = Path.home() / "Downloads" / "secrets-vault-extension"
CHROME_PREFS = Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "Default" / "Preferences"
CHROME_LOCAL_STATE = Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "Local State"
CHROME_SECURE_PREFS = Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "Default" / "Secure Preferences"


def compute_extension_id(path: str) -> str:
    """
    Compute Chrome extension ID for a load-extension path.
    Chrome uses SHA256 of the path, first 16 bytes, encoded as a-p (not 0-9a-f).
    """
    digest = hashlib.sha256(path.encode("utf-8")).digest()
    # Map each nibble: 0→a, 1→b, ..., 9→j, a→k, ..., f→p
    def nibble_to_char(n: int) -> str:
        return chr(ord('a') + n)

    result = []
    for byte in digest[:16]:
        result.append(nibble_to_char((byte >> 4) & 0xf))
        result.append(nibble_to_char(byte & 0xf))
    return ''.join(result)


def quit_chrome():
    result = subprocess.run(
        ["osascript", "-e", 'tell application "Google Chrome" to quit'],
        capture_output=True
    )
    if result.returncode == 0:
        print("  Quit Chrome")
        time.sleep(2)
    # Kill any remaining Chrome processes
    subprocess.run(["pkill", "-f", "Google Chrome"], capture_output=True)
    time.sleep(1)


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


def save_json(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, separators=(",", ":"))


def load_manifest(ext_path: Path) -> dict:
    manifest_path = ext_path / "manifest.json"
    with open(manifest_path) as f:
        return json.load(f)


def build_extension_entry(ext_id: str, ext_path: Path, manifest: dict) -> dict:
    """Build the Preferences entry Chrome would write for an unpacked extension."""
    now_timestamp = str(int(time.time() * 1_000_000))  # microseconds
    return {
        "active_permissions": {
            "api": manifest.get("permissions", []),
            "explicit_host": manifest.get("host_permissions", []),
            "manifest_permissions": [],
            "scriptable_host": []
        },
        "app_launch_url": "",
        "content_settings": [],
        "creation_flags": 9,  # FROM_COMMAND_LINE | WAS_INSTALLED_BY_DEFAULT equiv for load-extension
        "events": [],
        "from_bookmark": False,
        "from_webstore": False,
        "granted_permissions": {
            "api": manifest.get("permissions", []),
            "explicit_host": manifest.get("host_permissions", []),
            "manifest_permissions": [],
            "scriptable_host": []
        },
        "id": ext_id,
        "incognito": False,
        "install_time": now_timestamp,
        "last_update_time": now_timestamp,
        "location": 4,  # LOAD (unpacked / load-extension)
        "manifest": manifest,
        "needs_sync": False,
        "path": str(ext_path),
        "regular_only_permissions": {},
        "state": 1,  # ENABLED
        "was_installed_by_default": False,
        "was_installed_by_oem": False,
        "withholding_permissions": False,
    }


def enable_developer_mode(prefs: dict) -> dict:
    """Enable developer mode in Chrome extensions settings."""
    prefs.setdefault("extensions", {})
    prefs["extensions"]["ui"] = prefs["extensions"].get("ui", {})
    prefs["extensions"]["ui"]["developer_mode"] = True
    return prefs


def inject_extension(prefs: dict, ext_id: str, entry: dict) -> dict:
    """Inject extension entry into Chrome preferences."""
    prefs.setdefault("extensions", {})
    prefs["extensions"].setdefault("settings", {})
    prefs["extensions"]["settings"][ext_id] = entry
    return prefs


def main():
    print("\n🔐 Secrets Vault — Chrome Extension Installer\n")

    # Verify extension directory
    if not EXT_PATH.exists():
        print(f"✗ Extension not found at: {EXT_PATH}")
        sys.exit(1)

    manifest_path = EXT_PATH / "manifest.json"
    if not manifest_path.exists():
        print(f"✗ manifest.json not found in: {EXT_PATH}")
        sys.exit(1)

    # Check Chrome preferences exist (Chrome must have been opened at least once)
    if not CHROME_PREFS.exists():
        print(f"✗ Chrome preferences not found: {CHROME_PREFS}")
        print("  → Open Chrome once, then close it, then run this script.")
        sys.exit(1)

    print(f"  Extension: {EXT_PATH}")
    manifest = load_manifest(EXT_PATH)
    ext_id = compute_extension_id(str(EXT_PATH))
    print(f"  Extension ID: {ext_id}")
    print(f"  Name: {manifest.get('name')}")

    # Quit Chrome
    print("\n  Quitting Chrome...")
    quit_chrome()

    # Load and update Preferences
    print("  Updating Chrome preferences...")
    prefs = load_json(CHROME_PREFS)
    entry = build_extension_entry(ext_id, EXT_PATH, manifest)
    prefs = enable_developer_mode(prefs)
    prefs = inject_extension(prefs, ext_id, entry)
    save_json(CHROME_PREFS, prefs)
    print(f"  ✓ Injected extension (id: {ext_id})")

    # Also update Secure Preferences if it exists (Chrome 100+)
    if CHROME_SECURE_PREFS.exists():
        secure = load_json(CHROME_SECURE_PREFS)
        secure = enable_developer_mode(secure)
        secure = inject_extension(secure, ext_id, entry)
        save_json(CHROME_SECURE_PREFS, secure)
        print("  ✓ Updated Secure Preferences")

    # Launch Chrome
    print("\n  Launching Chrome...")
    subprocess.Popen(["open", "-a", "Google Chrome"])
    time.sleep(3)

    # Open extensions page
    subprocess.run(["open", "-a", "Google Chrome", "chrome://extensions"])

    print(f"""
✓ Done!

  Chrome is opening. You should see "Secrets Vault" in the extensions list.

  If Chrome shows a warning about the preferences being modified:
  → Click "Use anyway" or re-enable the extension manually.

  To connect the extension:
  1. Click the 🔐 icon in Chrome toolbar
  2. Click ⚙ Settings
  3. Run on terminal:  secrets serve
  4. Paste the token into the Settings page

  Extension ID: {ext_id}
""")


if __name__ == "__main__":
    main()
