#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIGURATION="${CONFIGURATION:-release}"
APP_NAME="Open Knowledge"
BINARY_NAME="OpenKnowledge"
BUILD_DIR="${ROOT_DIR}/.build/${CONFIGURATION}"
DIST_DIR="${ROOT_DIR}/dist"
APP_DIR="${DIST_DIR}/${APP_NAME}.app"
CONTENTS_DIR="${APP_DIR}/Contents"
MACOS_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"
REPO_ROOT="$(cd "${ROOT_DIR}/../.." && pwd)"

swift build \
  --package-path "${ROOT_DIR}" \
  -c "${CONFIGURATION}" \
  --product "${BINARY_NAME}"

rm -rf "${APP_DIR}"
mkdir -p "${MACOS_DIR}" "${RESOURCES_DIR}"
cp "${BUILD_DIR}/${BINARY_NAME}" "${MACOS_DIR}/${BINARY_NAME}"
cp "${ROOT_DIR}/Info.plist" "${CONTENTS_DIR}/Info.plist"
if [[ -f "${REPO_ROOT}/bin/knowledge.js" ]]; then
  cp "${REPO_ROOT}/bin/knowledge.js" "${RESOURCES_DIR}/knowledge.js"
fi
chmod +x "${MACOS_DIR}/${BINARY_NAME}"

if command -v plutil >/dev/null 2>&1; then
  plutil -lint "${CONTENTS_DIR}/Info.plist"
fi

echo "Built ${APP_DIR}"
