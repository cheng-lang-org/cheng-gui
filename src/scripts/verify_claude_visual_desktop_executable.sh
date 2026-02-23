#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

host="$(uname -s)"
if [ "$host" != "Darwin" ]; then
  echo "[verify-claude-visual] skip: host=$host (visual desktop gate currently macOS-only)"
  exit 0
fi

for bin in shasum python3; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[verify-claude-visual] missing dependency: $bin" >&2
    exit 2
  fi
done

bash "$ROOT/scripts/sync_claude_fixture.sh" || true

fixture_root="$ROOT/tests/claude_fixture"
if [ ! -f "$fixture_root/index.html" ] || [ ! -f "$fixture_root/app/main.tsx" ]; then
  echo "[verify-claude-visual] missing fixture under: $fixture_root" >&2
  exit 1
fi

golden_visual_dir="$fixture_root/golden/visual"
for state in lang_select home messages publish nodes profile trading; do
  if [ ! -f "$golden_visual_dir/$state.framehash" ]; then
    echo "[verify-claude-visual] missing frame-hash golden: $golden_visual_dir/$state.framehash" >&2
    exit 1
  fi
done

out_dir="$ROOT/build/r2c_visual_desktop"
mkdir -p "$out_dir"
compile_out="$out_dir/claude_visual"
batch_single_run="${R2C_BATCH_SINGLE_RUN:-0}"
rebuild_desktop="${R2C_REBUILD_DESKTOP:-1}"

export R2C_PROFILE="claude"
export R2C_REUSE_RUNTIME_BINS="${R2C_REUSE_RUNTIME_BINS:-0}"
export BACKEND_JOBS="${BACKEND_JOBS:-16}"
export BACKEND_WHOLE_PROGRAM="${BACKEND_WHOLE_PROGRAM:-0}"
export R2C_DESKTOP_FRONTEND="${R2C_DESKTOP_FRONTEND:-stage1}"
export STRICT_GATE_CONTEXT=1
if [ "$rebuild_desktop" = "1" ]; then
  rm -f "$compile_out/r2c_app_macos" "$compile_out/r2capp_platform_artifacts/macos/r2c_app_macos" "$compile_out/r2capp_platform_artifacts/macos/r2c_app_macos.o"
fi
bash "$ROOT/scripts/r2c_compile_react_project.sh" --project "$fixture_root" --entry "/app/main.tsx" --out "$compile_out" --strict

report_json="$compile_out/r2capp/r2capp_compile_report.json"
python3 - "$report_json" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)

mode = data.get("generated_ui_mode", "")
states = data.get("visual_states", [])
if mode != "ir-driven":
    print(f"[verify-claude-visual] generated_ui_mode != ir-driven: {mode}", file=sys.stderr)
    sys.exit(1)
legacy_required = {"lang_select", "home", "messages", "publish", "nodes", "profile", "trading"}
fullroute_required = {"lang_select", "home_default", "tab_messages", "publish_selector", "tab_nodes", "tab_profile", "trading_main"}
state_set = set(states)
if not (legacy_required.issubset(state_set) or fullroute_required.issubset(state_set)):
    print(f"[verify-claude-visual] visual_states missing required subset: {states}", file=sys.stderr)
    sys.exit(1)
PY

app_bin="$compile_out/r2c_app_macos"
if [ ! -x "$app_bin" ]; then
  echo "[verify-claude-visual] missing desktop app binary: $app_bin" >&2
  exit 1
fi

