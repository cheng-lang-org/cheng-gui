#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

if [ "${CHENG_ANDROID_1TO1_REQUIRE_RUNTIME:-1}" != "1" ]; then
  echo "[verify-production-closed-loop] strict mode requires CHENG_ANDROID_1TO1_REQUIRE_RUNTIME=1" >&2
  exit 1
fi
export CHENG_ANDROID_1TO1_REQUIRE_RUNTIME=1

if [ -z "${CHENG_ANDROID_1TO1_ENABLE_FULLROUTE+x}" ]; then
  export CHENG_ANDROID_1TO1_ENABLE_FULLROUTE="${CHENG_ANDROID_EQ_ENABLE_FULLROUTE:-1}"
fi
if [ "${CHENG_PRODUCTION_REQUIRE_ANDROID_FULLROUTE:-1}" = "1" ] && [ "${CHENG_ANDROID_1TO1_ENABLE_FULLROUTE}" != "1" ]; then
  echo "[verify-production-closed-loop] CHENG_PRODUCTION_REQUIRE_ANDROID_FULLROUTE=1 requires CHENG_ANDROID_1TO1_ENABLE_FULLROUTE=1" >&2
  exit 1
fi

echo "== closed-loop: native equivalence (android + ios + harmony) =="
echo "[verify-production-closed-loop] android fullroute=${CHENG_ANDROID_1TO1_ENABLE_FULLROUTE}"
"$ROOT/scripts/verify_r2c_equivalence_all_native.sh" "$@"

echo "[verify-production-closed-loop] ok"
