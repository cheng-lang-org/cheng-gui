#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SRC_ROOT="$(CDPATH= cd -- "$SCRIPT_ROOT/.." && pwd)"
PKG_ROOT="$(CDPATH= cd -- "$SRC_ROOT/.." && pwd)"
OBJ_COMPAT="$SCRIPT_ROOT/chengc_obj_compat.sh"
BUILD_SCRIPT="$SCRIPT_ROOT/build_cangwu_assets.sh"
DATA_ROOT="$SRC_ROOT/ime/data"
TEST_ROOT="$PKG_ROOT/tests/ime"
OBJ_ROOT="$PKG_ROOT/build/cangwu_ime/obj"
BIN_ROOT="$PKG_ROOT/build/cangwu_ime/bin"
GEN_ROOT="$PKG_ROOT/build/cangwu_ime/gen"

mkdir -p "$OBJ_ROOT" "$BIN_ROOT" "$GEN_ROOT"
cd "$PKG_ROOT"

echo "[verify-cangwu-ime] step1 build assets"
bash "$BUILD_SCRIPT"

manifest="$DATA_ROOT/ime_data_manifest_v1.txt"
dict_file="$DATA_ROOT/utfzh_dict_v1.tsv"
single_file="$DATA_ROOT/cangwu_single_v1.tsv"
phrase_file="$DATA_ROOT/cangwu_phrase_v1.tsv"
reverse_file="$DATA_ROOT/cangwu_reverse_v1.tsv"
legacy_gbk_file="$DATA_ROOT/legacy_gbk_to_u_v1.tsv"
legacy_gb2312_file="$DATA_ROOT/legacy_gb2312_to_u_v1.tsv"

for f in "$manifest" "$dict_file" "$single_file" "$phrase_file" "$reverse_file" "$legacy_gbk_file" "$legacy_gb2312_file"; do
  if [ ! -f "$f" ]; then
    echo "[verify-cangwu-ime] missing asset file: $f" >&2
    exit 1
  fi
done

count_dict="$(wc -l < "$dict_file" | tr -d ' ')"
if [ "$count_dict" != "9698" ]; then
  echo "[verify-cangwu-ime] dict count mismatch: $count_dict" >&2
  exit 1
fi

manifest_expect() {
  local key="$1"
  local got
  got="$(grep -E "^$key=" "$manifest" | head -n1 | cut -d= -f2- || true)"
  echo "$got"
}

sha_line_check() {
  local file="$1"
  local key="$2"
  local expect
  expect="$(manifest_expect "$key")"
  if [ -z "$expect" ]; then
    echo "[verify-cangwu-ime] missing manifest key: $key" >&2
    exit 1
  fi
  local actual
  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  if [ "$actual" != "$expect" ]; then
    echo "[verify-cangwu-ime] sha mismatch for $file" >&2
    echo "  expect=$expect" >&2
    echo "  actual=$actual" >&2
    exit 1
  fi
}

sha_line_check "$dict_file" "sha256.utfzh_dict_v1.tsv"
sha_line_check "$single_file" "sha256.cangwu_single_v1.tsv"
sha_line_check "$phrase_file" "sha256.cangwu_phrase_v1.tsv"
sha_line_check "$reverse_file" "sha256.cangwu_reverse_v1.tsv"
sha_line_check "$legacy_gbk_file" "sha256.legacy_gbk_to_u_v1.tsv"
sha_line_check "$legacy_gb2312_file" "sha256.legacy_gb2312_to_u_v1.tsv"

count_legacy_gbk="$(wc -l < "$legacy_gbk_file" | tr -d ' ')"
count_legacy_gb2312="$(wc -l < "$legacy_gb2312_file" | tr -d ' ')"
manifest_count_legacy_gbk="$(manifest_expect "count.legacy_gbk")"
manifest_count_legacy_gb2312="$(manifest_expect "count.legacy_gb2312")"
if [ -z "$manifest_count_legacy_gbk" ] || [ "$manifest_count_legacy_gbk" != "$count_legacy_gbk" ]; then
  echo "[verify-cangwu-ime] legacy gbk count mismatch: manifest=$manifest_count_legacy_gbk actual=$count_legacy_gbk" >&2
  exit 1
fi
if [ -z "$manifest_count_legacy_gb2312" ] || [ "$manifest_count_legacy_gb2312" != "$count_legacy_gb2312" ]; then
  echo "[verify-cangwu-ime] legacy gb2312 count mismatch: manifest=$manifest_count_legacy_gb2312 actual=$count_legacy_gb2312" >&2
  exit 1