run_state() {
  local state="$1"
  local snapshot_out="$out_dir/${state}.snapshot.txt"
  local state_out="$out_dir/${state}.state.txt"
  local drawlist_out="$out_dir/${state}.drawlist.txt"
  local framehash_out="$out_dir/${state}.framehash.txt"

  if [ ! -f "$snapshot_out" ] || [ ! -f "$state_out" ] || [ ! -f "$drawlist_out" ] || [ ! -f "$framehash_out" ]; then
    echo "[verify-claude-visual] missing output for state=$state" >&2
    exit 1
  fi
  if ! grep -q "mounted=true" "$state_out"; then
    echo "[verify-claude-visual] missing mounted flag for state=$state" >&2
    exit 1
  fi
  if ! grep -q "profile=claude" "$state_out"; then
    echo "[verify-claude-visual] unexpected compile profile for state=$state" >&2
    exit 1
  fi
  local expected_hash
  expected_hash="$(tr -d '\r\n ' < "$golden_visual_dir/$state.framehash")"
  local actual_hash
  actual_hash="$(tr -d '\r\n ' < "$framehash_out")"
  if [ "$expected_hash" != "$actual_hash" ]; then
    echo "[verify-claude-visual] frame hash mismatch for state=$state" >&2
    echo "[verify-claude-visual] expected: $expected_hash" >&2
    echo "[verify-claude-visual] actual:   $actual_hash" >&2
    exit 1
  fi
}

run_state_legacy() {
  local state="$1"
  local event_file="$2"
  local snapshot_out="$out_dir/${state}.snapshot.txt"
  local state_out="$out_dir/${state}.state.txt"
  local drawlist_out="$out_dir/${state}.drawlist.txt"
  local framehash_out="$out_dir/${state}.framehash.txt"

  GUI_FORCE_FALLBACK="${GUI_FORCE_FALLBACK:-1}" \
  R2C_APP_URL="about:blank" \
  R2C_APP_EVENT_SCRIPT="$event_file" \
  R2C_APP_SNAPSHOT_OUT="$snapshot_out" \
  R2C_APP_STATE_OUT="$state_out" \
  R2C_APP_DRAWLIST_OUT="$drawlist_out" \
  R2C_APP_FRAME_HASH_OUT="$framehash_out" \
  R2C_DESKTOP_AUTOCLOSE_MS="140" \
    "$app_bin" >/dev/null 2>&1

  run_state "$state"
}

events_lang="$out_dir/events_lang_select.txt"
: > "$events_lang"

events_home="$out_dir/events_home.txt"
cat > "$events_home" <<'EOF'
click|#lang-en|
click|#confirm|
click|#tab-home|
EOF

events_messages="$out_dir/events_messages.txt"
cat > "$events_messages" <<'EOF'
click|#lang-en|
click|#confirm|
click|#tab-messages|
EOF

events_publish="$out_dir/events_publish.txt"
cat > "$events_publish" <<'EOF'
click|#lang-en|
click|#confirm|
click|#tab-home|
click|#tab-publish|
click|#file-select|
EOF

events_nodes="$out_dir/events_nodes.txt"
cat > "$events_nodes" <<'EOF'
click|#lang-en|
click|#confirm|
click|#tab-nodes|
drag-end|#nodes|from=0;to=2
EOF

events_profile="$out_dir/events_profile.txt"
cat > "$events_profile" <<'EOF'
click|#lang-en|
click|#confirm|
click|#tab-profile|
click|#clipboard-copy|
click|#geo-request|
click|#cookie-set|
EOF

events_trading="$out_dir/events_trading.txt"
cat > "$events_trading" <<'EOF'
click|#lang-en|
click|#confirm|
click|#tab-home|
click|#timer-start|
tick||ms=500
tick||ms=500
resize||w=900;h=600
click|#tab-publish|
click|#file-select|
click|#tab-trading|
pointer-move|#chart|x=160;y=96
EOF

if [ "$batch_single_run" = "1" ]; then
  batch_matrix="$out_dir/visual_event_matrix.txt"
  cat > "$batch_matrix" <<EOF
@state lang_select
$(cat "$events_lang")

@state home
$(cat "$events_home")

@state messages
$(cat "$events_messages")

@state publish
$(cat "$events_publish")

@state nodes
$(cat "$events_nodes")

@state profile
$(cat "$events_profile")

