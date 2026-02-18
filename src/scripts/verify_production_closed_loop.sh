#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
# Cheng toolchain resolves `cheng/gui/*` modules via CHENG_GUI_ROOT.
# Force it to the current repo's `src/` root to avoid stale shell env values.
export CHENG_GUI_ROOT="$ROOT"

# Toolchain compat: some environments pin `CHENG_ROOT` to a source checkout whose
# stdlib has moved to newer syntax, while the stage0 driver is older. When the
# stage0 compat overlay exists, prefer it so `verify_*` scripts keep working.
if [ -n "${CHENG_ROOT:-}" ]; then
  compat_root="$CHENG_ROOT/chengcache/stage0_compat"
  if [ -d "$compat_root/src/std" ] && [ -d "$compat_root/src/tooling" ] && [ -x "$compat_root/src/tooling/chengc.sh" ]; then
    export CHENG_ROOT="$compat_root"
  fi
fi

strict_export() {
  local name="$1"
  local required="$2"
  local current="${!name-}"
  if [ -n "$current" ] && [ "$current" != "$required" ]; then
    echo "[verify-production-closed-loop] strict env violation: $name=$current (expected $required)" >&2
    exit 1
  fi
  export "$name=$required"
}

strict_export CHENG_R2C_LEGACY_UNIMAKER 0
strict_export CHENG_R2C_SKIP_COMPILER_RUN 0
strict_export CHENG_R2C_TRY_COMPILER_FIRST 1
strict_export CHENG_R2C_REUSE_RUNTIME_BINS 0
strict_export CHENG_R2C_REUSE_COMPILER_BIN 0
strict_export CHENG_R2C_REBUILD_DESKTOP 1
strict_export CHENG_R2C_USE_PRECOMPUTED_BATCH 0
strict_export CHENG_R2C_BATCH_SINGLE_RUN 1
strict_export CHENG_R2C_FULLROUTE_CONSISTENCY_RUNS 3
strict_export CHENG_R2C_FULLROUTE_BLESS 0
strict_export CHENG_R2C_REAL_SKIP_DESKTOP_SMOKE 1
strict_export CHENG_R2C_TARGET_MATRIX macos
strict_export CHENG_R2C_MAX_SEMANTIC_NODES 1600

strict_export CHENG_R2C_REAL_PROJECT /Users/lbcheng/UniMaker/ClaudeDesign
strict_export CHENG_R2C_REAL_ENTRY /app/main.tsx
strict_export CHENG_R2C_RUNTIME_TEXT_SOURCE project
strict_export CHENG_R2C_RUNTIME_ROUTE_TITLE_SOURCE project
export CHENG_STRICT_GATE_CONTEXT=1

if [ -z "${CHENG_ROOT:-}" ]; then
  if [ -d "$HOME/.cheng/toolchain/cheng-lang" ]; then
    export CHENG_ROOT="$HOME/.cheng/toolchain/cheng-lang"
  elif [ -d "$HOME/cheng-lang" ]; then
    export CHENG_ROOT="$HOME/cheng-lang"
  elif [ -d "/Users/lbcheng/cheng-lang" ]; then
    export CHENG_ROOT="/Users/lbcheng/cheng-lang"
  fi
fi

if [ -n "${CHENG_BACKEND_DRIVER:-}" ] && [ ! -x "${CHENG_BACKEND_DRIVER}" ]; then
  unset CHENG_BACKEND_DRIVER
fi

if [ -n "${CHENG_ROOT:-}" ] && [ -z "${CHENG_BACKEND_DRIVER:-}" ]; then
  :
fi

probe_driver_compile() {
  driver="$1"
  target="$2"
  probe_src="$CHENG_ROOT/chengcache/_cheng_driver_probe_main.cheng"
  probe_obj="$CHENG_ROOT/chengcache/_cheng_driver_probe_main.o"
  mkdir -p "$CHENG_ROOT/chengcache"
  cat > "$probe_src" <<'EOF'
fn main(): int32 =
    return 0
EOF
  env CHENG_BACKEND_TARGET="$target" CHENG_BACKEND_JOBS="1" CHENG_BACKEND_MULTI="0" CHENG_BACKEND_INCREMENTAL="0" CHENG_BACKEND_WHOLE_PROGRAM="0" CHENG_BACKEND_EMIT="obj" CHENG_BACKEND_FRONTEND="stage1" CHENG_BACKEND_INPUT="$probe_src" CHENG_BACKEND_OUTPUT="$probe_obj" "$driver" >/dev/null 2>&1 || return 1
  [ -s "$probe_obj" ] || return 1
  return 0
}

pick_backend_driver() {
  target="$1"
  if [ -n "${CHENG_BACKEND_DRIVER:-}" ] && [ -x "${CHENG_BACKEND_DRIVER}" ]; then
    if probe_driver_compile "${CHENG_BACKEND_DRIVER}" "$target"; then
      echo "${CHENG_BACKEND_DRIVER}"
      return 0
    fi
  fi

  candidates=""
  if [ -x "$CHENG_ROOT/cheng_stable" ]; then
    candidates="$candidates
$CHENG_ROOT/cheng_stable"
  fi
  if [ -x "$CHENG_ROOT/cheng" ]; then
    candidates="$candidates
$CHENG_ROOT/cheng"
  fi
  if [ -x "$CHENG_ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2" ]; then
    candidates="$candidates
$CHENG_ROOT/artifacts/backend_selfhost_self_obj/cheng.stage2"
  fi
  if [ -d "$CHENG_ROOT/dist/releases" ]; then
    while IFS= read -r release_path; do
      if [ -d "$release_path" ] && [ -x "$release_path/cheng" ]; then
        candidates="$candidates
$release_path/cheng"
      fi
    done < <(ls -1dt "$CHENG_ROOT"/dist/releases/* 2>/dev/null || true)
  fi
  for cand in "$CHENG_ROOT"/driver_*; do
    if [ -f "$cand" ] && [ -x "$cand" ]; then
      candidates="$candidates
$cand"
    fi
  done

  selected=""
  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    if probe_driver_compile "$candidate" "$target"; then
      selected="$candidate"
      break
    fi
  done <<EOF
$candidates
EOF
  [ -n "$selected" ] || return 1
  echo "$selected"
  return 0
}

if [ -n "${CHENG_ROOT:-}" ]; then
  host_target="$(sh "$CHENG_ROOT/src/tooling/detect_host_target.sh" 2>/dev/null || true)"
  if [ -n "$host_target" ]; then
    selected_driver="$(pick_backend_driver "$host_target" || true)"
    if [ -n "$selected_driver" ]; then
      export CHENG_BACKEND_DRIVER="$selected_driver"
      export CHENG_BACKEND_DRIVER_DIRECT="${CHENG_BACKEND_DRIVER_DIRECT:-0}"
      echo "[verify-production-closed-loop] backend driver: $selected_driver"
    else
      echo "[verify-production-closed-loop] failed to find runnable backend driver under CHENG_ROOT=$CHENG_ROOT" >&2
      exit 2
    fi
  fi
fi

echo "== closed-loop: strict realtime 1:1 gate =="
"$ROOT/scripts/verify_strict_realtime_1to1_gate.sh"

echo "[verify-production-closed-loop] ok"
