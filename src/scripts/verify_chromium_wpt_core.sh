#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
export GUI_ROOT="$ROOT"
unset BACKEND_WHOLE_PROGRAM

manifest_json="$REPO_ROOT/tests/wpt/core_manifest_runtime.json"
fixture_root="$ROOT/tests/wpt/core"
out_dir="$ROOT/build/chromium_wpt"
report_txt="$out_dir/wpt_core_report.txt"
report_json="$out_dir/wpt_core_runtime_report.json"
cases_tsv="$out_dir/wpt_core_cases.tsv"
results_tsv="$out_dir/wpt_core_results.tsv"
min_runtime_cases=80
min_pass_rate=90.0

if [ ! -f "$manifest_json" ]; then
  echo "[verify-chromium-wpt-core] missing runtime manifest: $manifest_json" >&2
  exit 1
fi
if [ ! -f "$fixture_root/wpt_core_fixture.html" ]; then
  echo "[verify-chromium-wpt-core] missing fixture file: $fixture_root/wpt_core_fixture.html" >&2
  exit 1
fi

for bin in python3 openssl curl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[verify-chromium-wpt-core] missing dependency: $bin" >&2
    exit 2
  fi
done

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
  echo "[verify-chromium-wpt-core] missing ROOT" >&2
  exit 2
fi

compat_root="$ROOT/chengcache/stage0_compat"
if [ -d "$compat_root/src/std" ] && [ -d "$compat_root/src/tooling" ] && [ -x "$compat_root/src/tooling/chengc.sh" ]; then
  ROOT="$compat_root"
fi

CHENGC="${CHENGC:-$ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-chromium-wpt-core] missing chengc: $CHENGC" >&2
  exit 2
fi

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
  pkg_roots="$ROOT"
else
  case ",$pkg_roots," in
    *,"$ROOT",*) ;;
    *) pkg_roots="$pkg_roots,$ROOT" ;;
  esac
fi
export PKG_ROOTS="$pkg_roots"

