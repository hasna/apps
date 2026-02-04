#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${HOME}/Library/Logs"
LOG_FILE="${LOG_DIR}/connect-googledrive-refresh.log"

mkdir -p "${LOG_DIR}"

cd "${PROJECT_ROOT}"
./connect-googledrive files list --page-size 1 >> "${LOG_FILE}" 2>&1
