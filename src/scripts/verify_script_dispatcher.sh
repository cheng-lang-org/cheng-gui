#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SCRIPTS_DIR="$ROOT/scripts"
BIN_DIR="${CHENG_GUI_DISPATCHER_BIN_DIR:-$ROOT/bin}"
BIN_NAME="${CHENG_GUI_DISPATCHER_BIN_NAME:-cheng_gui_scripts}"
BIN_PATH="$BIN_DIR/$BIN_NAME"
LINK_MODE="${CHENG_GUI_DISPATCHER_LINK_MODE:-hardlink}"

usage() {
  cat <<'EOF'
Usage:
  verify_script_dispatcher.sh [--bin-dir <abs_path>] [--bin-name <name>]

Validates script-dispatcher binary build and command parity with src/scripts.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --bin-dir)
      BIN_DIR="${2:-}"
      shift 2
      ;;
    --bin-name)
      BIN_NAME="${2:-}"
      shift 2
      ;;
    --link-mode)
      LINK_MODE="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[verify-script-dispatcher] unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done
case "$LINK_MODE" in
  symlink|hardlink|copy) ;;
  *)
    echo "[verify-script-dispatcher] invalid --link-mode: $LINK_MODE" >&2
    exit 2
    ;;
esac

if [ ! -d "$SCRIPTS_DIR" ]; then
  echo "[verify-script-dispatcher] missing scripts dir: $SCRIPTS_DIR" >&2
  exit 1
fi

echo "[verify-script-dispatcher] build dispatcher"
"$SCRIPTS_DIR/build_script_dispatcher.sh" --out-dir "$BIN_DIR" --bin-name "$BIN_NAME" --link-mode "$LINK_MODE"
BIN_PATH="$BIN_DIR/$BIN_NAME"
if [ ! -x "$BIN_PATH" ]; then
  echo "[verify-script-dispatcher] missing executable binary: $BIN_PATH" >&2
  exit 1
fi

script_names="$(mktemp)"
expected_names="$(mktemp)"
bin_names="$(mktemp)"
list_out="$(mktemp)"
trap 'rm -f "$script_names" "$expected_names" "$bin_names" "$list_out"' EXIT

find "$SCRIPTS_DIR" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.py' \) \
  | sed -e 's#^.*/##' -e 's/\.sh$//' -e 's/\.py$//' \
  | sort -u > "$script_names"
cp "$script_names" "$expected_names"
native_only_commands=(
  "mobile_run_android"
)
for cmd in "${native_only_commands[@]}"; do
  printf '%s\n' "$cmd" >> "$expected_names"
done
sort -u "$expected_names" -o "$expected_names"
find "$BIN_DIR" -maxdepth 1 \( -type f -o -type l \) \
  | sed -e 's#^.*/##' \
  | grep -v -E "^${BIN_NAME}$" \
  | sort -u > "$bin_names"

script_count="$(wc -l < "$expected_names" | tr -d ' ')"
bin_count="$(wc -l < "$bin_names" | tr -d ' ')"

show_name_diff() {
  python3 - "$expected_names" "$bin_names" <<'PY'
import sys

expected_path, actual_path = sys.argv[1:3]
expected = [line.strip() for line in open(expected_path, "r", encoding="utf-8") if line.strip()]
actual = [line.strip() for line in open(actual_path, "r", encoding="utf-8") if line.strip()]
expected_set = set(expected)
actual_set = set(actual)
missing = sorted(expected_set - actual_set)
extra = sorted(actual_set - expected_set)
if missing:
    print("[verify-script-dispatcher] missing commands:")
    for name in missing:
        print(f"  - {name}")
if extra:
    print("[verify-script-dispatcher] extra commands:")
    for name in extra:
        print(f"  + {name}")
if not missing and not extra:
    print("[verify-script-dispatcher] command names differ by order only")
PY
}

if [ "$script_count" != "$bin_count" ]; then
  echo "[verify-script-dispatcher] command count mismatch scripts=$script_count bins=$bin_count" >&2
  show_name_diff >&2
  exit 1
fi

if ! cmp -s "$expected_names" "$bin_names"; then
  echo "[verify-script-dispatcher] command name set mismatch" >&2
  show_name_diff >&2
  exit 1
fi

"$BIN_PATH" --list > "$list_out"
listed_count="$(wc -l < "$list_out" | tr -d ' ')"
if [ "$listed_count" -lt 1 ]; then
  echo "[verify-script-dispatcher] --list returned empty result" >&2
  exit 1
fi

need_commands=(
  "verify_production_closed_loop"
  "verify_android_claude_1to1_gate"
  "verify_android_fullroute_visual_pixel"
  "r2c_compile_react_project"
  "mobile_run_android"
)
for cmd in "${need_commands[@]}"; do
  if ! grep -Fxq -- "$cmd" "$list_out"; then
    echo "[verify-script-dispatcher] missing command in --list: $cmd" >&2
    exit 1
  fi
  if [ ! -x "$BIN_DIR/$cmd" ]; then
    echo "[verify-script-dispatcher] command entry not executable: $BIN_DIR/$cmd" >&2
    exit 1
  fi
done

"$BIN_PATH" verify_android_fullroute_visual_pixel --help >/dev/null
"$BIN_DIR/verify_android_fullroute_visual_pixel" --help >/dev/null
"$BIN_PATH" verify_android_claude_1to1_gate --help >/dev/null

echo "[verify-script-dispatcher] ok scripts=$script_count commands=$listed_count bin=$BIN_PATH mode=$LINK_MODE"