fi

echo "[verify-cangwu-ime] step2 compile"
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
  echo "[verify-cangwu-ime] missing ROOT" >&2
  exit 2
fi
if [ ! -x "$OBJ_COMPAT" ]; then
  echo "[verify-cangwu-ime] missing obj compiler: $OBJ_COMPAT" >&2
  exit 2
fi

selected_driver="${CW_IME_DRIVER:-${BACKEND_DRIVER:-}}"
if [ -n "$selected_driver" ] && [ ! -x "$selected_driver" ]; then
  echo "[verify-cangwu-ime] selected driver is not executable: $selected_driver" >&2
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
  echo "[verify-cangwu-ime] no runnable backend driver found under ROOT=$ROOT" >&2
  exit 2
fi
export BACKEND_DRIVER="$selected_driver"
export BACKEND_DRIVER_DIRECT="${BACKEND_DRIVER_DIRECT:-0}"

target="${EXAMPLES_TARGET:-}"
if [ -z "$target" ]; then
  target="$(sh "$ROOT/src/tooling/detect_host_target.sh")"
fi
if [ -z "$target" ]; then
  echo "[verify-cangwu-ime] failed to detect host target" >&2
  exit 2
fi

export PKG_ROOTS="${PKG_ROOTS:-$HOME/.cheng-packages,$PKG_ROOT}"
frontend="${CW_IME_FRONTEND:-stage1}"
full_mode="${CW_IME_FULL:-0}"
compile_jobs="${CW_IME_JOBS:-8}"
compile_incremental="${CW_IME_INCREMENTAL:-1}"
compile_validate="${CW_IME_VALIDATE:-0}"
stage1_skip_sem="${CW_IME_STAGE1_SKIP_SEM:-1}"
stage1_skip_ownership="${CW_IME_STAGE1_SKIP_OWNERSHIP:-1}"
stage1_generic_mode="${CW_IME_GENERIC_MODE:-dict}"
stage1_generic_budget="${CW_IME_GENERIC_SPEC_BUDGET:-0}"

generate_bundle_test_main() {
  local out="$1"
  cat > "$out" <<'EOF'
import std/os
EOF
  local modules=(
    "$SRC_ROOT/ime/cangwu_types.cheng"
    "$SRC_ROOT/ime/cangwu_rules.cheng"
    "$SRC_ROOT/ime/cangwu_assets_loader.cheng"
    "$SRC_ROOT/ime/legacy_types.cheng"
    "$SRC_ROOT/ime/legacy_assets_loader.cheng"
    "$SRC_ROOT/ime/cangwu_engine.cheng"
    "$SRC_ROOT/ime/cangwu_reverse.cheng"
    "$SRC_ROOT/ime/utfzh_codec.cheng"
    "$SRC_ROOT/ime/legacy_codec.cheng"
    "$SRC_ROOT/ime/panel_state.cheng"
  )
  local src
  for src in "${modules[@]}"; do
    if [ ! -f "$src" ]; then
      echo "[verify-cangwu-ime] missing source module: $src" >&2
      exit 2
    fi
    sed '/^import /d' "$src" >> "$out"
    printf '\n' >> "$out"
  done
  cat >> "$out" <<'EOF'
fn main(): int32 =
    return cwRunImeSelfTests("src/ime/data")

main()
EOF
}

test_main="${CW_IME_TEST_MAIN:-}"
if [ -z "$test_main" ]; then
  test_main="$GEN_ROOT/cangwu_ime_bundle_test_main.cheng"
  generate_bundle_test_main "$test_main"
fi
if [ ! -f "$test_main" ]; then
  echo "[verify-cangwu-ime] missing test main: $test_main" >&2
  exit 2
