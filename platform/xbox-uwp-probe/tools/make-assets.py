"""Generates the placeholder logo/splash/texture PNGs for the Xbox probe package."""

import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, os.pardir, "Assets")

BG = (11, 16, 32, 255)
FG = (124, 252, 154, 255)


def png(width, height, pixels):
    raw = b"".join(b"\x00" + bytes(pixels[y]) for y in range(height))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def solid(width, height, color):
    return [list(color) * width for _ in range(height)]


def mark(width, height, inset_ratio=0.28):
    rows = solid(width, height, BG)
    inset = int(min(width, height) * inset_ratio)
    for y in range(inset, height - inset):
        for x in range(inset, width - inset):
            rows[y][x * 4 : x * 4 + 4] = list(FG)
    return rows


def write(name, width, height, rows):
    path = os.path.join(ASSETS, name)
    with open(path, "wb") as handle:
        handle.write(png(width, height, rows))
    print(f"{name} {width}x{height}")


def main():
    write("StoreLogo.png", 50, 50, mark(50, 50))
    write("Square44x44Logo.png", 44, 44, mark(44, 44))
    write("Square150x150Logo.png", 150, 150, mark(150, 150))
    write("Wide310x150Logo.png", 310, 150, mark(310, 150, 0.2))
    write("SplashScreen.png", 620, 300, mark(620, 300, 0.18))
    write("probe-tex.png", 2, 2, [[255, 0, 0, 255, 0, 255, 0, 255], [0, 0, 255, 255, 255, 255, 0, 255]])


if __name__ == "__main__":
    main()