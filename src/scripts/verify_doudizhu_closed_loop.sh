#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  src/scripts/verify_doudizhu_closed_loop.sh [--mode real|mock] [--obj-only] [--no-link] [--smoke]

Notes:
  - Always compiles doudizhu main + doudizhu_rules_test.
  - Default mode is real(libp2p); fallback is controlled by CHENG_GAMES_P2P_ALLOW_MOCK_FALLBACK.
  - If you also want single-process runtime smoke in verify_examples_games, set CHENG_EXAMPLES_ENABLE_RUNTIME_SMOKE=1.
  - --smoke performs optional local dual-process startup smoke on macOS.
EOF
}

mode="real"
obj_only=0
no_link=0
smoke=0
while [ "${1:-}" != "" ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --mode)
      mode="${2:-}"
      shift || true
      ;;
    --obj-only)
      obj_only=1
      ;;
    --no-link)
      no_link=1
      ;;
    --smoke)
      smoke=1
      ;;
    *)
      echo "[verify-doudizhu-closed-loop] unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift || true
done

if [ "$mode" != "real" ] && [ "$mode" != "mock" ]; then
  echo "[verify-doudizhu-closed-loop] --mode must be real or mock" >&2
  exit 2
fi

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PKG_ROOT="$(CDPATH= cd -- "$SCRIPT_ROOT/.." && pwd)"
VERIFY_SCRIPT="$SCRIPT_ROOT/verify_examples_games.sh"
BIN_ROOT="$PKG_ROOT/../build/examples_games/bin"

export CHENG_GAMES_P2P_MODE="$mode"
export CHENG_GAMES_P2P_ALLOW_MOCK_FALLBACK="${CHENG_GAMES_P2P_ALLOW_MOCK_FALLBACK:-1}"

echo "[verify-doudizhu-closed-loop] step1 compile doudizhu + rules test"
bash "$VERIFY_SCRIPT" --obj-only --doudizhu-only

if [ "$obj_only" = "1" ]; then
  echo "[verify-doudizhu-closed-loop] ok (obj-only)"
  exit 0
fi

if [ "$no_link" != "1" ]; then
  echo "[verify-doudizhu-closed-loop] step2 native link + startup smoke"
  bash "$VERIFY_SCRIPT" --link-native --doudizhu-only
fi

if [ "$smoke" != "1" ]; then
  echo "[verify-doudizhu-closed-loop] done (without dual-process smoke)"
  exit 0
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[verify-doudizhu-closed-loop] skip dual-process smoke: non-macOS"
  exit 0
fi

bin="$BIN_ROOT/doudizhu_macos"
if [ ! -x "$bin" ]; then
  echo "[verify-doudizhu-closed-loop] missing binary: $bin" >&2
  exit 1
fi

log_dir="$PKG_ROOT/../build/examples_games/logs"
mkdir -p "$log_dir"

host_pid=0
client_pid=0
cleanup() {
  if [ "$client_pid" -gt 0 ] && kill -0 "$client_pid" >/dev/null 2>&1; then
    kill -TERM "$client_pid" >/dev/null 2>&1 || true
    wait "$client_pid" 2>/dev/null || true
  fi
  if [ "$host_pid" -gt 0 ] && kill -0 "$host_pid" >/dev/null 2>&1; then
    kill -TERM "$host_pid" >/dev/null 2>&1 || true
    wait "$host_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "[verify-doudizhu-closed-loop] step3 dual-process startup smoke"
CHENG_GUI_FORCE_FALLBACK=0 CHENG_GUI_USE_REAL_MAC=1 CHENG_GUI_REAL_MAC_SKIP_ABI_CHECK=1 "$bin" >"$log_dir/doudizhu_host.log" 2>&1 &
host_pid=$!
sleep 1
CHENG_GUI_FORCE_FALLBACK=0 CHENG_GUI_USE_REAL_MAC=1 CHENG_GUI_REAL_MAC_SKIP_ABI_CHECK=1 "$bin" >"$log_dir/doudizhu_client.log" 2>&1 &
client_pid=$!
sleep "${CHENG_DDZ_SMOKE_SECONDS:-4}"

if ! kill -0 "$host_pid" >/dev/null 2>&1; then
  echo "[verify-doudizhu-closed-loop] host process exited unexpectedly" >&2
  exit 1
fi
if ! kill -0 "$client_pid" >/dev/null 2>&1; then
  echo "[verify-doudizhu-closed-loop] client process exited unexpectedly" >&2
  exit 1
fi

echo "[verify-doudizhu-closed-loop] dual-process smoke ok"
echo "  logs: $log_dir/doudizhu_host.log , $log_dir/doudizhu_client.log"
