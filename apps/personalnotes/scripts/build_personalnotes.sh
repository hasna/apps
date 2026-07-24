#!/usr/bin/env bash
# Build "PersonalNotes" — the WKWebView macOS shell hosting the web UI — and assemble a
# launchable .app bundle. Run ON a macOS 26 Mac (Command Line Tools, no Xcode).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET_NAME="PersonalNotesApp"
APP_NAME="PersonalNotes"
EXEC_NAME="PersonalNotes"
BUNDLE_ID="com.hasna.notes"
DIST="$REPO_ROOT/dist"

# Real version stamping (About screen + freshness proof): CFBundleShortVersionString
# tracks package.json's "version" (single source of truth) and CFBundleVersion is a
# UTC build stamp, so every install can prove when it was built. The shell injects
# both into the web UI as window.__VERSION__ (docs/ui-contracts.md "Version Bridge").
APP_VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO_ROOT/package.json" | head -n1)"
APP_VERSION="${APP_VERSION:-1.0}"
BUILD_STAMP="${PN_BUILD_STAMP:-$(date -u +%Y%m%d.%H%M%S)}"
APP="$DIST/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"

echo "==> swift build -c release ($TARGET_NAME)"
swift build -c release --product "$TARGET_NAME"

BIN_PATH="$(swift build -c release --show-bin-path)"
BUILT_BINARY="$BIN_PATH/$TARGET_NAME"
[[ -f "$BUILT_BINARY" ]] || { echo "ERROR: binary not found at $BUILT_BINARY" >&2; exit 1; }

echo "==> Assembling $APP"
rm -rf "$APP"
mkdir -p "$MACOS_DIR" "$RESOURCES"
cp "$BUILT_BINARY" "$MACOS_DIR/$EXEC_NAME"
chmod +x "$MACOS_DIR/$EXEC_NAME"

# Bundle the web UI (offline assets) into Resources/web.
echo "==> Bundling web UI -> Resources/web"
rm -rf "$RESOURCES/web"
mkdir -p "$RESOURCES/web"
cp -R "$REPO_ROOT/web/." "$RESOURCES/web/"

# Brand assets: the menu-bar TEMPLATE glyphs (idle + recording) consumed by the
# status item (main.swift showStatusItem loads Resources/brand/*.svg with
# isTemplate=true so macOS tints them for light/dark menu bars).
echo "==> Bundling brand glyphs -> Resources/brand"
rm -rf "$RESOURCES/brand"
mkdir -p "$RESOURCES/brand"
cp "$REPO_ROOT/assets/brand/personalnotes-menubar.svg" \
   "$REPO_ROOT/assets/brand/personalnotes-menubar-rec.svg" "$RESOURCES/brand/"

# App icon: assemble AppIcon.icns from the pre-rendered iconset (generated from
# assets/brand/personalnotes-icon.svg by tools/render-appicon.mjs and checked in).
# iconutil ships with macOS; skip gracefully if the iconset or tool is missing.
ICONSET="$REPO_ROOT/assets/brand/AppIcon.iconset"
if [[ -d "$ICONSET" ]] && command -v iconutil >/dev/null 2>&1; then
  echo "==> Assembling AppIcon.icns (iconutil)"
  iconutil -c icns "$ICONSET" -o "$RESOURCES/AppIcon.icns" \
    || echo "   (iconutil failed; continuing without app icon)"
else
  echo "==> AppIcon.iconset or iconutil unavailable; skipping app icon"
fi

# Bundle the AI sidecar (Node server + its node_modules) into Resources/ai-sidecar.
# The host spawns Resources/ai-sidecar/server.mjs at launch. node_modules MUST be present
# (the Vercel AI SDK + provider). Install deps DIRECTLY INTO THE BUNDLE so the result is
# deterministic regardless of the source tree's node_modules state (it is gitignored and
# may be absent on a fresh checkout or mirror). Requires network access at build time.
echo "==> Bundling AI sidecar -> Resources/ai-sidecar"
SIDECAR_SRC="$REPO_ROOT/ai-sidecar"
rm -rf "$RESOURCES/ai-sidecar"
mkdir -p "$RESOURCES/ai-sidecar"
cp "$SIDECAR_SRC/server.mjs" "$SIDECAR_SRC/package.json" "$RESOURCES/ai-sidecar/"
if [[ -f "$SIDECAR_SRC/bun.lock" ]]; then
  cp "$SIDECAR_SRC/bun.lock" "$RESOURCES/ai-sidecar/"
