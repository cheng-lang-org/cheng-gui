#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export CHENG_GUI_ROOT="$ROOT"

CHENG_ROOT="${CHENG_ROOT:-}"
if [ -z "$CHENG_ROOT" ]; then
  if [ -d "$HOME/.cheng/toolchain/cheng-lang" ]; then
    CHENG_ROOT="$HOME/.cheng/toolchain/cheng-lang"
  elif [ -d "$HOME/cheng-lang" ]; then
    CHENG_ROOT="$HOME/cheng-lang"
  elif [ -d "/Users/lbcheng/cheng-lang" ]; then
    CHENG_ROOT="/Users/lbcheng/cheng-lang"
  fi
fi
if [ -z "$CHENG_ROOT" ]; then
  echo "[verify-unimaker-aot] missing CHENG_ROOT" >&2
  exit 2
fi

# Toolchain compat: prefer stage0 compat overlay when available.
compat_root="$CHENG_ROOT/chengcache/stage0_compat"
if [ -d "$compat_root/src/std" ] && [ -d "$compat_root/src/tooling" ] && [ -x "$compat_root/src/tooling/chengc.sh" ]; then
  CHENG_ROOT="$compat_root"
fi

CHENGC="${CHENGC:-$CHENG_ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-unimaker-aot] missing chengc: $CHENGC" >&2
  exit 2
fi

host="$(uname -s)"
if [ "$host" != "Darwin" ]; then
  echo "[verify-unimaker-aot] skip: host=$host (runtime smoke currently macOS-only)"
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "[verify-unimaker-aot] missing dependency: python3" >&2
  exit 2
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "[verify-unimaker-aot] missing dependency: openssl" >&2
  exit 2
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "[verify-unimaker-aot] missing dependency: curl" >&2
  exit 2
fi

pkg_roots="${CHENG_PKG_ROOTS:-}"
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
export CHENG_PKG_ROOTS="$pkg_roots"

