#!/usr/bin/env bash
# Build the official Volo AI desktop bundle natively on Apple Silicon macOS
# (target aarch64-apple-darwin). Run from anywhere: bash scripts/build_local_macos_arm64.sh
set -euo pipefail

LOCAL_BUILD_OS="macos"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build_local_common.sh"
local_build_main
