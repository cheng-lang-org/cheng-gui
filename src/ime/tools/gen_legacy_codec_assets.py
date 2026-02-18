#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
from pathlib import Path


def is_scalar(cp: int) -> bool:
    return 0 <= cp <= 0x10FFFF and not (0xD800 <= cp <= 0xDFFF)


def iter_gbk_pairs():
    for b1 in range(0x81, 0xFF):
        for b2 in range(0x40, 0xFF):
            if b2 == 0x7F:
                continue
            yield b1, b2


def iter_gb2312_pairs():
    for b1 in range(0xA1, 0xF8):
        for b2 in range(0xA1, 0xFF):
            yield b1, b2


def build_map(encoding: str, pairs_iter):
    rows = []
    for b1, b2 in pairs_iter():
        raw = bytes([b1, b2])
        try:
            text = raw.decode(encoding)
        except UnicodeDecodeError:
            continue
        if len(text) != 1:
            continue
        cp = ord(text)
        if not is_scalar(cp):
            continue
        key = f"{b1:02X}{b2:02X}"
        rows.append((key, cp, text))
    rows.sort(key=lambda x: x[0])
    return rows


def write_tsv(path: Path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, delimiter="\t", lineterminator="\n")
        for key, cp, ch in rows:
            w.writerow((key, str(cp), ch))

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()

def update_manifest(out_dir: Path, gbk_rows, gb2312_rows):
    manifest = out_dir / "ime_data_manifest_v1.txt"
    lines = []
    if manifest.exists():
        lines = manifest.read_text(encoding="utf-8").splitlines()
    kv = {}
    for line in lines:
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        kv[key] = value

    gbk_path = out_dir / "legacy_gbk_to_u_v1.tsv"
    gb2312_path = out_dir / "legacy_gb2312_to_u_v1.tsv"
    kv["legacy.script"] = "gen_legacy_codec_assets.py:v1"
    kv["count.legacy_gbk"] = str(len(gbk_rows))
    kv["count.legacy_gb2312"] = str(len(gb2312_rows))
    kv["sha256.legacy_gbk_to_u_v1.tsv"] = sha256_file(gbk_path)
    kv["sha256.legacy_gb2312_to_u_v1.tsv"] = sha256_file(gb2312_path)

    ordered_keys = []
    seen = set()
    for line in lines:
        if "=" not in line:
            continue
        key = line.split("=", 1)[0]
        if key in kv and key not in seen:
            ordered_keys.append(key)
            seen.add(key)
    for key in [
        "legacy.script",
        "count.legacy_gbk",
        "count.legacy_gb2312",
        "sha256.legacy_gbk_to_u_v1.tsv",
        "sha256.legacy_gb2312_to_u_v1.tsv",
    ]:
        if key not in seen:
            ordered_keys.append(key)
            seen.add(key)
    for key in kv.keys():
        if key not in seen:
            ordered_keys.append(key)
            seen.add(key)
    out_lines = [f"{key}={kv[key]}" for key in ordered_keys]
    manifest.write_text("\n".join(out_lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate legacy GBK/GB2312 decode maps")
    parser.add_argument("--out-dir", default="src/ime/data")
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    gbk_rows = build_map("gbk", iter_gbk_pairs)
    gb2312_rows = build_map("gb2312", iter_gb2312_pairs)

    write_tsv(out_dir / "legacy_gbk_to_u_v1.tsv", gbk_rows)
    write_tsv(out_dir / "legacy_gb2312_to_u_v1.tsv", gb2312_rows)
    update_manifest(out_dir, gbk_rows, gb2312_rows)

    print(f"[gen-legacy-codec-assets] gbk={len(gbk_rows)}")
    print(f"[gen-legacy-codec-assets] gb2312={len(gb2312_rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
