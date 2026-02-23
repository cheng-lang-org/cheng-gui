#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  src/scripts/verify_examples_games.sh [--obj-only] [--link-native] [--doudizhu-only] [--run-doudizhu]

Notes:
  - Verifies examples_games layout and compiles 3 example entries + 3 test entries.
  - Example entries are compiled with frontend=stage1 by default.
  - doudizhu-only path defaults to frontend=stage1 (override EXAMPLES_DDZ_FRONTEND).
  - Tests are compiled with the same frontend as their example path.
  - By default this script validates compile closure only.
  - --link-native enables optional macOS desktop linking.
  - Runtime smoke is disabled by default; set EXAMPLES_ENABLE_RUNTIME_SMOKE=1 to enable.
  - --doudizhu-only compiles/links only doudizhu + doudizhu_rules_test.
  - --run-doudizhu launches linked doudizhu binary after link.
EOF
}

obj_only=0
link_native=0
doudizhu_only=0
run_doudizhu=0
while [ "${1:-}" != "" ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --obj-only)
      obj_only=1
      ;;
    --link-native)
      link_native=1
      ;;
    --doudizhu-only)
      doudizhu_only=1
      ;;
    --run-doudizhu)
      run_doudizhu=1
      link_native=1
      ;;
    *)
      echo "[verify-examples-games] unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift || true
done

SRC_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PKG_ROOT="$(CDPATH= cd -- "$SRC_ROOT/.." && pwd)"
EXAMPLES_ROOT="$PKG_ROOT/examples"
TEST_ROOT="$PKG_ROOT/tests/examples_games"
MODULE_ROOT="$SRC_ROOT/examples_games"
BUILD_ROOT="$PKG_ROOT/build/examples_games"
OBJ_ROOT="$BUILD_ROOT/obj"
BIN_ROOT="$BUILD_ROOT/bin"

mkdir -p "$OBJ_ROOT" "$BIN_ROOT"

ROOT="${ROOT:-}"
if [ -z "$ROOT" ]; then
  if [ -d "$HOME/.cheng/toolchain/cheng-lang" ]; then
    ROOT="$HOME/.cheng/toolchain/cheng-lang"
  elif [ -d "$HOME/cheng-lang" ]; then
    ROOT="$HOME/cheng-lang"
  elif [ -d "/Users/lbcheng/cheng-lang" ]; then
    ROOT="/Users/lbcheng/cheng-lang"
  fi
fi
if [ -z "$ROOT" ]; then
  echo "[verify-examples-games] missing ROOT" >&2
  exit 2
fi

CHENGC="${CHENGC:-$ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-examples-games] missing chengc: $CHENGC" >&2
  exit 2
fi

selected_driver="${EXAMPLES_DRIVER:-${BACKEND_DRIVER:-}}"
if [ -n "$selected_driver" ] && [ ! -x "$selected_driver" ]; then
  echo "[verify-examples-games] selected driver is not executable: $selected_driver" >&2
  exit 2
fi
if [ -z "$selected_driver" ] && [ -x "$ROOT/dist/releases/current/cheng" ]; then
  selected_driver="$ROOT/dist/releases/current/cheng"
fi
if [ -z "$selected_driver" ] && [ -x "$ROOT/cheng_libp2p_tests" ]; then
  selected_driver="$ROOT/cheng_libp2p_tests"
