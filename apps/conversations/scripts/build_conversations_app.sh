#!/usr/bin/env bash
# Build "Hasna Conversations" — the native macOS shell with a bundled local HTTP/MCP
# server — and assemble a launchable .app bundle.
# Run ON a macOS 26 Mac (Swift 6, Command Line Tools; no Xcode required).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TARGET_NAME="HasnaConversationsApp"
APP_NAME="Hasna Conversations"
EXEC_NAME="HasnaConversations"
BUNDLE_ID="com.hasna.conversations"
DIST="$REPO_ROOT/dist-app"
APP="$DIST/$APP_NAME.app"
CONTENTS="$APP/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
PAYLOAD="$RESOURCES/app"

command -v bun >/dev/null 2>&1 || { echo "ERROR: bun not found on PATH" >&2; exit 1; }

echo "==> bun install (populate node_modules for the bundled server)"
bun install

echo "==> swift build -c release ($TARGET_NAME)"
swift build -c release --product "$TARGET_NAME"

BIN_PATH="$(swift build -c release --show-bin-path)"
BUILT_BINARY="$BIN_PATH/$TARGET_NAME"
[[ -f "$BUILT_BINARY" ]] || { echo "ERROR: binary not found at $BUILT_BINARY" >&2; exit 1; }

echo "==> Assembling $APP"
rm -rf "$APP"
mkdir -p "$MACOS_DIR" "$PAYLOAD"
cp "$BUILT_BINARY" "$MACOS_DIR/$EXEC_NAME"
chmod +x "$MACOS_DIR/$EXEC_NAME"

# Bundle the server payload: TypeScript source + deps.
echo "==> Bundling server payload -> Resources/app"
cp -R "$REPO_ROOT/src" "$PAYLOAD/src"
cp "$REPO_ROOT/package.json" "$PAYLOAD/package.json"
[[ -f "$REPO_ROOT/tsconfig.json" ]] && cp "$REPO_ROOT/tsconfig.json" "$PAYLOAD/tsconfig.json"

# node_modules is required at runtime (bun:sqlite is builtin; pg / mcp-sdk / zod are not).
echo "==> Bundling node_modules -> Resources/app/node_modules"
rm -rf "$PAYLOAD/node_modules"
cp -R "$REPO_ROOT/node_modules" "$PAYLOAD/node_modules"
[[ -d "$PAYLOAD/node_modules/@modelcontextprotocol" ]] \
  || { echo "ERROR: node_modules incomplete in bundle" >&2; exit 1; }
echo "   payload size: $(du -sh "$PAYLOAD" | cut -f1)"

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
    <key>CFBundleVersion</key><string>1</string>
    <key>CFBundleShortVersionString</key><string>1.0</string>
    <key>LSMinimumSystemVersion</key><string>26.0</string>
    <key>NSHighResolutionCapable</key><true/>
    <key>NSPrincipalClass</key><string>NSApplication</string>
    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSAllowsLocalNetworking</key><true/>
    </dict>
</dict>
</plist>
PLIST

echo "==> Ad-hoc codesign"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "   signature OK"

echo "BUILT: $APP"
echo "       (CFBundleName=\"$APP_NAME\", bundle id=$BUNDLE_ID, exec=$EXEC_NAME)"
