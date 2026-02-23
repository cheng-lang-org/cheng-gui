#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "$SCRIPT_ROOT/cangwu_ime_cli.sh" verify "$@"