fi
test_tag="$(basename "$test_main" .cheng | tr -c 'A-Za-z0-9._-' '_')"
test_obj="$OBJ_ROOT/$test_tag.o"
test_bin="$BIN_ROOT/$test_tag"
run_bundle="${CW_IME_RUN_BUNDLE:-0}"
compile_test_sources=(
  "$TEST_ROOT/utfzh_codec_test.cheng"
  "$TEST_ROOT/cangwu_engine_test.cheng"
  "$TEST_ROOT/cangwu_phrase_test.cheng"
  "$TEST_ROOT/cangwu_reverse_test.cheng"
  "$TEST_ROOT/cangwu_panel_smoke_test.cheng"
  "$TEST_ROOT/legacy_codec_test.cheng"
  "$TEST_ROOT/utfzh_transcode_test.cheng"
  "$TEST_ROOT/cangwu_strict_noptr_compile_test.cheng"
  "$TEST_ROOT/cangwu_all_test_main.cheng"
)
runtime_test_sources=(
  "$TEST_ROOT/cangwu_strict_noptr_compile_test.cheng"
)
runtime_test_objs=()
runtime_test_bins=()
compile_test_objs=()
compile_obj() {
  local input="$1"
  local output="$2"
  (
    cd "$PKG_ROOT"
    CHENGC_OBJ_COMPAT_DRIVER="$selected_driver" \
    DEFINES="${DEFINES:-macos,macosx}" \
    ABI=v2_noptr \
    STAGE1_STD_NO_POINTERS=0 \
    STAGE1_STD_NO_POINTERS_STRICT=0 \
    STAGE1_NO_POINTERS_NON_C_ABI=0 \
    STAGE1_NO_POINTERS_NON_C_ABI_INTERNAL=0 \
    BACKEND_TARGET="$target" \
    BACKEND_JOBS="$compile_jobs" \
    BACKEND_MULTI="${BACKEND_MULTI:-0}" \
    BACKEND_INCREMENTAL="$compile_incremental" \
    BACKEND_WHOLE_PROGRAM=1 \
    BACKEND_FRONTEND="$frontend" \
    BACKEND_VALIDATE="$compile_validate" \
    STAGE1_SKIP_SEM="$stage1_skip_sem" \
    STAGE1_SKIP_OWNERSHIP="$stage1_skip_ownership" \
    GENERIC_MODE="$stage1_generic_mode" \
    GENERIC_SPEC_BUDGET="$stage1_generic_budget" \
    "$OBJ_COMPAT" "$input" \
      --emit-obj \
      --obj-out:"$output" \
      --target:"$target" \
      --frontend:"$frontend" \
      --jobs:"$compile_jobs"
  )
}

check_no_pointer_module() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "[verify-cangwu-ime] missing strict file: $file" >&2
    exit 2
  fi
  if rg -n "void\\*|ptr_add|alloc\\(|dealloc\\(|->|\\bref\\b" "$file" >/dev/null 2>&1; then
    echo "[verify-cangwu-ime] strict no-pointer violation: $file" >&2
    rg -n "void\\*|ptr_add|alloc\\(|dealloc\\(|->|\\bref\\b" "$file" >&2 || true
    exit 2
  fi
}

echo "[verify-cangwu-ime] step2 strict compile gate"
check_no_pointer_module "$SRC_ROOT/ime/cangwu_engine.cheng"
check_no_pointer_module "$SRC_ROOT/ime/panel_render.cheng"
check_no_pointer_module "$SRC_ROOT/ime/panel_runtime.cheng"

echo "[verify-cangwu-ime] step2 compile tests"
compile_obj "$SRC_ROOT/cangwu_ime_main.cheng" "$OBJ_ROOT/cangwu_ime_main.o"
if [ "$full_mode" = "1" ]; then
  echo "[verify-cangwu-ime] full mode: GUI entry compiled"
fi
if [ "$run_bundle" = "1" ]; then
  compile_obj "$test_main" "$test_obj"
fi
for src in "${compile_test_sources[@]}"; do
  if [ ! -f "$src" ]; then
    echo "[verify-cangwu-ime] missing test file: $src" >&2
    exit 2
  fi
  tag="$(basename "$src" .cheng | tr -c 'A-Za-z0-9._-' '_')"
  obj="$OBJ_ROOT/$tag.o"
  compile_obj "$src" "$obj"
  compile_test_objs+=("$obj")
done
for src in "${runtime_test_sources[@]}"; do
  tag="$(basename "$src" .cheng | tr -c 'A-Za-z0-9._-' '_')"
  runtime_test_objs+=("$OBJ_ROOT/$tag.o")
  runtime_test_bins+=("$BIN_ROOT/$tag")
done

echo "[verify-cangwu-ime] step3 run tests"
obj_sys="$OBJ_ROOT/cangwu_ime.system_helpers.runtime.o"
obj_compat="$OBJ_ROOT/cangwu_ime.compat_shim.runtime.o"
obj_panel_bridge="$OBJ_ROOT/cangwu_ime.panel_bridge.runtime.o"
compat_shim_src="$SRC_ROOT/runtime/cheng_compat_shim.c"
panel_bridge_src="$SRC_ROOT/runtime/cangwu_panel_bridge.c"
clang -I"$ROOT/runtime/include" -I"$ROOT/src/runtime/native" \
  -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
  -Dcheng_ptr_to_u64=cheng_sys_ptr_to_u64 -Dcheng_ptr_size=cheng_sys_ptr_size -Dcheng_strlen=cheng_sys_strlen \
  -c "$ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