@state trading
$(cat "$events_trading")
EOF

  GUI_FORCE_FALLBACK="${GUI_FORCE_FALLBACK:-1}" \
  GUI_USE_REAL_MAC="${GUI_USE_REAL_MAC:-0}" \
  R2C_APP_URL="about:blank" \
  R2C_APP_EVENT_MATRIX="$batch_matrix" \
  R2C_APP_BATCH_OUT_DIR="$out_dir" \
  R2C_DESKTOP_AUTOCLOSE_MS="1" \
    "$app_bin" >/dev/null 2>&1

  run_state "lang_select"
  run_state "home"
  run_state "messages"
  run_state "publish"
  run_state "nodes"
  run_state "profile"
  run_state "trading"
else
  run_state_legacy "lang_select" "$events_lang"
  run_state_legacy "home" "$events_home"
  run_state_legacy "messages" "$events_messages"
  run_state_legacy "publish" "$events_publish"
  run_state_legacy "nodes" "$events_nodes"
  run_state_legacy "profile" "$events_profile"
  run_state_legacy "trading" "$events_trading"
fi

if [ "${R2C_SINGLE_POPUP_VERIFY:-0}" = "1" ]; then
  GUI_FORCE_FALLBACK=0 \
  R2C_APP_URL="about:blank" \
  R2C_APP_EVENT_SCRIPT="$events_trading" \
  R2C_DESKTOP_AUTOCLOSE_MS="${R2C_SINGLE_POPUP_AUTOCLOSE_MS:-1200}" \
    "$app_bin" >/dev/null 2>&1 || true
fi

if ! grep -Fq "TAB:messages" "$out_dir/messages.snapshot.txt"; then
  echo "[verify-claude-visual] messages snapshot missing TAB:messages" >&2
  exit 1
fi
if ! grep -Fq "TAB:nodes" "$out_dir/nodes.snapshot.txt"; then
  echo "[verify-claude-visual] nodes snapshot missing TAB:nodes" >&2
  exit 1
fi
if ! grep -Fq "DRAG_ORDER:B,C,A" "$out_dir/nodes.snapshot.txt"; then
  echo "[verify-claude-visual] nodes snapshot missing drag reorder" >&2
  exit 1
fi
if ! grep -Fq "TAB:profile" "$out_dir/profile.snapshot.txt"; then
  echo "[verify-claude-visual] profile snapshot missing TAB:profile" >&2
  exit 1
fi
if [ "${R2C_STRICT_PROFILE_MARKERS:-0}" = "1" ]; then
  if ! grep -Fq "CLIPBOARD:CLIPBOARD_OK" "$out_dir/profile.snapshot.txt"; then
    echo "[verify-claude-visual] profile snapshot missing clipboard marker" >&2
    exit 1
  fi
  if ! grep -Fq "GEO:37.7749" "$out_dir/profile.snapshot.txt"; then
    echo "[verify-claude-visual] profile snapshot missing geolocation marker" >&2
    exit 1
  fi
  if ! grep -Fq "COOKIE:a=1" "$out_dir/profile.snapshot.txt"; then
    echo "[verify-claude-visual] profile snapshot missing cookie marker" >&2
    exit 1
  fi
fi

token_file="$fixture_root/golden/desktop_snapshot_tokens.txt"
trading_snapshot="$out_dir/trading.snapshot.txt"
if [ ! -f "$token_file" ]; then
  echo "[verify-claude-visual] missing token golden: $token_file" >&2
  exit 1
fi
while IFS= read -r token; do
  [ -z "$token" ] && continue
  if ! grep -Fq "$token" "$trading_snapshot"; then
    echo "[verify-claude-visual] missing trading snapshot token: $token" >&2
    exit 1
  fi
done < "$token_file"

drawlist_hash="$(shasum -a 256 "$out_dir/trading.drawlist.txt" | awk '{print $1}')"
echo "$drawlist_hash" > "$out_dir/trading.drawlist.hash.txt"
echo "[verify-claude-visual] diag drawlist-hash=$drawlist_hash"
echo "[verify-claude-visual] ok: $app_bin"
