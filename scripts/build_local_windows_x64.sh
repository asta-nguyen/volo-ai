#!/usr/bin/env bash
# Build the official Volo AI desktop bundle natively on Windows x64 (target
# x86_64-pc-windows-msvc). Must run in Git Bash (or MSYS2/Cygwin) on native
# 64-bit Windows — not WSL, PowerShell, or CMD.
# Usage in Git Bash: bash scripts/build_local_windows_x64.sh
set -euo pipefail

LOCAL_BUILD_OS="windows"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build_local_common.sh"
local_build_main
