#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
mobile_root="${CHENG_MOBILE_ROOT:-}"
ndk_root="${ANDROID_NDK_HOME:-${ANDROID_NDK:-}}"

if [ -z "$mobile_root" ]; then
  if [ -d "$HOME/cheng-mobile" ]; then
    mobile_root="$HOME/cheng-mobile"
  elif [ -d "/Users/lbcheng/cheng-mobile" ]; then
    mobile_root="/Users/lbcheng/cheng-mobile"
  fi
fi

if [ -z "$mobile_root" ] || [ ! -d "$mobile_root/android" ]; then
  echo "[Error] missing cheng-mobile/android (set CHENG_MOBILE_ROOT)" 1>&2
  exit 2
fi

if [ -z "$ndk_root" ]; then
  echo "[Error] missing ANDROID_NDK_HOME/ANDROID_NDK" 1>&2
  exit 2
fi

toolchain="${ndk_root}/build/cmake/android.toolchain.cmake"
if [ ! -f "$toolchain" ]; then
  echo "[Error] missing NDK toolchain: $toolchain" 1>&2
  exit 2
fi

abi="${ANDROID_ABI:-arm64-v8a}"
api="${ANDROID_PLATFORM:-21}"
build_dir="${root}/build/android_host_${abi}"

cmake -S "${mobile_root}/android" -B "$build_dir" \
  -DANDROID_ABI="${abi}" \
  -DANDROID_PLATFORM="android-${api}" \
  -DANDROID_NDK="${ndk_root}" \
  -DCMAKE_TOOLCHAIN_FILE="${toolchain}" \
  -DCHENG_ENABLE_ASM_GUI=ON \
  -DCHENG_GUI_ASM_ROOT="${root}"

cmake --build "$build_dir"
echo "ok: ${build_dir}"
