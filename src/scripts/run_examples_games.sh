#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  src/scripts/run_examples_games.sh <game> [--no-build]

Games:
  doudizhu | mahjong4 | werewolf

Notes:
  - By default this script builds and native-links examples first.
  - Then it launches the selected GUI binary.
EOF
}

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi

game="${1:-doudizhu}"
if [ "${1:-}" != "" ]; then
  shift || true
fi

no_build=0
while [ "${1:-}" != "" ]; do
  case "$1" in
    --no-build)
      no_build=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "[run-examples-games] unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift || true
done

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PKG_ROOT="$(CDPATH= cd -- "$SCRIPT_ROOT/.." && pwd)"

if [ "$no_build" != "1" ]; then
  if [ "$game" = "doudizhu" ]; then
    bash "$SCRIPT_ROOT/verify_examples_games.sh" --link-native --doudizhu-only
  else
    bash "$SCRIPT_ROOT/verify_examples_games.sh" --link-native
  fi
fi

BIN_ROOT="$PKG_ROOT/../build/examples_games/bin"
case "$game" in
  doudizhu)
    bin="$BIN_ROOT/doudizhu_macos"
    ;;
  mahjong4)
    bin="$BIN_ROOT/mahjong4_macos"
    ;;
  werewolf)
    bin="$BIN_ROOT/werewolf_macos"
    ;;
  *)
    echo "[run-examples-games] unknown game: $game" >&2
    usage
    exit 2
    ;;
esac

if [ ! -x "$bin" ]; then
  echo "[run-examples-games] missing binary: $bin" >&2
  echo "Try: bash $SCRIPT_ROOT/verify_examples_games.sh --link-native" >&2
  exit 1
fi

echo "[run-examples-games] launch: $bin"
export CHENG_GUI_FORCE_FALLBACK=0
export CHENG_GUI_USE_REAL_MAC=1
export CHENG_GUI_REAL_MAC_SKIP_ABI_CHECK=1
echo "[run-examples-games] window should appear in foreground; close it to exit"
exec "$bin"
