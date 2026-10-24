#!/usr/bin/env bash
# Shared orchestration for the scripts/build_local_<os>_<arch>.sh entry points.
# An entry script sets LOCAL_BUILD_OS (macos|linux|windows), sources this file,
# then calls local_build_main. Compatible with bash 3.2 (stock macOS bash).
set -euo pipefail

AUDIOCPP_TAG="v0.9.0"
AUDIOCPP_REPO="https://github.com/0xShug0/audio.cpp.git"
AUDIOCPP_DIR="build/audio.cpp"
SIDECAR_DIR="apps/desktop/src-tauri/sidecar/tts-sidecar"
BUNDLE_ROOT="apps/desktop/src-tauri/target/release/bundle"
VENV_PYTHON=""
FFMPEG_BIN=""

die() { echo "error: $*" >&2; exit 1; }
info() { echo "==> $*"; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

target_triple() {
  case "${LOCAL_BUILD_OS:-}" in
    macos) echo "aarch64-apple-darwin" ;;
    linux) echo "x86_64-unknown-linux-gnu" ;;
    windows) echo "x86_64-pc-windows-msvc" ;;
    *) die "LOCAL_BUILD_OS is unset; run one of the scripts/build_local_<os>_<arch>.sh entries" ;;
  esac
}

check_native_host() {
  local system machine
  system="$(uname -s)"
  machine="$(uname -m)"
  case "${LOCAL_BUILD_OS:-}" in
    macos)
      [[ "$system" == "Darwin" && "$machine" == "arm64" ]] \
        || die "scripts/build_local_macos_arm64.sh must run on an Apple Silicon Mac (Darwin arm64) to build $(target_triple); detected '${system} ${machine}'. Intel macOS is not a supported desktop target." ;;
    linux)
      [[ "$system" == "Linux" && "$machine" == "x86_64" ]] \
        || die "scripts/build_local_linux_x64.sh must run on native x86_64 Linux to build $(target_triple); detected '${system} ${machine}'." ;;
    windows)
      case "$system" in
        MINGW*|MSYS*|CYGWIN*) ;;
        *) die "scripts/build_local_windows_x64.sh must run in Git Bash on native 64-bit Windows (not WSL, Linux, or macOS) to build $(target_triple); detected '${system} ${machine}'." ;;
      esac
      [[ "$machine" == "x86_64" ]] \
        || die "scripts/build_local_windows_x64.sh needs 64-bit Windows (uname -m = x86_64); detected '${machine}'." ;;
    *) die "LOCAL_BUILD_OS is unset; run one of the scripts/build_local_<os>_<arch>.sh entries" ;;
  esac
  info "Host check passed: ${system} ${machine} -> $(target_triple)"
}

cd_repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.." || die "could not cd to the repository root"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' was not found on PATH. $2"
}

check_rust_host() {
  require_command rustc "Install the Rust toolchain via https://rustup.rs and retry."
  require_command cargo "Install the Rust toolchain via https://rustup.rs and retry."
  local host
  host="$(rustc -vV | sed -n 's/^host:[[:space:]]*//p')" \
    || die "rustc is installed but 'rustc -vV' failed"
  if [[ "$host" != "$(target_triple)" ]]; then
    if [[ "$LOCAL_BUILD_OS" == "windows" ]]; then
      die "Rust host is '${host}' but the official build needs $(target_triple). Install Visual Studio Build Tools with the C++ workload, then run: rustup toolchain install stable-x86_64-pc-windows-msvc && rustup default stable-x86_64-pc-windows-msvc"
    fi
    die "Rust host is '${host}' but the official build needs $(target_triple). Select the matching native toolchain with rustup and retry."
  fi
}

