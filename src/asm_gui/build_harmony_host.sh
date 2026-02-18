#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")" && pwd)"
mobile_root="${CHENG_MOBILE_ROOT:-}"
toolchain="${OHOS_TOOLCHAIN_FILE:-${HARMONY_TOOLCHAIN_FILE:-}}"

if [ -z "$mobile_root" ]; then
  if [ -d "$HOME/cheng-mobile" ]; then
    mobile_root="$HOME/cheng-mobile"
  elif [ -d "/Users/lbcheng/cheng-mobile" ]; then
    mobile_root="/Users/lbcheng/cheng-mobile"
  fi
fi

if [ -z "$mobile_root" ] || [ ! -d "$mobile_root/harmony" ]; then
  echo "[Error] missing cheng-mobile/harmony (set CHENG_MOBILE_ROOT)" 1>&2
  exit 2
fi

build_dir="${root}/build/harmony_host"

cmake_args=()
if [ -n "$toolchain" ]; then
  cmake_args+=(-DCMAKE_TOOLCHAIN_FILE="$toolchain")
else
  echo "[Warn] OHOS_TOOLCHAIN_FILE not set; using host compiler" 1>&2
fi

cmake -S "${mobile_root}/harmony" -B "$build_dir" \
  -DCHENG_ENABLE_ASM_GUI=ON \
  -DCHENG_GUI_ASM_ROOT="${root}" \
  "${cmake_args[@]}"

cmake --build "$build_dir"
echo "ok: ${build_dir}"
