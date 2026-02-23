#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"
unset BACKEND_WHOLE_PROGRAM
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
  echo "[verify-chromium-network-features] missing ROOT" >&2
  exit 2
fi

# Toolchain compat: prefer stage0 compat overlay when available.
compat_root="$ROOT/chengcache/stage0_compat"
if [ -d "$compat_root/src/std" ] && [ -d "$compat_root/src/tooling" ] && [ -x "$compat_root/src/tooling/chengc.sh" ]; then
  ROOT="$compat_root"
fi

CHENGC="${CHENGC:-$ROOT/src/tooling/chengc.sh}"
if [ ! -x "$CHENGC" ]; then
  echo "[verify-chromium-network-features] missing chengc: $CHENGC" >&2
  exit 2
fi

main_src="$ROOT/chromium_network_features_smoke_main.cheng"
if [ ! -f "$main_src" ]; then
  echo "[verify-chromium-network-features] missing source: $main_src" >&2
  exit 1
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
    echo "[verify-chromium-network-features] missing backend driver under ROOT=$ROOT" >&2
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
  echo "[verify-chromium-network-features] failed to detect host target" >&2
  exit 2
fi

out_dir="$ROOT/build/chromium_network_features"
mkdir -p "$out_dir"
obj="$ROOT/chengcache/chromium_network_features_smoke.runtime.o"
compile_log="$out_dir/chromium_network_features_smoke.compile.log"
reuse_obj="${CHROMIUM_NETWORK_REUSE_OBJ:-0}"
if [ "$reuse_obj" != "1" ] || [ ! -s "$obj" ]; then
  rm -f "$obj"
  if ! (
    cd "$ROOT"
    DEFINES="${DEFINES:-macos,macosx}" sh "$CHENGC" "$main_src" --emit-obj --obj-out:"$obj" --target:"$target"
  ) >"$compile_log" 2>&1; then
    echo "[verify-chromium-network-features] compile failed" >&2
    sed -n '1,120p' "$compile_log" >&2
    exit 1
  fi
fi

if [ ! -s "$obj" ]; then
  echo "[verify-chromium-network-features] compile failed: missing obj" >&2
  sed -n '1,120p' "$compile_log" >&2
  exit 1
fi

host="$(uname -s)"
runtime_exec="${CHROMIUM_RUNTIME_EXEC:-1}"
if [ "$host" = "Darwin" ]; then
  if [ "$runtime_exec" != "1" ]; then
    echo "[verify-chromium-network-features] strict mode requires CHROMIUM_RUNTIME_EXEC=1 on Darwin" >&2
    exit 1
  fi
  # Runtime smoke requires local fixture servers (HTTP + HTTPS) for stable CI.
  if ! command -v python3 >/dev/null 2>&1; then
    echo "[verify-chromium-network-features] missing dependency: python3" >&2
    exit 2
  fi
  if ! command -v openssl >/dev/null 2>&1; then
    echo "[verify-chromium-network-features] missing dependency: openssl" >&2
    exit 2
  fi
  if ! command -v curl >/dev/null 2>&1; then
    echo "[verify-chromium-network-features] missing dependency: curl" >&2
    exit 2
  fi

  fixture_root="$ROOT/tests/web_fixture"
  if [ ! -f "$fixture_root/index.html" ]; then
    echo "[verify-chromium-network-features] missing fixture: $fixture_root/index.html" >&2
    exit 1
  fi

  cc="${CC:-clang}"
  obj_sys="$ROOT/chengcache/chromium_network_features_smoke.system_helpers.runtime.o"
  obj_compat="$ROOT/chengcache/chromium_network_features_smoke.compat_shim.runtime.o"
  compat_shim_src="$ROOT/runtime/cheng_compat_shim.c"
  bin="$out_dir/chromium_network_features_smoke_macos"
  run_log="$out_dir/chromium_network_features_smoke_macos.run.log"
  reuse_bin="${CHROMIUM_NETWORK_REUSE_BIN:-0}"

  if [ "$reuse_bin" != "1" ] || [ ! -x "$bin" ]; then
    "$cc" -I"$ROOT/runtime/include" -I"$ROOT/src/runtime/native" \
      -Dalloc=cheng_runtime_alloc -DcopyMem=cheng_runtime_copyMem -DsetMem=cheng_runtime_setMem \
      -c "$ROOT/src/runtime/native/system_helpers.c" -o "$obj_sys"
    if [ -f "$compat_shim_src" ]; then
      "$cc" -c "$compat_shim_src" -o "$obj_compat"
      "$cc" "$obj" "$obj_sys" "$obj_compat" -o "$bin"
    else
      "$cc" "$obj" "$obj_sys" -o "$bin"
    fi
  fi

  tmp_dir="$(mktemp -d "$out_dir/net_fixture.XXXXXX")"
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
    echo "[verify-chromium-network-features] fixture server failed to start" >&2
    sed -n '1,120p' "$http_log" >&2 || true
    sed -n '1,120p' "$https_log" >&2 || true
    exit 1
  fi

  http_port="$(cat "$http_port_file")"
  https_port="$(cat "$https_port_file")"
  export NET_HTTP_URL="http://127.0.0.1:${http_port}/index.html"
  export NET_HTTPS_URL="https://127.0.0.1:${https_port}/index.html"
  export GUI_TEST_INSECURE_TLS=1

  {
    echo "runtime_exec=1"
    echo "host=$host"
    echo "binary=$bin"
    echo "http_url=$NET_HTTP_URL"
    echo "https_url=$NET_HTTPS_URL"
    echo "start_epoch=$(date +%s)"
  } >"$run_log"
  set +e
  "$bin" >>"$run_log" 2>&1
  run_rc=$?
  set -e
  {
    echo "run_rc=$run_rc"
    echo "end_epoch=$(date +%s)"
  } >>"$run_log"
  if [ "$run_rc" -ne 0 ]; then
    echo "[verify-chromium-network-features] runtime failed rc=$run_rc" >&2
    sed -n '1,120p' "$run_log" >&2
    exit 1
  fi
  if [ ! -s "$run_log" ]; then
    echo "[verify-chromium-network-features] runtime log missing: $run_log" >&2
    exit 1
  fi
  if rg -n "runtime skipped|compile-only" "$run_log" >/dev/null 2>&1; then
    echo "[verify-chromium-network-features] invalid runtime marker in log: $run_log" >&2
    exit 1
  fi
  echo "[verify-chromium-network-features] ok: $bin"
else
  echo "[verify-chromium-network-features] runtime execution required on blocking gate host; got host=$host" >&2
  exit 1
fi
