#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SRC="$ROOT/tools/script_dispatcher.c"
SRC_NATIVE_ANDROID_GATE="$ROOT/tools/native_verify_android_claude_1to1_gate.c"
SRC_NATIVE_R2C_COMPILE="$ROOT/tools/native_r2c_compile_react_project.c"
SRC_NATIVE_ANDROID_FULLROUTE="$ROOT/tools/native_verify_android_fullroute_visual_pixel.c"
SRC_NATIVE_MOBILE_RUN_ANDROID="$ROOT/tools/native_mobile_run_android.c"
SCRIPTS_DIR="$ROOT/scripts"
OUT_DIR="$ROOT/bin"
BIN_NAME="${CHENG_GUI_SCRIPTS_BIN_NAME:-cheng_gui_scripts}"
BIN_PATH="$OUT_DIR/$BIN_NAME"
CC_BIN="${CC:-cc}"
CFLAGS_DEFAULT="-std=c11 -O2 -Wall -Wextra"

usage() {
  cat <<'EOF'
Usage:
  build_script_dispatcher.sh [--out-dir <abs_path>] [--bin-name <name>] [--link-mode <symlink|hardlink|copy>] [--no-links]

Builds a multicall binary that dispatches to src/scripts/*.sh and *.py.
By default it also creates hardlink command entries in the same output directory.
EOF
}

create_links="1"
link_mode="${CHENG_GUI_DISPATCHER_LINK_MODE:-hardlink}"
while [ $# -gt 0 ]; do
  case "$1" in
    --out-dir)
      OUT_DIR="${2:-}"
      shift 2
      ;;
    --bin-name)
      BIN_NAME="${2:-}"
      shift 2
      ;;
    --link-mode)
      link_mode="${2:-}"
      shift 2
      ;;
    --no-links)
      create_links="0"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[build-script-dispatcher] unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

if [ ! -f "$SRC" ]; then
  echo "[build-script-dispatcher] missing source: $SRC" >&2
  exit 1
fi
if [ ! -f "$SRC_NATIVE_ANDROID_GATE" ]; then
  echo "[build-script-dispatcher] missing source: $SRC_NATIVE_ANDROID_GATE" >&2
  exit 1
fi
if [ ! -f "$SRC_NATIVE_R2C_COMPILE" ]; then
  echo "[build-script-dispatcher] missing source: $SRC_NATIVE_R2C_COMPILE" >&2
  exit 1
fi
if [ ! -f "$SRC_NATIVE_ANDROID_FULLROUTE" ]; then
  echo "[build-script-dispatcher] missing source: $SRC_NATIVE_ANDROID_FULLROUTE" >&2
  exit 1
fi
if [ ! -f "$SRC_NATIVE_MOBILE_RUN_ANDROID" ]; then
  echo "[build-script-dispatcher] missing source: $SRC_NATIVE_MOBILE_RUN_ANDROID" >&2
  exit 1
fi
if [ ! -d "$SCRIPTS_DIR" ]; then
  echo "[build-script-dispatcher] missing scripts dir: $SCRIPTS_DIR" >&2
  exit 1
fi
if ! command -v "$CC_BIN" >/dev/null 2>&1; then
  echo "[build-script-dispatcher] missing compiler: $CC_BIN" >&2
  exit 2
fi
if [ -z "$OUT_DIR" ] || [ -z "$BIN_NAME" ]; then
  echo "[build-script-dispatcher] invalid output args" >&2
  exit 2
fi
case "$link_mode" in
  symlink|hardlink|copy) ;;
  *)
    echo "[build-script-dispatcher] invalid --link-mode: $link_mode" >&2
    exit 2
    ;;
esac

mkdir -p "$OUT_DIR"
BIN_PATH="$OUT_DIR/$BIN_NAME"

"$CC_BIN" $CFLAGS_DEFAULT \
  -DCHENG_GUI_SCRIPTS_DIR_DEFAULT="\"$SCRIPTS_DIR\"" \
  "$SRC" \
  "$SRC_NATIVE_ANDROID_GATE" \
  "$SRC_NATIVE_R2C_COMPILE" \
  "$SRC_NATIVE_ANDROID_FULLROUTE" \
  "$SRC_NATIVE_MOBILE_RUN_ANDROID" \
  -o "$BIN_PATH"

chmod +x "$BIN_PATH"
echo "[build-script-dispatcher] built: $BIN_PATH"

if [ "$create_links" = "1" ]; then
  seen_file="$(mktemp)"
  trap 'rm -f "$seen_file"' EXIT
  create_alias_link() {
    local base="$1"
    local target="$OUT_DIR/$base"
    case "$link_mode" in
      symlink)
        ln -sfn "$BIN_NAME" "$target"
        ;;
      hardlink)
        rm -f "$target"
        ln "$BIN_PATH" "$target"
        ;;
      copy)
        cp -f "$BIN_PATH" "$target"
        chmod +x "$target"
        ;;
    esac
  }
  while IFS= read -r path; do
    file="$(basename "$path")"
    base="$file"
    base="${base%.sh}"
    base="${base%.py}"
    if [ -z "$base" ]; then
      continue
    fi
    if [ "$base" = "$BIN_NAME" ]; then
      continue
    fi
    if grep -Fxq -- "$base" "$seen_file"; then
      continue
    fi
    printf '%s\n' "$base" >> "$seen_file"
    create_alias_link "$base"
  done < <(find "$SCRIPTS_DIR" -maxdepth 1 -type f \( -name '*.sh' -o -name '*.py' \) | sort)

  # Native-only subcommands that do not have script files.
  for native_cmd in mobile_run_android; do
    if grep -Fxq -- "$native_cmd" "$seen_file"; then
      continue
    fi
    printf '%s\n' "$native_cmd" >> "$seen_file"
    create_alias_link "$native_cmd"
  done

  rm -f "$seen_file"
  trap - EXIT
  echo "[build-script-dispatcher] linked commands into: $OUT_DIR (mode=$link_mode)"
fi

echo "[build-script-dispatcher] done"