if [ -z "${CHENG_BACKEND_DRIVER:-}" ]; then
  selected_driver=""
  if [ -x "$CHENG_ROOT/cheng_stable" ]; then
    selected_driver="$CHENG_ROOT/cheng_stable"
  elif [ -x "$CHENG_ROOT/cheng" ]; then
    selected_driver="$CHENG_ROOT/cheng"
  fi
  if [ -z "$selected_driver" ] && [ -d "$CHENG_ROOT/dist/releases" ]; then
    while IFS= read -r candidate; do
      if [ -x "$candidate/cheng" ]; then
        selected_driver="$candidate/cheng"
        break
      fi
    done < <(ls -1dt "$CHENG_ROOT"/dist/releases/* 2>/dev/null || true)
  fi
  for cand in "$CHENG_ROOT"/driver_*; do
    if [ -n "$selected_driver" ]; then
      break
    fi
    if [ -f "$cand" ] && [ -x "$cand" ]; then
      selected_driver="$cand"
      break
    fi
  done
  if [ -z "$selected_driver" ] && [ -x "$CHENG_ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2" ]; then
    selected_driver="$CHENG_ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2"
  fi
  if [ -z "$selected_driver" ]; then
    echo "[verify-unimaker-aot] missing backend driver under CHENG_ROOT=$CHENG_ROOT" >&2
    exit 2
  fi
  export CHENG_BACKEND_DRIVER="$selected_driver"
fi
export CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}"

target="${CHENG_KIT_TARGET:-}"
if [ -z "$target" ]; then
  target="$(sh "$CHENG_ROOT/src/tooling/detect_host_target.sh")"
fi
if [ -z "$target" ]; then
  echo "[verify-unimaker-aot] failed to detect host target" >&2
  exit 2
fi

aot_src="$ROOT/r2c_aot_compile_main.cheng"
smoke_src="$ROOT/unimaker_closed_loop_smoke_main.cheng"
if [ ! -f "$aot_src" ] || [ ! -f "$smoke_src" ]; then
  echo "[verify-unimaker-aot] missing sources under $ROOT" >&2
  exit 1
fi

fixture_root="$ROOT/tests/unimaker_fixture"
if [ ! -f "$fixture_root/index.html" ]; then
  echo "[verify-unimaker-aot] missing fixture: $fixture_root/index.html" >&2
  exit 1
fi

out_dir="$ROOT/build/unimaker_aot_closed_loop"
mkdir -p "$out_dir"

tmp_dir="$(mktemp -d "$out_dir/r2capp.XXXXXX")"
out_pkg="$tmp_dir/r2capp"

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

cc="${CC:-clang}"
obj_sys="$CHENG_ROOT/chengcache/unimaker_aot.system_helpers.runtime.o"
obj_compat="$CHENG_ROOT/chengcache/unimaker_aot.compat_shim.runtime.o"
compat_shim_src="$ROOT/runtime/cheng_compat_shim.c"

write_stub_package() {
  local pkg_dir="$1"
  local profile="$2"
  mkdir -p "$pkg_dir/src"
  cat > "$pkg_dir/cheng-package.toml" <<'EOF'
package_id = "pkg://cheng/r2capp"
EOF
  cat > "$pkg_dir/r2capp_manifest.json" <<'EOF'
{
  "format": "r2capp-manifest-v1",
  "entry": "/app/main.tsx",
  "note": "legacy-stub-package"
}
EOF
  cat > "$pkg_dir/src/entry.cheng" <<EOF
import cheng/gui/browser/web
import cheng/r2capp/runtime_generated as generatedRuntime

fn mount(page: web.BrowserPage): bool =
    return generatedRuntime.mountGenerated(page)

fn compileProfile(): str =
    return "$profile"

fn compiledModuleCount(): int32 =
    return int32(1)
EOF
  cat > "$pkg_dir/src/runtime_generated.cheng" <<EOF
import cheng/gui/browser/web
import cheng/gui/browser/r2capp/runtime as legacy

fn profileId(): str =
    return "$profile"

fn mountGenerated(page: web.BrowserPage): bool =
    return legacy.mountUnimakerAot(page)

fn dispatchFromPage(page: web.BrowserPage, eventName, targetSelector, payload: str): bool =
    return legacy.unimakerDispatch(page, eventName, targetSelector, payload)

fn drainEffects(limit: int32): int32 =
    limit
    return int32(0)

fn resolveTargetAt(page: web.BrowserPage, x, y: float): str =
    page
    x
    y
    return ""
EOF
}

compile_and_link() {
  local input="$1"
  local obj="$2"
  local bin="$3"
  local compile_log="$4"

  rm -f "$obj"
  if ! (
    cd "$CHENG_ROOT"
    CHENG_DEFINES="${CHENG_DEFINES:-macos,macosx}" sh "$CHENGC" "$input" --emit-obj --obj-out:"$obj" --target:"$target"
  ) >"$compile_log" 2>&1; then
    echo "[verify-unimaker-aot] compile failed: $input" >&2
    sed -n '1,120p' "$compile_log" >&2
    exit 1
  fi
  if [ ! -s "$obj" ]; then
    echo "[verify-unimaker-aot] compile failed: missing obj: $obj" >&2
    sed -n '1,120p' "$compile_log" >&2
    exit 1
  fi

  "$cc" -I"$CHENG_ROOT/runtime/include" -I"$CHENG_ROOT/src/runtime/native" \
    -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
    -c "$CHENG_ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
  if [ -f "$compat_shim_src" ]; then
    "$cc" -c "$compat_shim_src" -o "$obj_compat"
    "$cc" "$obj" "$obj_sys" "$obj_compat" -o "$bin"
  else
    "$cc" "$obj" "$obj_sys" -o "$bin"
  fi
}

compiler_obj="$CHENG_ROOT/chengcache/unimaker_aot.compiler.runtime.o"
compiler_bin="$out_dir/unimaker_aot_compiler_macos"
compiler_log="$out_dir/unimaker_aot_compiler.compile.log"
compile_and_link "$aot_src" "$compiler_obj" "$compiler_bin" "$compiler_log"

export CHENG_R2C_IN_ROOT="$fixture_root"
export CHENG_R2C_OUT_ROOT="$out_pkg"
export CHENG_R2C_ENTRY="/app/main.tsx"
export CHENG_R2C_PROFILE="unimaker"
export CHENG_R2C_LEGACY_UNIMAKER="${CHENG_R2C_LEGACY_UNIMAKER:-0}"
if [ "${CHENG_R2C_LEGACY_UNIMAKER:-0}" != "0" ]; then
  echo "[verify-unimaker-aot] strict mode: CHENG_R2C_LEGACY_UNIMAKER must be 0" >&2
  exit 2
fi

compiler_run_log="$out_dir/unimaker_aot_compiler.run.log"
set +e
"$compiler_bin" >"$compiler_run_log" 2>&1
compiler_rc=$?
set -e
if [ "$compiler_rc" -ne 0 ]; then
  echo "[verify-unimaker-aot] compiler failed rc=$compiler_rc" >&2
  if [ -f "$out_pkg/r2capp_compiler_error.txt" ]; then
    echo "[verify-unimaker-aot] compiler error:" >&2
    sed -n '1,80p' "$out_pkg/r2capp_compiler_error.txt" >&2
  fi
  sed -n '1,120p' "$compiler_run_log" >&2
  exit 1
fi
if [ ! -f "$out_pkg/cheng-package.toml" ] || [ ! -f "$out_pkg/src/entry.cheng" ]; then
  echo "[verify-unimaker-aot] compiler did not generate r2capp package under: $out_pkg" >&2
  exit 1
fi
if [ ! -f "$out_pkg/r2capp_compile_report.json" ]; then
  echo "[verify-unimaker-aot] missing compile report: $out_pkg/r2capp_compile_report.json" >&2
  exit 1
fi
python3 - "$out_pkg/r2capp_compile_report.json" <<'PY'
import json
import sys

path = sys.argv[1]
data = json.load(open(path, "r", encoding="utf-8"))
if data.get("used_fallback", False):
    print("[verify-unimaker-aot] report used_fallback=true", file=sys.stderr)
    sys.exit(1)
if int(data.get("compiler_rc", 0)) != 0:
    print(f"[verify-unimaker-aot] report compiler_rc != 0: {data.get('compiler_rc')}", file=sys.stderr)
    sys.exit(1)
for key in ("unsupported_syntax", "unsupported_imports", "degraded_features"):
    items = data.get(key, [])
    if isinstance(items, list) and len(items) > 0:
        print(f"[verify-unimaker-aot] {key} != 0: {len(items)}", file=sys.stderr)
        sys.exit(1)
print("[verify-r2c-strict] no-fallback=true")
print("[verify-r2c-strict] compiler-rc=0")
PY

tmp_pkg_roots="$CHENG_PKG_ROOTS"
case ",$tmp_pkg_roots," in
  *,"$tmp_dir",*) ;;
  *) tmp_pkg_roots="$tmp_pkg_roots,$tmp_dir" ;;
esac
export CHENG_PKG_ROOTS="$tmp_pkg_roots"

smoke_obj="$CHENG_ROOT/chengcache/unimaker_aot.smoke.runtime.o"
smoke_bin="$out_dir/unimaker_aot_smoke_macos"
smoke_log="$out_dir/unimaker_aot_smoke.compile.log"
compile_and_link "$smoke_src" "$smoke_obj" "$smoke_bin" "$smoke_log"

http_port_file="$tmp_dir/http_port"
https_port_file="$tmp_dir/https_port"
http_log="$tmp_dir/http_server.log"
https_log="$tmp_dir/https_server.log"
cert_pem="$tmp_dir/cert.pem"
key_pem="$tmp_dir/key.pem"

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
port = httpd.server_address[1]
with open(port_file, "w") as f:
    f.write(str(port))
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
port = httpd.server_address[1]
with open(port_file, "w") as f:
    f.write(str(port))

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(certfile=cert_pem, keyfile=key_pem)
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
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
  echo "[verify-unimaker-aot] fixture server failed to start" >&2
  sed -n '1,120p' "$http_log" >&2 || true
  sed -n '1,120p' "$https_log" >&2 || true
  exit 1
fi

http_port="$(cat "$http_port_file")"
https_port="$(cat "$https_port_file")"
export CHENG_UNIMAKER_HTTP_URL="http://127.0.0.1:${http_port}/index.html"
export CHENG_UNIMAKER_HTTPS_URL="https://127.0.0.1:${https_port}/index.html"
export CHENG_GUI_TEST_INSECURE_TLS=1

run_log="$out_dir/unimaker_aot_smoke_macos.run.log"
set +e
"$smoke_bin" >"$run_log" 2>&1
run_rc=$?
set -e
if [ "$run_rc" -ne 0 ]; then
  echo "[verify-unimaker-aot] runtime failed rc=$run_rc" >&2
  sed -n '1,120p' "$run_log" >&2
  exit 1
fi

echo "[verify-unimaker-aot] ok: $smoke_bin"
