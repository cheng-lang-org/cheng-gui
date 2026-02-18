#!/usr/bin/env python3
import argparse
import struct
import sys
import zlib


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png_rgba(path: str, width: int, height: int, rgba: bytes) -> None:
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    rows = []
    stride = width * 4
    for y in range(height):
        start = y * stride
        rows.append(b"\x00" + rgba[start:start + stride])
    idat = zlib.compress(b"".join(rows), level=9)
    with open(path, "wb") as f:
        f.write(sig)
        f.write(png_chunk(b"IHDR", ihdr))
        f.write(png_chunk(b"IDAT", idat))
        f.write(png_chunk(b"IEND", b""))


def main() -> int:
    ap = argparse.ArgumentParser(description="Convert raw RGBA frame dump (.rgba.out) to PNG.")
    ap.add_argument("--in", dest="inp", required=True, help="Input raw RGBA file path")
    ap.add_argument("--out", dest="out", required=True, help="Output PNG path")
    ap.add_argument("--width", type=int, required=True, help="Frame width in pixels")
    ap.add_argument("--height", type=int, required=True, help="Frame height in pixels")
    args = ap.parse_args()

    if args.width <= 0 or args.height <= 0:
        print("invalid width/height", file=sys.stderr)
        return 2

    data = open(args.inp, "rb").read()
    # Fallback backend may emit text metadata; that content is not raw RGBA.
    if data.startswith(b"w=") and b"\nstride=" in data:
        print("input appears to be fallback metadata, not raw RGBA bytes", file=sys.stderr)
        return 3

    expected = args.width * args.height * 4
    if len(data) != expected:
        print(f"input size mismatch: got={len(data)} expected={expected}", file=sys.stderr)
        return 4

    write_png_rgba(args.out, args.width, args.height, data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

