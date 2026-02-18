#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export CHENG_GUI_ROOT="$ROOT"

out_dir="$ROOT/build/r2c_real_project_closed_loop/ClaudeDesign"
report_json="$out_dir/r2capp/r2capp_compile_report.json"
app_bin="$out_dir/r2c_app_macos"
manifest_path="$out_dir/r2capp/r2capp_manifest.json"

if [ ! -f "$report_json" ]; then
  echo "[verify-claude-utfzh-ime-strict] missing compile report: $report_json" >&2
  exit 1
fi
if [ ! -x "$app_bin" ]; then
  echo "[verify-claude-utfzh-ime-strict] missing app binary: $app_bin" >&2
  exit 1
fi
if [ ! -f "$manifest_path" ]; then
  echo "[verify-claude-utfzh-ime-strict] missing manifest: $manifest_path" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[verify-claude-utfzh-ime-strict] missing dependency: python3" >&2
  exit 2
fi
if ! command -v perl >/dev/null 2>&1; then
  echo "[verify-claude-utfzh-ime-strict] missing dependency: perl" >&2
  exit 2
fi

run_with_timeout() {
  local timeout_sec="$1"
  shift
  perl -e '
    use POSIX qw(setsid WNOHANG);
    my $timeout = shift @ARGV;
    my $pid = fork();
    if (!defined $pid) {
      exit 127;
    }
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
        if (($status & 127) != 0) {
          exit(128 + ($status & 127));
        }
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
  ' "$timeout_sec" "$@"
}

python3 - "$report_json" <<'PY'
import json
import sys

report = json.load(open(sys.argv[1], "r", encoding="utf-8"))
required = {
    "utfzh_mode": "strict",
    "ime_mode": "cangwu-global",
    "cjk_render_backend": "native-text-first",
    "cjk_render_gate": "no-garbled-cjk",
}
for k, v in required.items():
    got = str(report.get(k, "") or "")
    if got != v:
        raise SystemExit(f"[verify-claude-utfzh-ime-strict] report field mismatch: {k}={got!r}, expected={v!r}")
if int(report.get("pixel_tolerance", -1)) != 0:
    raise SystemExit("[verify-claude-utfzh-ime-strict] pixel_tolerance != 0")
if bool(report.get("used_fallback", True)):
    raise SystemExit("[verify-claude-utfzh-ime-strict] used_fallback != false")
if int(report.get("compiler_rc", -1)) != 0:
    raise SystemExit("[verify-claude-utfzh-ime-strict] compiler_rc != 0")
PY

smoke_dir="$ROOT/build/claude_utfzh_ime_strict"
mkdir -p "$smoke_dir"
event_script="$smoke_dir/ime.events.txt"
snapshot_out="$smoke_dir/ime.snapshot.txt"
drawlist_out="$smoke_dir/ime.drawlist.txt"
state_out="$smoke_dir/ime.state.txt"
run_log="$smoke_dir/ime.run.log"

cat >"$event_script" <<'EOF'
click|#lang-zh-CN|
click|#confirm|
text-input|#root|text_cp=20013,25991
ime-end|#root|text_cp=20013,25991
EOF

if ! run_with_timeout 180 \
  env \
    CHENG_R2C_APP_URL=about:blank \
    CHENG_R2CAPP_MANIFEST="$manifest_path" \
    CHENG_R2C_APP_EVENT_SCRIPT="$event_script" \
    CHENG_R2C_APP_SNAPSHOT_OUT="$snapshot_out" \
    CHENG_R2C_APP_DRAWLIST_OUT="$drawlist_out" \
    CHENG_R2C_APP_STATE_OUT="$state_out" \
    CHENG_R2C_STRICT_RUNTIME=1 \
    CHENG_R2C_DESKTOP_AUTOCLOSE_MS=260 \
    "$app_bin" >"$run_log" 2>&1; then
  echo "[verify-claude-utfzh-ime-strict] desktop timeout/failure: $app_bin" >&2
  if [ -f "$run_log" ]; then
    sed -n '1,120p' "$run_log" >&2
  fi
  exit 1
fi

if [ ! -f "$snapshot_out" ] || [ ! -f "$drawlist_out" ] || [ ! -f "$state_out" ]; then
  echo "[verify-claude-utfzh-ime-strict] missing output artifacts" >&2
  exit 1
fi

python3 - "$snapshot_out" "$drawlist_out" "$state_out" <<'PY'
import re
import sys
from pathlib import Path

snapshot = Path(sys.argv[1]).read_text(encoding="utf-8")
drawlist = Path(sys.argv[2]).read_text(encoding="utf-8")
state = Path(sys.argv[3]).read_text(encoding="utf-8")

if "???" in snapshot or "???" in drawlist:
    raise SystemExit("[verify-claude-utfzh-ime-strict] detected garbled ??? in snapshot/drawlist")
if re.search(r"[\u4e00-\u9fff]\?+", snapshot):
    raise SystemExit("[verify-claude-utfzh-ime-strict] detected CJK->? fallback in snapshot")
if "IME_COMMIT:中文" not in snapshot:
    raise SystemExit("[verify-claude-utfzh-ime-strict] missing IME_COMMIT:中文 in snapshot")
if "UTFZH_STRICT:true" not in snapshot:
    raise SystemExit("[verify-claude-utfzh-ime-strict] UTFZH strict marker missing")
if "UTFZH_ERROR:" in snapshot:
    raise SystemExit("[verify-claude-utfzh-ime-strict] UTFZH_ERROR present in snapshot")
if "IME:中文" not in drawlist:
    raise SystemExit("[verify-claude-utfzh-ime-strict] drawlist missing Chinese IME text")
if "mounted=true" not in state:
    raise SystemExit("[verify-claude-utfzh-ime-strict] state missing mounted=true")
PY

echo "[verify-claude-utfzh-ime-strict] ok"
