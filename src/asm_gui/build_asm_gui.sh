#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
out_dir="${root}/build"
mkdir -p "$out_dir"

platform="${CHENG_GUI_PLATFORM:-}"
arch="${CHENG_GUI_ARCH:-}"

if [ -z "$platform" ]; then
  uname_s="$(uname -s)"
  case "$uname_s" in
    Darwin) platform="macos" ;;
    Linux) platform="linux" ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) platform="windows" ;;
    *) platform="unknown" ;;
  esac
fi

if [ -z "$arch" ]; then
  uname_m="$(uname -m)"
  case "$uname_m" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="x64" ;;
    *) arch="$uname_m" ;;
  esac
fi

src=""
cflags="${CHENG_GUI_CCFLAGS:-}"
if [ -n "${CHENG_GUI_TARGET:-}" ]; then
  cflags="${cflags} --target=${CHENG_GUI_TARGET}"
fi
if [ -n "${CHENG_GUI_SYSROOT:-}" ]; then
  cflags="${cflags} --sysroot=${CHENG_GUI_SYSROOT}"
fi
case "${platform}_${arch}" in
  macos_arm64) src="gui_macos_arm64.s"; cflags="${cflags} -arch arm64" ;;
  ios_arm64) src="gui_ios_arm64.s" ;;
  linux_x64) src="gui_linux_x64.s" ;;
  windows_x64) src="gui_windows_x64.s" ;;
  android_arm64) src="gui_android_arm64.s" ;;
  harmony_arm64) src="gui_harmony_arm64.s" ;;
  *) echo "unsupported platform_arch: ${platform}_${arch}" >&2; exit 2 ;;
esac

cc="${CC:-clang}"
obj="${out_dir}/asm_gui_${platform}_${arch}.o"
lib="${out_dir}/libcheng_asm_gui_${platform}_${arch}.a"

"$cc" -c "${root}/${src}" -o "${obj}" ${cflags}
ar rcs "${lib}" "${obj}"
printf '%s\n' "${lib}"
