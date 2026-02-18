#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import os
import re
import tarfile
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

RWSTATS_URL = "https://cran.r-project.org/src/contrib/rwstats_0.1.tar.gz"
UNIHAN_URL = "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip"

DICT_SIZE = 9698

CANGJIE_MAP = {
    "A": "J",
    "B": "T",
    "C": "R",
    "D": "D",
    "E": "Y",
    "F": "U",
    "G": "F",
    "H": "E",
    "I": "N",
    "J": "S",
    "K": "Q",
    "L": "M",
    "M": "A",
    "N": "X",
    "O": "Q",
    "P": "I",
    "Q": "W",
    "R": "H",
    "S": "C",
    "T": "G",
    "U": "L",
    "V": "V",
    "W": "K",
    "X": "P",
    "Y": "O",
}

PINYIN_TONE_MAP = {
    "ā": "a",
    "á": "a",
    "ǎ": "a",
    "à": "a",
    "ē": "e",
    "é": "e",
    "ě": "e",
    "è": "e",
    "ī": "i",
    "í": "i",
    "ǐ": "i",
    "ì": "i",
    "ō": "o",
    "ó": "o",
    "ǒ": "o",
    "ò": "o",
    "ū": "u",
    "ú": "u",
    "ǔ": "u",
    "ù": "u",
    "ǖ": "u",
    "ǘ": "u",
    "ǚ": "u",
    "ǜ": "u",
    "ü": "u",
    "ń": "n",
    "ň": "n",
    "ǹ": "n",
    "ḿ": "m",
}

PINYIN_TONE_MAP_V = dict(PINYIN_TONE_MAP)
for key in ["ǖ", "ǘ", "ǚ", "ǜ", "ü"]:
    PINYIN_TONE_MAP_V[key] = "v"


@dataclass
class SingleEntry:
    text: str
    code: str
    struct: str
    canonical: str
    freq: int
    pinyin: str


@dataclass
class PhraseEntry:
    text: str
    code: str
    freq: int


@dataclass
class ReverseEntry:
    mode: str
    key: str
    text: str
    code: str
    canonical: str
    struct: str
    freq: int
    pinyin: str


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def download(url: str, target: Path) -> None:
    with urllib.request.urlopen(url) as resp:
        data = resp.read()
    target.write_bytes(data)


def is_han(ch: str) -> bool:
    if len(ch) != 1:
        return False
    cp = ord(ch)
    return (
        (0x3400 <= cp <= 0x4DBF)
        or (0x4E00 <= cp <= 0x9FFF)
        or (0xF900 <= cp <= 0xFAFF)
        or (0x20000 <= cp <= 0x2FA1F)
    )


def load_rwstats_tables(rwstats_tar: Path) -> Dict[str, List[Tuple[str, int]]]:
    import rdata  # type: ignore

    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        with tarfile.open(rwstats_tar, "r:gz") as tf:
            try:
                tf.extractall(tdp, filter="data")
            except TypeError:
                tf.extractall(tdp)

        out: Dict[str, List[Tuple[str, int]]] = {}
        for name in ["oneChar", "twoChar", "threeChar", "fourChar", "fiveChar"]:
            rda = tdp / "rwstats" / "data" / f"{name}.rda"
            parsed = rdata.parser.parse_file(rda)
            converted = rdata.conversion.convert(parsed)[name]
            rows: List[Tuple[str, int]] = []
            for _, row in converted.iterrows():
                text = str(row["character"])
                freq = int(row["freq"])
                rows.append((text, freq))
            out[name] = rows
        return out


def load_unihan_fields(unihan_zip: Path) -> Tuple[Dict[str, str], Dict[str, str]]:
    cangjie: Dict[str, str] = {}
    mandarin: Dict[str, str] = {}
    with zipfile.ZipFile(unihan_zip, "r") as zf:
        with zf.open("Unihan_DictionaryLikeData.txt") as f:
            for raw in io.TextIOWrapper(f, encoding="utf-8"):
                if not raw or raw.startswith("#"):
                    continue
                parts = raw.rstrip("\n").split("\t")
                if len(parts) != 3:
                    continue
                cp, field, val = parts
                if field != "kCangjie":
                    continue
                ch = chr(int(cp[2:], 16))
                cangjie[ch] = val
        with zf.open("Unihan_Readings.txt") as f:
            for raw in io.TextIOWrapper(f, encoding="utf-8"):
                if not raw or raw.startswith("#"):
                    continue
                parts = raw.rstrip("\n").split("\t")
                if len(parts) != 3:
                    continue
                cp, field, val = parts
                if field != "kMandarin":
                    continue
                ch = chr(int(cp[2:], 16))
                mandarin[ch] = val
    return cangjie, mandarin