# Echo the first ffmpeg/ffmpeg.exe on PATH that is not the Chocolatey ShimGen
# launcher under chocolatey\bin; echo nothing when only shims or none exist.
first_path_ffmpeg() {
  local dir cand
  printf '%s\n' "$PATH" | tr ':' '\n' | while IFS= read -r dir; do
    for cand in "$dir/ffmpeg" "$dir/ffmpeg.exe"; do
      if [[ -f "$cand" && -x "$cand" ]]; then
        case "$(lower "$cand")" in
          *chocolatey/bin/*) continue ;;
        esac
        printf '%s\n' "$cand"
        break 2
      fi
    done
  done
}

resolve_ffmpeg() {
  if [[ "$LOCAL_BUILD_OS" != "windows" ]]; then
    require_command ffmpeg "Install FFmpeg first (macOS: 'brew install ffmpeg'; Debian/Ubuntu: 'sudo apt-get install ffmpeg')."
    command -v ffmpeg
    return
  fi
  local candidate
  candidate="$(first_path_ffmpeg)"
  if [[ -z "$candidate" && -n "${ChocolateyInstall:-}" ]]; then
    candidate="$(find "$(cygpath -u "$ChocolateyInstall")/lib/ffmpeg/tools" -type f -iname 'ffmpeg.exe' -print -quit 2>/dev/null || true)"
  fi
  [[ -n "$candidate" ]] \
    || die "No usable ffmpeg.exe found. The Chocolatey ShimGen launcher under chocolatey\\bin cannot be bundled; install a real FFmpeg ('choco install ffmpeg' or a standalone build on PATH) and retry."
  printf '%s' "$candidate"
}

pick_powershell() {
  if command -v pwsh >/dev/null 2>&1; then echo "pwsh";
  elif command -v powershell.exe >/dev/null 2>&1; then echo "powershell.exe";
  elif command -v powershell >/dev/null 2>&1; then echo "powershell";
  else die "PowerShell not found. The audio.cpp build needs 'pwsh' or Windows PowerShell 'powershell.exe' on PATH."; fi
}

preflight() {
  local apt_hint="sudo apt-get update && sudo apt-get install --yes build-essential cmake curl file ffmpeg libasound2-dev libayatana-appindicator3-dev libssl-dev libwebkit2gtk-4.1-dev libxdo-dev librsvg2-dev patchelf pkg-config wget"
  require_command git "Install Git and retry."
  require_command node "Install Node.js 22 or newer: https://nodejs.org"
  require_command npm "Install Node.js 22 or newer: https://nodejs.org"
  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" \
    || die "node is installed but failed to report its version"
  [[ "$node_major" =~ ^[0-9]+$ && "$node_major" -ge 22 ]] \
    || die "Node.js 22 or newer is required (found '$(node --version 2>/dev/null || echo unknown)'); install it from https://nodejs.org and retry."
  check_rust_host
  case "$LOCAL_BUILD_OS" in
    macos)
      require_command cmake "Install CMake: 'brew install cmake'"
      xcode-select -p >/dev/null 2>&1 \
        || die "Xcode Command Line Tools are missing; run 'xcode-select --install' and retry." ;;
    linux)
      require_command cmake "Install the release build dependencies: $apt_hint"
      require_command patchelf "Install 'patchelf' (for example 'sudo apt-get install patchelf'); the sidecar packager needs it to bundle FFmpeg."
      { command -v cc || command -v gcc || command -v clang; } >/dev/null 2>&1 \
        || die "No C compiler found; install 'build-essential' (Debian/Ubuntu) or your distribution's toolchain, then retry."
      { command -v make || command -v ninja; } >/dev/null 2>&1 \
        || die "No CMake generator tool found; install 'make' or 'ninja' ('sudo apt-get install build-essential'), then retry."
      require_command pkg-config "Install 'pkg-config' plus the Tauri Linux prerequisites: $apt_hint"
      pkg-config --exists webkit2gtk-4.1 \
        || die "Tauri Linux prerequisites are missing (pkg-config cannot find webkit2gtk-4.1). Install them with: $apt_hint" ;;
    windows)
      require_command cygpath "Run inside Git Bash or MSYS2, which provide cygpath"
      pick_powershell >/dev/null ;;
  esac
  FFMPEG_BIN="$(resolve_ffmpeg)"
}

# True when the interpreter runs, is Python >=3.10, and is 64-bit.
py_ready() {
  "$@" -c 'import struct, sys; sys.exit(0 if sys.version_info[:2] >= (3, 10) and struct.calcsize("P") * 8 == 64 else 1)' >/dev/null 2>&1
}

ensure_venv() {
  local vpy=".venv/bin/python"
  [[ "$LOCAL_BUILD_OS" == "windows" ]] && vpy=".venv/Scripts/python.exe"
  if [[ -e .venv ]]; then
    [[ -x "$vpy" ]] \
      || die ".venv exists but has no interpreter at ${vpy}; repair or remove it yourself (the script never deletes or recreates an existing .venv)."
    py_ready "$vpy" \
      || die "${vpy} is not a usable 64-bit Python 3.10+; repair or remove .venv yourself (the script never deletes or recreates it)."
    info "Reusing existing .venv"
  else
    local -a base_py=()
    if [[ "$LOCAL_BUILD_OS" == "windows" ]]; then
      if command -v python >/dev/null 2>&1; then base_py=(python);
      elif command -v py >/dev/null 2>&1; then base_py=(py -3);
      elif command -v python3 >/dev/null 2>&1; then base_py=(python3); fi
    elif command -v python3 >/dev/null 2>&1; then base_py=(python3);
    elif command -v python >/dev/null 2>&1; then base_py=(python); fi
    [[ ${#base_py[@]} -gt 0 ]] \
      || die "No Python interpreter found on PATH; install Python 3.10 or newer and retry."
    py_ready "${base_py[@]}" \
      || die "'${base_py[*]}' is not a usable 64-bit Python 3.10+ (on Windows the Microsoft Store alias does not count); install Python 3.10+ and retry."
    info "Creating .venv with '${base_py[*]}'"
    "${base_py[@]}" -m venv .venv
    [[ -x "$vpy" ]] || die "venv creation produced no interpreter at ${vpy}; remove .venv yourself and retry."
  fi
  VENV_PYTHON="$vpy"
}

install_python_deps() {
  info "Installing Python build dependencies into .venv"
  if [[ "$LOCAL_BUILD_OS" == "linux" ]]; then
    "$VENV_PYTHON" -m pip install --extra-index-url https://download.pytorch.org/whl/cpu \
      -c requirements-linux-cpu.txt 'torch==2.10.0+cpu' 'torchaudio==2.10.0+cpu'
    "$VENV_PYTHON" -m pip install --extra-index-url https://download.pytorch.org/whl/cpu \
      -c requirements-linux-cpu.txt -e '.[mp3,desktop-vieneu]'
    "$VENV_PYTHON" -m pip install -r requirements-build.txt
    "$VENV_PYTHON" - <<'PY'
import torch
import torchaudio

assert torch.version.cuda is None, f"Expected CPU torch, got {torch.version.cuda}"
assert "+cpu" in torch.__version__ and "+cpu" in torchaudio.__version__
print(f"Verified CPU-only runtime: torch={torch.__version__}, torchaudio={torchaudio.__version__}")
PY
  else
    "$VENV_PYTHON" -m pip install -e '.[mp3,desktop-vieneu]'
    "$VENV_PYTHON" -m pip install -r requirements-build.txt
  fi
}

ensure_audiocpp_checkout() {
  if [[ -d "$AUDIOCPP_DIR" ]]; then
    local head tag_commit
    git -C "$AUDIOCPP_DIR" rev-parse --git-dir >/dev/null 2>&1 \
      && head="$(git -C "$AUDIOCPP_DIR" rev-parse HEAD 2>/dev/null)" \
      && tag_commit="$(git -C "$AUDIOCPP_DIR" rev-parse --verify -q "${AUDIOCPP_TAG}^{commit}" 2>/dev/null)" \
      || die "${AUDIOCPP_DIR} exists but is not a git checkout at tag ${AUDIOCPP_TAG}; move it aside or fix it yourself — the script never deletes or resets an existing checkout."
    [[ "$head" == "$tag_commit" ]] \
      || die "${AUDIOCPP_DIR} is checked out at ${head}, not ${AUDIOCPP_TAG} (${tag_commit}); switch it or move it aside yourself — the script never deletes or resets an existing checkout."
    [[ -z "$(git -C "$AUDIOCPP_DIR" status --porcelain 2>/dev/null)" ]] \
      || die "${AUDIOCPP_DIR} is at ${AUDIOCPP_TAG} but has uncommitted changes; clean it yourself or move it aside — the script never deletes or resets an existing checkout."
    info "Reusing audio.cpp ${AUDIOCPP_TAG} checkout at ${AUDIOCPP_DIR}"
    return
  fi
  [[ ! -e "$AUDIOCPP_DIR" ]] \
    || die "${AUDIOCPP_DIR} exists and is not a directory; move it aside yourself and retry."
  info "Cloning audio.cpp ${AUDIOCPP_TAG} into ${AUDIOCPP_DIR}"
  mkdir -p build
  git clone --depth 1 --branch "$AUDIOCPP_TAG" "$AUDIOCPP_REPO" "$AUDIOCPP_DIR"
}

audiocpp_ps_command() {
  # Emit the PowerShell -Command text for the audio.cpp CLI build. Single
  # quotes in the script path are doubled, PowerShell's escape for a literal
  # quote inside a single-quoted string.
  local ps1q
  ps1q="$(printf '%s' "$1" | sed "s/'/''/g")"
  printf '%s' "& '$ps1q' -Preset windows-cpu-release -ModelSet custom -Models 'vieneu_v3_turbo' -Target audiocpp_cli -CpuArch baseline; if (-not \$?) { exit 1 }; if (\$LASTEXITCODE) { exit \$LASTEXITCODE }"
}

build_audiocpp() {
  info "Building audio.cpp CLI (${AUDIOCPP_TAG}, CPU backend, vieneu_v3_turbo)"
  case "$LOCAL_BUILD_OS" in
    macos)
      cmake -S "$AUDIOCPP_DIR" -B "$AUDIOCPP_DIR/build/macos-cpu-release" \
        -DCMAKE_BUILD_TYPE=Release -DENGINE_ENABLE_CUDA=OFF -DENGINE_ENABLE_VULKAN=OFF \
        -DENGINE_ENABLE_METAL=OFF -DENGINE_ENABLE_OPENMP=OFF -DGGML_OPENMP=OFF \
        -DAUDIOCPP_MODEL_SET=custom -DAUDIOCPP_MODELS=vieneu_v3_turbo
      cmake --build "$AUDIOCPP_DIR/build/macos-cpu-release" \
        --parallel "$(sysctl -n hw.logicalcpu)" --target audiocpp_cli ;;
    linux)
      (cd "$AUDIOCPP_DIR" && bash scripts/build_linux.sh \
        --backend cpu --model-set custom --models vieneu_v3_turbo \
        --target audiocpp_cli --native-cpu OFF) ;;
    windows)
      local ps ps1
      ps="$(pick_powershell)"
      ps1="$(pwd -P)/$AUDIOCPP_DIR/scripts/build_windows.ps1"
      [[ -f "$ps1" ]] || die "expected ${ps1} inside the audio.cpp checkout"
      ps1="$(cygpath -w "$ps1")"
      # -Command propagates $?/$LASTEXITCODE like the release workflow's check;
      # plain '-File' can swallow a failing native build.
      "$ps" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \
        "$(audiocpp_ps_command "$ps1")" ;;
  esac
}

find_audiocpp_cli() {
  local name="audiocpp_cli" found
  [[ "$LOCAL_BUILD_OS" == "windows" ]] && name="audiocpp_cli.exe"
  found="$(find "$AUDIOCPP_DIR/build" -type f -name "$name" -print -quit 2>/dev/null || true)"
  [[ -n "$found" ]] || die "audio.cpp did not produce ${name} under ${AUDIOCPP_DIR}/build"
  printf '%s' "$found"
}

stage_sidecar() {
  local audiocpp_bin ffmpeg_bin
  audiocpp_bin="$(find_audiocpp_cli)"
  ffmpeg_bin="$FFMPEG_BIN"
  if [[ "$LOCAL_BUILD_OS" == "windows" ]]; then
    audiocpp_bin="$(cygpath -w "$audiocpp_bin")"
    ffmpeg_bin="$(cygpath -w "$ffmpeg_bin")"
  fi
  info "Packaging desktop sidecar for $(target_triple)"
  "$VENV_PYTHON" scripts/build_sidecar.py \
    --ffmpeg "$ffmpeg_bin" --audiocpp "$audiocpp_bin" --target "$(target_triple)"
  info "Smoke-testing staged sidecar at ${SIDECAR_DIR}"
  "$VENV_PYTHON" scripts/smoke_sidecar.py "$SIDECAR_DIR"
}

build_tauri() {
  info "Ensuring Node dependencies in apps/desktop (npm install; node_modules is never wiped)"
  npm install --prefix apps/desktop
  info "Building Tauri desktop bundles"
  npm --prefix apps/desktop run tauri build
}

print_bundles() {
  [[ -d "$BUNDLE_ROOT" ]] || die "the Tauri build finished but ${BUNDLE_ROOT} was not created"
  info "Generated bundle(s) under ${BUNDLE_ROOT}:"
  local found=0 f
  for f in "$BUNDLE_ROOT"/*/*; do
    [[ -f "$f" ]] || continue
    case "$(lower "$f")" in
      *.app.tar.gz|*.appimage|*.appx|*.msix|*.msixbundle|*.snap|*.dmg|*.msi|*.deb|*.rpm|*.exe|*.tar.gz|*.zip)
        printf '  %s\n' "$f"
        found=1 ;;
    esac
  done
  [[ "$found" -eq 1 ]] || die "no recognized installer bundles were produced under ${BUNDLE_ROOT}"
}

local_build_main() {
  check_native_host
  cd_repo_root
  info "Local official desktop build: ${LOCAL_BUILD_OS} ($(target_triple))"
  preflight
  ensure_venv
  install_python_deps
  ensure_audiocpp_checkout
  build_audiocpp
  stage_sidecar
  build_tauri
  print_bundles
  info "Done."
}