if [ -z "${BACKEND_DRIVER:-}" ]; then
  selected_driver=""
  if [ -x "$ROOT/cheng_stable" ]; then
    selected_driver="$ROOT/cheng_stable"
  elif [ -x "$ROOT/cheng" ]; then
    selected_driver="$ROOT/cheng"
  fi
  if [ -z "$selected_driver" ] && [ -d "$ROOT/dist/releases" ]; then
    while IFS= read -r candidate; do
      if [ -x "$candidate/cheng" ]; then
        selected_driver="$candidate/cheng"
        break
      fi
    done < <(ls -1dt "$ROOT"/dist/releases/* 2>/dev/null || true)
  fi
  for cand in "$ROOT"/driver_*; do
    if [ -n "$selected_driver" ]; then
      break
    fi
    if [ -f "$cand" ] && [ -x "$cand" ]; then
      selected_driver="$cand"
      break
    fi
  done
  if [ -z "$selected_driver" ] && [ -x "$ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2" ]; then
    selected_driver="$ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2"
  fi
  if [ -z "$selected_driver" ]; then
    echo "[verify-chromium-wpt-core] missing backend driver under ROOT=$ROOT" >&2
    exit 2
  fi
  export BACKEND_DRIVER="$selected_driver"
fi

export BACKEND_DRIVER_DIRECT="${BACKEND_DRIVER_DIRECT:-0}"
target="${KIT_TARGET:-}"
if [ -z "$target" ]; then
  target="$(sh "$ROOT/src/tooling/detect_host_target.sh")"
fi
if [ -z "$target" ]; then
  echo "[verify-chromium-wpt-core] failed to detect host target" >&2
  exit 2
fi

if [ "$(uname -s)" != "Darwin" ]; then
  echo "[verify-chromium-wpt-core] blocking platform is macOS; current=$(uname -s)" >&2
  exit 1
fi
if [ "${CHROMIUM_RUNTIME_EXEC:-1}" != "1" ]; then
  echo "[verify-chromium-wpt-core] strict mode requires CHROMIUM_RUNTIME_EXEC=1 on Darwin" >&2
  exit 1
fi

mkdir -p "$out_dir"
main_src="$ROOT/chromium_wpt_core_runtime_main.cheng"
obj="$ROOT/chengcache/chromium_wpt_core_runtime.runtime.o"
bin="$out_dir/chromium_wpt_core_runtime_macos"
compile_log="$out_dir/chromium_wpt_core_runtime.compile.log"
run_prefix="$out_dir/chromium_wpt_case"

rm -f "$cases_tsv" "$results_tsv"

python3 - "$manifest_json" "$cases_tsv" "$min_runtime_cases" <<'PY'
import json
import sys

manifest_path, out_path, min_cases_raw = sys.argv[1:4]
min_cases = int(min_cases_raw)
doc = json.load(open(manifest_path, "r", encoding="utf-8"))
cases = doc.get("cases", [])
if not isinstance(cases, list) or len(cases) < min_cases:
    raise SystemExit(f"[verify-chromium-wpt-core] runtime manifest must contain at least {min_cases} cases")

with open(out_path, "w", encoding="utf-8") as out:
    for item in cases:
        if not isinstance(item, dict):
            raise SystemExit("[verify-chromium-wpt-core] invalid case record")
        cid = str(item.get("id", "")).strip()
        path = str(item.get("path", "")).strip()
        expect = item.get("expect_tokens", [])
        forbid = item.get("forbid_tokens", [])
        timeout_ms = int(item.get("timeout_ms", 8000))
        category = str(item.get("category", "")).strip()
        if not cid or not path.startswith("/"):
            raise SystemExit(f"[verify-chromium-wpt-core] invalid case id/path: {cid} {path}")
        if not isinstance(expect, list) or len(expect) == 0:
            raise SystemExit(f"[verify-chromium-wpt-core] expect_tokens missing for {cid}")
        if not isinstance(forbid, list):
            raise SystemExit(f"[verify-chromium-wpt-core] forbid_tokens invalid for {cid}")
        expect_join = "||".join(str(v) for v in expect)
        forbid_join = "||".join(str(v) for v in forbid)
        out.write(f"{cid}\t{path}\t{expect_join}\t{forbid_join}\t{timeout_ms}\t{category}\n")
PY

rm -f "$obj" "$bin"
if ! (
  cd "$ROOT"
  DEFINES="${DEFINES:-macos,macosx}" sh "$CHENGC" "$main_src" --emit-obj --obj-out:"$obj" --target:"$target"
) >"$compile_log" 2>&1; then
  echo "[verify-chromium-wpt-core] compile failed" >&2
  sed -n '1,120p' "$compile_log" >&2
  exit 1
fi
if [ ! -s "$obj" ]; then
  echo "[verify-chromium-wpt-core] compile failed: missing obj $obj" >&2
  exit 1
fi

cc="${CC:-clang}"
obj_sys="$ROOT/chengcache/chromium_wpt_core_runtime.system_helpers.runtime.o"
obj_compat="$ROOT/chengcache/chromium_wpt_core_runtime.compat_shim.runtime.o"
compat_shim_src="$ROOT/runtime/cheng_compat_shim.c"
"$cc" -I"$ROOT/runtime/include" -I"$ROOT/src/runtime/native" \
  -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
  -c "$ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
if [ -f "$compat_shim_src" ]; then
  "$cc" -c "$compat_shim_src" -o "$obj_compat"
  "$cc" "$obj" "$obj_sys" "$obj_compat" -o "$bin"
else
  "$cc" "$obj" "$obj_sys" -o "$bin"
fi

tmp_dir="$(mktemp -d "$out_dir/wpt_fixture.XXXXXX")"
http_port_file="$tmp_dir/http_port"
https_port_file="$tmp_dir/https_port"
http_log="$tmp_dir/http_server.log"
https_log="$tmp_dir/https_server.log"
cert_pem="$tmp_dir/cert.pem"
key_pem="$tmp_dir/key.pem"

cleanup() {
  if [ -n "${https_pid:-}" ]; then
    kill "$https_pid" >/dev/null 2>&1 || true
    wait "$https_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "${http_pid:-}" ]; then
    kill "$http_pid" >/dev/null 2>&1 || true
    wait "$http_pid" >/dev/null 2>&1 || true
  fi
  if [ -d "${tmp_dir:-}" ]; then
    rm -rf "$tmp_dir" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$key_pem" -out "$cert_pem" -days 1 \
  -subj "/CN=127.0.0.1" >/dev/null 2>&1

python3 - "$fixture_root" "$http_port_file" >"$http_log" 2>&1 <<'PY' &
import sys, os, http.server, socketserver

root = sys.argv[1]
port_file = sys.argv[2]
os.chdir(root)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

httpd = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
with open(port_file, "w", encoding="utf-8") as fh:
    fh.write(str(httpd.server_address[1]))
httpd.serve_forever()
PY
http_pid=$!

python3 - "$fixture_root" "$https_port_file" "$cert_pem" "$key_pem" >"$https_log" 2>&1 <<'PY' &
import sys, os, http.server, socketserver, ssl

root = sys.argv[1]
port_file = sys.argv[2]
cert_pem = sys.argv[3]
key_pem = sys.argv[4]
os.chdir(root)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

httpd = socketserver.TCPServer(("127.0.0.1", 0), Quiet)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(certfile=cert_pem, keyfile=key_pem)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
with open(port_file, "w", encoding="utf-8") as fh:
    fh.write(str(httpd.server_address[1]))
httpd.serve_forever()
PY
https_pid=$!

for _ in $(seq 1 80); do
  if [ -s "$http_port_file" ] && [ -s "$https_port_file" ]; then
    break
  fi
  sleep 0.05
done
if [ ! -s "$http_port_file" ] || [ ! -s "$https_port_file" ]; then
  echo "[verify-chromium-wpt-core] fixture server failed to start" >&2
  sed -n '1,120p' "$http_log" >&2 || true
  sed -n '1,120p' "$https_log" >&2 || true
  exit 1
fi

http_port="$(cat "$http_port_file")"
https_port="$(cat "$https_port_file")"
http_base="http://127.0.0.1:${http_port}"
https_base="https://127.0.0.1:${https_port}"

idx=0
while IFS=$'\t' read -r case_id case_path expect_tokens forbid_tokens timeout_ms category; do
  if [ -z "$case_id" ]; then
    continue
  fi
  idx=$((idx + 1))
  if [ $((idx % 2)) -eq 0 ]; then
    case_url="${https_base}${case_path}"
  else
    case_url="${http_base}${case_path}"
  fi
  case_log="${run_prefix}_${case_id}.run.log"
  case_snapshot="$tmp_dir/${case_id}.snapshot.txt"
  case_check_log="$tmp_dir/${case_id}.check.log"
  rm -f "$case_snapshot" "$case_check_log"
  start_ms="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  set +e
  GUI_TEST_INSECURE_TLS=1 \
  WPT_CASE_ID="$case_id" \
  WPT_CASE_URL="$case_url" \
  WPT_SNAPSHOT_OUT="$case_snapshot" \
  "$bin" >"$case_log" 2>&1
  rc=$?
  set -e
  end_ms="$(python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
)"
  duration_ms=$((end_ms - start_ms))
  if [ "$duration_ms" -lt 0 ]; then
    duration_ms=0
  fi
  if [ "$rc" -eq 0 ]; then
    set +e
    python3 - "$case_snapshot" "$expect_tokens" "$forbid_tokens" >"$case_check_log" 2>&1 <<'PY'
import os
import sys

snapshot_path, expect_raw, forbid_raw = sys.argv[1:4]
if not os.path.isfile(snapshot_path):
    raise SystemExit("snapshot-missing")
text = open(snapshot_path, "r", encoding="utf-8", errors="replace").read()
expect_tokens = [t for t in expect_raw.split("||") if t]
forbid_tokens = [t for t in forbid_raw.split("||") if t]
missing = [t for t in expect_tokens if t not in text]
forbidden = [t for t in forbid_tokens if t in text]
if missing:
    raise SystemExit("missing-token:" + ",".join(missing))
if forbidden:
    raise SystemExit("forbidden-token:" + ",".join(forbidden))
PY
    check_rc=$?
    set -e
    if [ "$check_rc" -eq 0 ]; then
      printf '%s\tpass\t%s\t\t%s\t%s\n' "$case_id" "$duration_ms" "$case_path" "$category" >>"$results_tsv"
    else
      err="$(sed -n '1,1p' "$case_check_log" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g; s/^\s*//; s/\s*$//')"
      if [ -z "$err" ]; then
        err="token-check-failed"
      fi
      printf '%s\tfail\t%s\t%s\t%s\t%s\n' "$case_id" "$duration_ms" "$err" "$case_path" "$category" >>"$results_tsv"
    fi
  else
    err="$(sed -n '1,2p' "$case_log" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g; s/^\s*//; s/\s*$//')"
    if [ -z "$err" ]; then
      err="rc=$rc"
    else
      err="rc=$rc $err"
    fi
    printf '%s\tfail\t%s\t%s\t%s\t%s\n' "$case_id" "$duration_ms" "$err" "$case_path" "$category" >>"$results_tsv"
  fi
done <"$cases_tsv"

python3 - "$manifest_json" "$results_tsv" "$report_json" "$report_txt" "$min_runtime_cases" "$min_pass_rate" <<'PY'
import json
import sys

manifest_path, results_path, report_json_path, report_txt_path, min_cases_raw, min_pass_rate_raw = sys.argv[1:7]
min_cases = int(min_cases_raw)
min_pass_rate = float(min_pass_rate_raw)
manifest = json.load(open(manifest_path, "r", encoding="utf-8"))
cases = manifest.get("cases", [])
if not isinstance(cases, list):
    raise SystemExit("[verify-chromium-wpt-core] invalid manifest cases")

result_map = {}
with open(results_path, "r", encoding="utf-8") as fh:
    for raw in fh:
        line = raw.rstrip("\n")
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 6:
            continue
        cid, status, duration_ms, error, path, category = parts[:6]
        result_map[cid] = {
            "status": status,
            "duration_ms": int(duration_ms) if duration_ms.isdigit() else 0,
            "error": error,
            "path": path,
            "category": category,
        }

report_cases = []
passed = 0
failed = 0
for item in cases:
    cid = str(item.get("id", "")).strip()
    rec = result_map.get(cid)
    if rec is None:
        rec = {
            "status": "fail",
            "duration_ms": 0,
            "error": "missing-run-result",
            "path": str(item.get("path", "")),
            "category": str(item.get("category", "")),
        }
    if rec["status"] == "pass":
        passed += 1
    else:
        failed += 1
    report_cases.append({
        "id": cid,
        "status": rec["status"],
        "duration_ms": int(rec.get("duration_ms", 0)),
        "error": str(rec.get("error", "")),
        "path": str(rec.get("path", "")),
        "category": str(rec.get("category", "")),
    })

total = len(report_cases)
if total <= 0:
    raise SystemExit("[verify-chromium-wpt-core] no runtime cases executed")
pass_rate = (float(passed) * 100.0) / float(total)

report = {
    "format": "wpt-core-runtime-report-v1",
    "manifest_path": manifest_path,
    "total": total,
    "pass": passed,
    "fail": failed,
    "pass_rate": pass_rate,
    "cases": report_cases,
}
with open(report_json_path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)
    fh.write("\n")

with open(report_txt_path, "w", encoding="utf-8") as fh:
    fh.write(f"manifest={manifest_path}\n")
    fh.write(f"runtime_manifest={manifest_path}\n")
    fh.write(f"total={total}\n")
    fh.write(f"pass={passed}\n")
    fh.write(f"fail={failed}\n")
    fh.write(f"pass_rate={pass_rate:.2f}%\n")
    fh.write(f"runtime_report={report_json_path}\n")

if total < min_cases:
    raise SystemExit(f"[verify-chromium-wpt-core] runtime total below gate: total={total} min={min_cases}")
if pass_rate < min_pass_rate:
    raise SystemExit(f"[verify-chromium-wpt-core] pass rate below gate: {pass_rate:.2f}% < {min_pass_rate:.2f}%")
PY

echo "[verify-chromium-wpt-core] ok: pass_rate=$(awk -F= '/^pass_rate=/{print $2}' "$report_txt") report=$report_txt"
