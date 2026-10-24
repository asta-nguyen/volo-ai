#!/usr/bin/env bash
# Build the official Volo AI desktop bundle natively on x86_64 Linux
# (target x86_64-unknown-linux-gnu). Run from anywhere: bash scripts/build_local_linux_x64.sh
set -euo pipefail

LOCAL_BUILD_OS="linux"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build_local_common.sh"
local_build_main