fi
if [ -z "$selected_driver" ] && [ -d "$ROOT/dist/releases" ]; then
  while IFS= read -r candidate; do
    if [ -x "$candidate/cheng" ]; then
      selected_driver="$candidate/cheng"
      break
    fi
  done < <(ls -1dt "$ROOT"/dist/releases/* 2>/dev/null || true)
fi
if [ -z "$selected_driver" ]; then
  if [ -x "$ROOT/cheng_stable" ]; then
    selected_driver="$ROOT/cheng_stable"
  elif [ -x "$ROOT/cheng" ]; then
    selected_driver="$ROOT/cheng"
  fi
fi
if [ -z "$selected_driver" ]; then
  for cand in "$ROOT"/driver_*; do
    if [ -f "$cand" ] && [ -x "$cand" ]; then
      selected_driver="$cand"
      break
    fi
  done
fi
if [ -z "$selected_driver" ] && [ -x "$ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2" ]; then
  selected_driver="$ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2"
fi
if [ -z "$selected_driver" ]; then
  echo "[verify-examples-games] no runnable backend driver found under ROOT=$ROOT" >&2
  exit 2
fi
export BACKEND_DRIVER="$selected_driver"
export BACKEND_DRIVER_DIRECT="${BACKEND_DRIVER_DIRECT:-0}"

pkg_roots="${PKG_ROOTS:-}"
default_pkg_root="$HOME/.cheng-packages"
if [ -d "$default_pkg_root" ]; then
  if [ -z "$pkg_roots" ]; then
    pkg_roots="$default_pkg_root"
  else
    case ",$pkg_roots," in
      *,"$default_pkg_root",*) ;;
      *) pkg_roots="$pkg_roots,$default_pkg_root" ;;
    esac
  fi
fi
if [ -z "$pkg_roots" ]; then
  pkg_roots="$PKG_ROOT"
else
  case ",$pkg_roots," in
    *,"$PKG_ROOT",*) ;;
    *) pkg_roots="$pkg_roots,$PKG_ROOT" ;;
  esac
fi
export PKG_ROOTS="$pkg_roots"

target="${EXAMPLES_TARGET:-}"
if [ -z "$target" ]; then
  target="$(sh "$ROOT/src/tooling/detect_host_target.sh")"
fi
if [ -z "$target" ]; then
  echo "[verify-examples-games] failed to detect host target" >&2
  exit 2
fi

required_paths="
$EXAMPLES_ROOT/doudizhu_main.cheng
$EXAMPLES_ROOT/mahjong4_main.cheng
$EXAMPLES_ROOT/werewolf_main.cheng
$MODULE_ROOT/common/protocol.cheng
$MODULE_ROOT/common/p2p_node.cheng
$MODULE_ROOT/common/gui_runtime.cheng
$MODULE_ROOT/common/session_store.cheng
$MODULE_ROOT/doudizhu/state.cheng
$MODULE_ROOT/doudizhu/app.cheng
$MODULE_ROOT/mahjong4/state.cheng
$MODULE_ROOT/mahjong4/app.cheng
$MODULE_ROOT/werewolf/state.cheng
$MODULE_ROOT/werewolf/app.cheng
$TEST_ROOT/doudizhu_rules_test.cheng
$TEST_ROOT/mahjong81_test.cheng
$TEST_ROOT/werewolf_flow_test.cheng
"

while IFS= read -r req; do
  if [ -n "$req" ] && [ ! -f "$req" ]; then
    echo "[verify-examples-games] missing required file: $req" >&2
    exit 1
  fi
done <<EOF
$required_paths
EOF

compile_obj() {
  local input="$1"
  local output="$2"
  local frontend="$3"
  echo "== compile: $input"
  (
    cd "$ROOT"
    BACKEND_FRONTEND="$frontend" "$CHENGC" "$input" --emit-obj --obj-out:"$output" --target:"$target"
  )
}

doudizhu_frontend="${EXAMPLES_DDZ_FRONTEND:-stage1}"
doudizhu_test_frontend="${EXAMPLES_DDZ_TEST_FRONTEND:-stage1}"

doudizhu_main="$EXAMPLES_ROOT/doudizhu_main.cheng"
mahjong_main="$EXAMPLES_ROOT/mahjong4_main.cheng"
werewolf_main="$EXAMPLES_ROOT/werewolf_main.cheng"

doudizhu_test="$TEST_ROOT/doudizhu_rules_test.cheng"
mahjong_test="$TEST_ROOT/mahjong81_test.cheng"
werewolf_test="$TEST_ROOT/werewolf_flow_test.cheng"

doudizhu_main_obj="$OBJ_ROOT/doudizhu_main.o"
mahjong_main_obj="$OBJ_ROOT/mahjong4_main.o"
werewolf_main_obj="$OBJ_ROOT/werewolf_main.o"

compile_obj "$doudizhu_main" "$doudizhu_main_obj" "$doudizhu_frontend"
compile_obj "$doudizhu_test" "$OBJ_ROOT/doudizhu_rules_test.o" "$doudizhu_test_frontend"
if [ "$doudizhu_only" != "1" ]; then
  compile_obj "$mahjong_main" "$mahjong_main_obj" "stage1"
  compile_obj "$werewolf_main" "$werewolf_main_obj" "stage1"
  compile_obj "$mahjong_test" "$OBJ_ROOT/mahjong81_test.o" "stage1"
  compile_obj "$werewolf_test" "$OBJ_ROOT/werewolf_flow_test.o" "stage1"
fi

if [ "$obj_only" = "1" ]; then
  if [ "$doudizhu_only" = "1" ]; then
    echo "[verify-examples-games] ok (obj-only, doudizhu-only)"
  else
    echo "[verify-examples-games] ok (obj-only)"
  fi
  exit 0
fi

if [ "$link_native" != "1" ]; then
  echo "[verify-examples-games] skip native link (pass --link-native to enable)"
  echo "[verify-examples-games] ok (compiled objs)"
  exit 0
fi

host="$(uname -s)"
if [ "$host" != "Darwin" ]; then
  echo "[verify-examples-games] skip desktop link: host=$host (only macOS desktop link is configured)"
  echo "[verify-examples-games] ok (compiled objs)"
  exit 0
fi

obj_sys="$OBJ_ROOT/examples_games.system_helpers.runtime.o"
obj_compat="$OBJ_ROOT/examples_games.compat_shim.runtime.o"
obj_stub="$OBJ_ROOT/examples_games.mobile_stub.runtime.o"
obj_skia="$OBJ_ROOT/examples_games.skia_stub.runtime.o"
obj_plat="$OBJ_ROOT/examples_games.macos_app.runtime.o"
obj_text="$OBJ_ROOT/examples_games.text_macos.runtime.o"
obj_link_shim="$OBJ_ROOT/examples_games.link_shim.runtime.o"
compat_shim_src="$SRC_ROOT/runtime/cheng_compat_shim.c"
use_compat_shim="${EXAMPLES_USE_COMPAT_SHIM:-0}"

clang -I"$ROOT/runtime/include" -I"$ROOT/src/runtime/native" \
  -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
  -c "$ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
if [ "$use_compat_shim" = "1" ] && [ -f "$compat_shim_src" ]; then
  clang -c "$compat_shim_src" -o "$obj_compat"
else
  obj_compat=""
fi
clang -c "$SRC_ROOT/platform/cheng_mobile_host_stub.c" -o "$obj_stub"
clang -c "$SRC_ROOT/render/skia_stub.c" -o "$obj_skia"
clang -fobjc-arc -c "$SRC_ROOT/platform/macos_app.m" -o "$obj_plat"
clang -std=c11 -c "$SRC_ROOT/render/text_macos.c" -o "$obj_text"
clang -std=c11 -c "$SRC_ROOT/runtime/examples_games_link_shim.c" -o "$obj_link_shim"

link_desktop() {
  local main_obj="$1"
  local output_bin="$2"
  clang "$main_obj" "$obj_sys" "$obj_link_shim" ${obj_compat:+"$obj_compat"} "$obj_stub" "$obj_skia" "$obj_plat" "$obj_text" \
    -framework Cocoa -framework QuartzCore -framework CoreGraphics -framework CoreText -framework CoreFoundation \
    -o "$output_bin"
}

smoke_bin() {
  local output_bin="$1"
  if [ "${EXAMPLES_ENABLE_RUNTIME_SMOKE:-0}" != "1" ]; then
    return 0
  fi
  set +e
  GUI_FORCE_FALLBACK=0 GUI_USE_REAL_MAC=1 GUI_REAL_MAC_SKIP_ABI_CHECK=1 "$output_bin" >/dev/null 2>&1 &
  local pid=$!
  sleep 2
  local rc=0
  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -TERM "$pid" >/dev/null 2>&1
    wait "$pid" 2>/dev/null
    rc=$?
  else
    wait "$pid" 2>/dev/null
    rc=$?
  fi
  set -e
  if [ "$rc" = "139" ]; then
    echo "[verify-examples-games] runtime smoke failed (segfault): $output_bin" >&2
    return 1
  fi
  return 0
}

echo "== link: doudizhu"
link_desktop "$doudizhu_main_obj" "$BIN_ROOT/doudizhu_macos"
smoke_bin "$BIN_ROOT/doudizhu_macos"
if [ "$doudizhu_only" != "1" ]; then
  echo "== link: mahjong4"
  link_desktop "$mahjong_main_obj" "$BIN_ROOT/mahjong4_macos"
  smoke_bin "$BIN_ROOT/mahjong4_macos"
  echo "== link: werewolf"
  link_desktop "$werewolf_main_obj" "$BIN_ROOT/werewolf_macos"
  smoke_bin "$BIN_ROOT/werewolf_macos"
fi

if [ "$run_doudizhu" = "1" ]; then
  echo "[verify-examples-games] launch doudizhu binary"
  GUI_FORCE_FALLBACK=0 GUI_USE_REAL_MAC=1 GUI_REAL_MAC_SKIP_ABI_CHECK=1 "$BIN_ROOT/doudizhu_macos"
fi

echo "[verify-examples-games] ok"
echo "  objs: $OBJ_ROOT"
echo "  bins: $BIN_ROOT"