def map_cangjie_to_cw(raw: str) -> str:
    out = []
    for ch in raw.upper():
        mapped = CANGJIE_MAP.get(ch)
        if mapped:
            out.append(mapped)
    return "".join(out)


def classify_struct(code: str) -> str:
    roots = "".join(ch for ch in code if "A" <= ch <= "Z")
    if len(roots) <= 1 or "X" in roots:
        return "MIX"
    if roots[0] in "RHCSMU" and len(roots) >= 2:
        return "ENC"
    if len(roots) >= 2 and roots[0] in "ABDEFGTY" and roots[1] in "ABDEFGTY":
        return "UD"
    return "LR"


def struct_token(struct: str) -> str:
    if struct == "UD":
        return "U"
    if struct == "ENC":
        return "E"
    if struct == "MIX":
        return "M"
    return "L"


def canonical4(code: str, struct: str) -> str:
    roots = "".join(ch for ch in code if "A" <= ch <= "Z")
    s = struct_token(struct)
    if len(roots) >= 4:
        return roots[0] + roots[1] + roots[2] + roots[-1]
    if len(roots) == 3:
        return roots + s
    if len(roots) == 2:
        return roots[0] + roots[1] + s + roots[1]
    if len(roots) == 1:
        return roots[0] + s + roots[0] + roots[0]
    return "X" + s + "XX"


def fuzzy_codes(code: str) -> List[str]:
    out = [code]

    def swap_prefix(src: str, a: str, b: str) -> str:
        changed = False
        chars = list(src)
        for i in range(min(3, len(chars))):
            if chars[i] == a:
                chars[i] = b
                changed = True
        return "".join(chars) if changed else ""

    for a, b in [("P", "C"), ("C", "P"), ("C", "H"), ("H", "C"), ("L", "M"), ("M", "L")]:
        v = swap_prefix(code, a, b)
        if v and v not in out:
            out.append(v)
    return out[:3]


def normalize_pinyin(raw: str, use_v: bool = False) -> str:
    table = PINYIN_TONE_MAP_V if use_v else PINYIN_TONE_MAP
    s = raw.strip().lower()
    out = []
    for ch in s:
        mapped = table.get(ch, ch)
        if "a" <= mapped <= "z":
            out.append(mapped)
    return "".join(out)


def first_reading(raw: str) -> str:
    if not raw:
        return ""
    token = raw.split()[0]
    return token.strip()


def first_n(code: str, n: int) -> str:
    roots = [ch for ch in code if "A" <= ch <= "Z"]
    if not roots:
        return "X" * n
    out = []
    for i in range(n):
        if i < len(roots):
            out.append(roots[i])
        else:
            out.append(roots[-1])
    return "".join(out)


def phrase_code(codes: List[str]) -> str:
    if len(codes) == 2:
        return first_n(codes[0], 2) + first_n(codes[1], 2)
    if len(codes) == 3:
        return first_n(codes[0], 1) + first_n(codes[1], 1) + first_n(codes[2], 2)
    return first_n(codes[0], 1) + first_n(codes[1], 1) + first_n(codes[2], 1) + first_n(codes[-1], 1)


