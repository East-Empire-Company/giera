"""Generates the Giera UWP tile and splash art."""

from PIL import Image, ImageDraw, ImageFont

import os

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, os.pardir, "Assets")

BG = (11, 16, 32)
ACCENT = (124, 252, 154)
ACCENT_DIM = (74, 211, 164)
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Futura.ttc",
    "/Library/Fonts/Arial Bold.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
]


def font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def centred(draw, box, text, fill, size):
    f = font(size)
    left, top, right, bottom = draw.textbbox((0, 0), text, font=f)
    x = box[0] + (box[2] - box[0] - (right - left)) / 2 - left
    y = box[1] + (box[3] - box[1] - (bottom - top)) / 2 - top
    draw.text((x, y), text, font=f, fill=fill)


def canvas(width, height):
    image = Image.new("RGB", (width, height), BG)
    return image, ImageDraw.Draw(image)


def blocks(draw, x, y, unit, rows, colour):
    for row_index, row in enumerate(rows):
        for column_index, cell in enumerate(row):
            if cell == "1":
                draw.rectangle(
                    [x + column_index * unit, y + row_index * unit, x + (column_index + 1) * unit - 1, y + (row_index + 1) * unit - 1],
                    fill=colour,
                )


LOGO_GLYPH = ["1111", "1000", "1011", "1001", "1111"]


def splash(width, height):
    image, draw = canvas(width, height)
    unit = height // 26
    glyph_width = 4 * unit
    glyph_height = 5 * unit
    title_size = int(height * 0.22)
    title_font = font(title_size)
    title = "GIERA"
    left, top, right, bottom = draw.textbbox((0, 0), title, font=title_font)
    title_width = right - left
    gap = unit * 2
    total = glyph_width + gap + title_width
    start_x = (width - total) / 2
    glyph_y = (height - glyph_height) / 2 - unit
    blocks(draw, start_x, glyph_y, unit, LOGO_GLYPH, ACCENT)
    text_x = start_x + glyph_width + gap
    draw.text((text_x - left, (height - title_size) / 2 - bottom + title_size * 0.15), title, font=title_font, fill=ACCENT)
    bar_y = glyph_y + glyph_height + unit * 3
    bar_width = int(width * 0.42)
    bar_x = (width - bar_width) / 2
    draw.rectangle([bar_x, bar_y, bar_x + bar_width, bar_y + unit * 0.7], fill=(28, 38, 62))
    draw.rectangle([bar_x, bar_y, bar_x + bar_width * 0.42, bar_y + unit * 0.7], fill=ACCENT_DIM)
    return image


def tile(size, text, scale):
    image, draw = canvas(size, size)
    centred(draw, (0, 0, size, size), text, ACCENT, int(size * scale))
    return image


def wide(width, height):
    image, draw = canvas(width, height)
    unit = height // 14
    glyph_height = 5 * unit
    blocks(draw, unit * 2, (height - glyph_height) / 2, unit, LOGO_GLYPH, ACCENT)
    centred(draw, (unit * 2 + 4 * unit, 0, width, height), "GIERA", ACCENT, int(height * 0.42))
    return image


def main():
    os.makedirs(ASSETS, exist_ok=True)
    outputs = {
        "SplashScreen.png": splash(620, 300),
        "Wide310x150Logo.png": wide(310, 150),
        "Square150x150Logo.png": tile(150, "G", 0.6),
        "Square44x44Logo.png": tile(44, "G", 0.66),
        "StoreLogo.png": tile(50, "G", 0.66),
        "SplashLogo.png": splash(1240, 600),
    }
    for name, image in outputs.items():
        image.save(os.path.join(ASSETS, name))
        print(f"{name} {image.size[0]}x{image.size[1]}")


if __name__ == "__main__":
    main()