if [ -f "$compat_shim_src" ]; then
  clang -c "$compat_shim_src" -o "$obj_compat"
else
  obj_compat=""
fi
if [ -f "$panel_bridge_src" ]; then
  clang -c "$panel_bridge_src" -o "$obj_panel_bridge"
else
  obj_panel_bridge=""
fi

run_test() {
  local obj="$1"
  local bin="$2"
  clang "$obj" "$obj_sys" ${obj_compat:+"$obj_compat"} ${obj_panel_bridge:+"$obj_panel_bridge"} -o "$bin"
  echo "[verify-cangwu-ime] run $(basename "$bin")"
  local timeout_s="${CW_IME_TEST_TIMEOUT:-60}"
  set +e
  perl -e '
    use POSIX qw(setsid WNOHANG);
    my $timeout = shift @ARGV;
    my $pid = fork();
    if (!defined $pid) { exit 127; }
    if ($pid == 0) {
      setsid();
      exec @ARGV;
      exit 127;
    }
    my $end = time() + $timeout;
    while (1) {
      my $res = waitpid($pid, WNOHANG);
      if ($res == $pid) {
        my $status = $?;
        if (($status & 127) != 0) { exit(128 + ($status & 127)); }
        exit($status >> 8);
      }
      if (time() >= $end) {
        kill "TERM", -$pid;
        select(undef, undef, undef, 0.3);
        kill "KILL", -$pid;
        exit 124;
      }
      select(undef, undef, undef, 0.05);
    }
  ' "$timeout_s" env \
    CW_IME_MAX_PHRASES="${CW_IME_MAX_PHRASES:-100}" \
    CW_IME_MAX_REVERSE="${CW_IME_MAX_REVERSE:-200}" \
    "$bin"
  local rc=$?
  set -e
  if [ "$rc" = "124" ]; then
    echo "[verify-cangwu-ime] test timeout: $bin" >&2
  fi
  if [ "$rc" -ne 0 ]; then
    return "$rc"
  fi
}

if [ "$run_bundle" = "1" ]; then
  run_test "$test_obj" "$test_bin"
fi
for idx in "${!runtime_test_objs[@]}"; do
  run_test "${runtime_test_objs[$idx]}" "${runtime_test_bins[$idx]}"
done

echo "[verify-cangwu-ime] step3 transcode smoke"
smoke_dir="$PKG_ROOT/build/cangwu_ime/verify_runtime"
mkdir -p "$smoke_dir"
smoke_utf8_in="$smoke_dir/in_utf8.txt"
smoke_gbk_in="$smoke_dir/in_gbk.bin"
smoke_utf8_out="$smoke_dir/out_utf8.utfzh"
smoke_gbk_out="$smoke_dir/out_gbk.utfzh"
smoke_auto_out="$smoke_dir/out_auto.utfzh"
smoke_utf8_report="$smoke_dir/report_utf8.txt"
smoke_gbk_report="$smoke_dir/report_gbk.txt"
smoke_auto_report="$smoke_dir/report_auto.txt"
cli_bin_dir="$PKG_ROOT/build/cangwu_ime/bin"
printf 'abc中文A' > "$smoke_utf8_in"
printf '\xD6\xD0\xCE\xC4' > "$smoke_gbk_in"
CW_IME_PKG_ROOT="$PKG_ROOT" "$cli_bin_dir/convert_to_utfzh" --in "$smoke_utf8_in" --out "$smoke_utf8_out" --from utf8 --report "$smoke_utf8_report"
bash "$SCRIPT_ROOT/convert_to_utfzh.sh" --in "$smoke_gbk_in" --out "$smoke_gbk_out" --from gbk --report "$smoke_gbk_report"
bash "$SCRIPT_ROOT/convert_to_utfzh.sh" --in "$smoke_gbk_in" --out "$smoke_auto_out" --from auto --report "$smoke_auto_report"
grep -q '^ok=true$' "$smoke_utf8_report"
grep -q '^detected=utf8$' "$smoke_utf8_report"
grep -q '^ok=true$' "$smoke_gbk_report"
grep -q '^detected=gbk$' "$smoke_gbk_report"
grep -q '^ok=true$' "$smoke_auto_report"
grep -q '^detected=gbk$' "$smoke_auto_report"

echo "[verify-cangwu-ime] ok"
echo "  assets=$DATA_ROOT"
echo "  objs=$OBJ_ROOT"
echo "  bins=$BIN_ROOT"