def write_tsv(path: Path, rows: Iterable[Iterable[str]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter="\t", lineterminator="\n")
        for row in rows:
            writer.writerow(list(row))


def build_assets(out_dir: Path, rwstats_tar: Path, unihan_zip: Path) -> None:
    tables = load_rwstats_tables(rwstats_tar)
    cangjie, mandarin = load_unihan_fields(unihan_zip)

    one_char = [(ch, freq) for ch, freq in tables["oneChar"] if is_han(ch)]
    one_char.sort(key=lambda x: (-x[1], ord(x[0])))
    selected = one_char[:DICT_SIZE]

    selected_chars = [ch for ch, _ in selected]
    freq_map = {ch: freq for ch, freq in selected}

    dict_rows = []
    for idx, (ch, freq) in enumerate(selected):
        dict_rows.append((str(idx), ch, str(ord(ch)), str(freq)))

    single_entries: List[SingleEntry] = []
    main_code_map: Dict[str, str] = {}
    for ch in selected_chars:
        raw_cj = cangjie.get(ch, "")
        roots = map_cangjie_to_cw(raw_cj)
        if not roots:
            # 兜底：极少数缺失时用 X
            roots = "X"
        variants = fuzzy_codes(roots)
        p_read = first_reading(mandarin.get(ch, ""))
        p_norm = normalize_pinyin(p_read, use_v=False)
        for i, code in enumerate(variants):
            struct = classify_struct(code)
            single_entries.append(
                SingleEntry(
                    text=ch,
                    code=code,
                    struct=struct,
                    canonical=canonical4(code, struct),
                    freq=freq_map[ch],
                    pinyin=p_norm,
                )
            )
            if i == 0:
                main_code_map[ch] = code

    # 词组：2~5字全部覆盖（按计划）
    phrase_entries: List[PhraseEntry] = []
    for name in ["twoChar", "threeChar", "fourChar", "fiveChar"]:
        for text, freq in tables[name]:
            if len(text) < 2:
                continue
            ok = True
            codes = []
            for ch in text:
                if ch not in main_code_map:
                    ok = False
                    break
                codes.append(main_code_map[ch])
            if not ok:
                continue
            phrase_entries.append(PhraseEntry(text=text, code=phrase_code(codes), freq=freq))
    phrase_entries.sort(key=lambda x: (-x.freq, x.text, x.code))

    reverse_entries: List[ReverseEntry] = []
    # char 反查
    for e in single_entries:
        reverse_entries.append(
            ReverseEntry(
                mode="char",
                key=e.text,
                text=e.text,
                code=e.code,
                canonical=e.canonical,
                struct=e.struct,
                freq=e.freq,
                pinyin=e.pinyin,
            )
        )

    # py 反查：每字按主码生成
    main_single_by_char: Dict[str, SingleEntry] = {}
    for e in single_entries:
        if e.text not in main_single_by_char:
            main_single_by_char[e.text] = e

    for ch in selected_chars:
        base = main_single_by_char[ch]
        raw = first_reading(mandarin.get(ch, ""))
        py_u = normalize_pinyin(raw, use_v=False)
        py_v = normalize_pinyin(raw, use_v=True)
        keys = []
        if py_u:
            keys.append(py_u)
        if py_v and py_v != py_u:
            keys.append(py_v)
        for k in keys:
            reverse_entries.append(
                ReverseEntry(
                    mode="py",
                    key=k,
                    text=base.text,
                    code=base.code,
                    canonical=base.canonical,
                    struct=base.struct,
                    freq=base.freq,
                    pinyin=base.pinyin,
                )
            )

    reverse_entries.sort(key=lambda x: (x.mode, x.key, -x.freq, x.text, x.code))

    out_dir.mkdir(parents=True, exist_ok=True)

    dict_path = out_dir / "utfzh_dict_v1.tsv"
    single_path = out_dir / "cangwu_single_v1.tsv"
    phrase_path = out_dir / "cangwu_phrase_v1.tsv"
    reverse_path = out_dir / "cangwu_reverse_v1.tsv"
    manifest_path = out_dir / "ime_data_manifest_v1.txt"

    write_tsv(dict_path, dict_rows)
    write_tsv(single_path, ((e.text, e.code, e.struct, e.canonical, str(e.freq), e.pinyin) for e in single_entries))
    write_tsv(phrase_path, ((e.text, e.code, str(e.freq)) for e in phrase_entries))
    write_tsv(
        reverse_path,
        ((e.mode, e.key, e.text, e.code, e.canonical, e.struct, str(e.freq), e.pinyin) for e in reverse_entries),
    )

    manifest_lines = [
        "version=v1",
        f"source.rwstats.url={RWSTATS_URL}",
        f"source.unihan.url={UNIHAN_URL}",
        f"source.rwstats.sha256={sha256_file(rwstats_tar)}",
        f"source.unihan.sha256={sha256_file(unihan_zip)}",
        f"count.dict={len(dict_rows)}",
        f"count.single={len(single_entries)}",
        f"count.phrase={len(phrase_entries)}",
        f"count.reverse={len(reverse_entries)}",
        f"sha256.utfzh_dict_v1.tsv={sha256_file(dict_path)}",
        f"sha256.cangwu_single_v1.tsv={sha256_file(single_path)}",
        f"sha256.cangwu_phrase_v1.tsv={sha256_file(phrase_path)}",
        f"sha256.cangwu_reverse_v1.tsv={sha256_file(reverse_path)}",
    ]
    manifest_path.write_text("\n".join(manifest_lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate CangWu IME assets")
    parser.add_argument("--out-dir", default="src/ime/data")
    parser.add_argument("--rwstats", default="")
    parser.add_argument("--unihan", default="")
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()

    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        rwstats_tar = Path(args.rwstats).resolve() if args.rwstats else tdp / "rwstats_0.1.tar.gz"
        unihan_zip = Path(args.unihan).resolve() if args.unihan else tdp / "Unihan.zip"

        if not rwstats_tar.exists():
            download(RWSTATS_URL, rwstats_tar)
        if not unihan_zip.exists():
            download(UNIHAN_URL, unihan_zip)

        build_assets(out_dir, rwstats_tar, unihan_zip)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
