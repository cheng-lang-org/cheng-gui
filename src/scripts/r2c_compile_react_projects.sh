#!/usr/bin/env bash
set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export GUI_ROOT="$ROOT"

usage() {
  cat <<'EOF'
Usage:
  r2c_compile_react_projects.sh --root <abs_path> --out <abs_path> [--strict] [--max-depth <n>]

Description:
  Discover React projects under --root and run r2c_compile_react_project.sh for each.
EOF
}

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

slugify() {
  printf '%s' "$1" | sed 's/[^A-Za-z0-9._-]/_/g'
}

workspace_root=""
out_root=""
strict_mode="0"
max_depth="6"

while [ $# -gt 0 ]; do
  case "$1" in
    --root) workspace_root="${2:-}"; shift 2 ;;
    --out) out_root="${2:-}"; shift 2 ;;
    --strict) strict_mode="1"; shift ;;
    --max-depth) max_depth="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[r2c-batch] unknown arg: $1" >&2; usage; exit 2 ;;
  esac
done

if [ -z "$workspace_root" ] || [ -z "$out_root" ]; then
  usage
  exit 2
fi
if [ ! -d "$workspace_root" ]; then
  echo "[r2c-batch] missing root dir: $workspace_root" >&2
  exit 2
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "[r2c-batch] missing dependency: python3" >&2
  exit 2
fi

workspace_root="$(CDPATH= cd -- "$workspace_root" && pwd)"
mkdir -p "$out_root"
out_root="$(CDPATH= cd -- "$out_root" && pwd)"

projects_file="$out_root/r2c_projects.txt"
python3 - "$workspace_root" "$max_depth" >"$projects_file" <<'PY'
import json
import os
import sys

root = os.path.abspath(sys.argv[1])
max_depth = int(sys.argv[2])
skip_dirs = {"node_modules", "dist", ".git", "android", "ios", "artifacts", ".build", ".third_party", ".claude"}
found = []

for cur, dirs, files in os.walk(root):
    rel = os.path.relpath(cur, root)
    depth = 0 if rel == "." else rel.count(os.sep) + 1
    dirs[:] = [d for d in dirs if d not in skip_dirs]
    if depth > max_depth:
        dirs[:] = []
        continue
    if "package.json" not in files:
        continue
    pkg_path = os.path.join(cur, "package.json")
    try:
        with open(pkg_path, "r", encoding="utf-8") as fh:
            pkg = json.load(fh)
    except Exception:
        continue
    has_react = False
    for key in ("dependencies", "devDependencies", "peerDependencies"):
        val = pkg.get(key)
        if isinstance(val, dict) and ("react" in val or "react-dom" in val):
            has_react = True
            break
    if not has_react:
        continue
    found.append(cur)

for item in sorted(set(found)):
    print(item)
PY

if [ ! -s "$projects_file" ]; then
  echo "[r2c-batch] no React projects found under: $workspace_root" >&2
  exit 2
fi

results_tsv="$out_root/r2c_batch_results.tsv"
: > "$results_tsv"

total=0
ok_count=0
fail_count=0

while IFS= read -r project_dir; do
  [ -d "$project_dir" ] || continue
  total=$((total + 1))
  base_name="$(basename "$project_dir")"
  slug="$(slugify "$base_name")"
  out_dir="$out_root/${total}_${slug}"
  args=(--project "$project_dir" --out "$out_dir")
  if [ "$strict_mode" = "1" ]; then
    args+=(--strict)
  fi

  echo "[r2c-batch] compiling: $project_dir"
  set +e
  bash "$ROOT/scripts/r2c_compile_react_project.sh" "${args[@]}" >"$out_dir.compile.log" 2>&1
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    status="ok"
    ok_count=$((ok_count + 1))
  else
    status="failed"
    fail_count=$((fail_count + 1))
  fi
  printf '%s\t%s\t%s\t%s\n' "$project_dir" "$status" "$out_dir" "$rc" >> "$results_tsv"
done < "$projects_file"

report_json="$out_root/r2c_batch_report.json"
python3 - "$workspace_root" "$strict_mode" "$total" "$ok_count" "$fail_count" "$results_tsv" "$report_json" <<'PY'
import json
import os
import sys

root = sys.argv[1]
strict = sys.argv[2] == "1"
total = int(sys.argv[3])
ok_count = int(sys.argv[4])
fail_count = int(sys.argv[5])
tsv_path = sys.argv[6]
report_path = sys.argv[7]

items = []
with open(tsv_path, "r", encoding="utf-8") as fh:
    for raw in fh:
        line = raw.rstrip("\n")
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) < 4:
            continue
        project, status, out_dir, rc = parts[0], parts[1], parts[2], parts[3]
        items.append({
            "project": project,
            "status": status,
            "out_dir": out_dir,
            "exit_code": int(rc),
        })

report = {
    "format": "r2c-batch-report-v1",
    "root": os.path.abspath(root),
    "strict": strict,
    "total": total,
    "ok": ok_count,
    "failed": fail_count,
    "items": items,
}

with open(report_path, "w", encoding="utf-8") as fh:
    json.dump(report, fh, ensure_ascii=False, indent=2)
    fh.write("\n")
PY

echo "[r2c-batch] total=$total ok=$ok_count failed=$fail_count"
echo "[r2c-batch] report=$report_json"

if [ "$fail_count" -gt 0 ]; then
  exit 1
fi
exit 0