fi
# server.mjs imports the shared disk-backed notes tool registry via ../tools.
rm -rf "$RESOURCES/tools"
mkdir -p "$RESOURCES/tools"
cp "$REPO_ROOT/tools/notes-agent.mjs" "$REPO_ROOT/tools/notes-lib.mjs" "$RESOURCES/tools/"

# Bundle the CLI + sync engine (zero runtime deps) so the shell app's background
# sync timer can spawn `Resources/bin/personalnotes.mjs sync --json` — the SAME
# engine the `personalnotes sync --watch` daemon uses. Relative imports
# (../sync, ../cli, ../tools) keep working because the layout mirrors the repo.
echo "==> Bundling CLI + sync engine -> Resources/{bin,cli,sync}"
rm -rf "$RESOURCES/bin" "$RESOURCES/cli" "$RESOURCES/sync"
mkdir -p "$RESOURCES/bin" "$RESOURCES/cli" "$RESOURCES/sync"
cp "$REPO_ROOT/bin/personalnotes.mjs" "$RESOURCES/bin/"
cp "$REPO_ROOT/cli/personalnotes.mjs" "$RESOURCES/cli/"
cp "$REPO_ROOT"/sync/*.mjs "$RESOURCES/sync/"
SOURCE_NODE_MODULES_OK=0
if [[ -d "$SIDECAR_SRC/node_modules" \
  && -f "$SIDECAR_SRC/node_modules/ai/dist/index.mjs" \
  && -f "$SIDECAR_SRC/node_modules/@ai-sdk/openai/dist/index.mjs" \
  && -d "$SIDECAR_SRC/node_modules/ws" ]]; then
  SOURCE_NODE_MODULES_OK=1
fi
if [[ "$SOURCE_NODE_MODULES_OK" == "1" ]]; then
  echo "   reusing source node_modules"
  cp -R "$SIDECAR_SRC/node_modules" "$RESOURCES/ai-sidecar/node_modules"
else
  echo "   installing sidecar deps into the bundle"
  if command -v bun >/dev/null 2>&1; then
    ( cd "$RESOURCES/ai-sidecar" && bun install --production )
  else
    ( cd "$RESOURCES/ai-sidecar" && npm install --omit=dev )
  fi
fi
[[ -f "$RESOURCES/ai-sidecar/node_modules/ai/dist/index.mjs" \
  && -f "$RESOURCES/ai-sidecar/node_modules/@ai-sdk/openai/dist/index.mjs" \
  && -d "$RESOURCES/ai-sidecar/node_modules/ws" ]] \
  || { echo "ERROR: ai-sidecar deps (ai, @ai-sdk/openai, ws) missing/incomplete in bundle" >&2; exit 1; }
echo "   sidecar bundled ($(du -sh "$RESOURCES/ai-sidecar/node_modules" | cut -f1))"

cat > "$CONTENTS/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>$APP_NAME</string>
    <key>CFBundleDisplayName</key><string>$APP_NAME</string>
    <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
    <key>CFBundleExecutable</key><string>$EXEC_NAME</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>CFBundleVersion</key><string>$BUILD_STAMP</string>
    <key>CFBundleShortVersionString</key><string>$APP_VERSION</string>
    <key>LSMinimumSystemVersion</key><string>26.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSPrincipalClass</key><string>NSApplication</string>
    <key>NSMicrophoneUsageDescription</key><string>PersonalNotes uses the microphone for voice notes.</string>
</dict>
</plist>
PLIST

# Wire the icon key only when the icns actually made it into the bundle.
if [[ -f "$RESOURCES/AppIcon.icns" ]]; then
  /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string AppIcon" "$CONTENTS/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile AppIcon" "$CONTENTS/Info.plist" 2>/dev/null || true
fi

echo "==> Ad-hoc codesign"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "   signature OK"

echo "BUILT: $APP"
echo "       (CFBundleName=\"$APP_NAME\", bundle id=$BUNDLE_ID, exec=$EXEC_NAME, version=$APP_VERSION, build=$BUILD_STAMP)"
