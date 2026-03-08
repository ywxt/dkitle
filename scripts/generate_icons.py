#!/usr/bin/env python3
"""
Generate all application icons for dkitle.

Design: transparent background, black rounded-rectangle outline, black "DK" text centered.
Pure Python — no external dependencies.

Output files:
  dkitle-app/assets/icon.png          (256x256)
  dkitle-app/assets/icon.ico          (multi-size)
  dkitle-app/assets/macos/AppIcon.icns (multi-size)
"""

import struct
import zlib
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------------------
# Bitmap font for "D" and "K" — each glyph is defined on a 7x10 grid
# 1 = filled pixel, 0 = transparent
# ---------------------------------------------------------------------------

GLYPH_D = [
    [1, 1, 1, 1, 1, 0, 0],
    [1, 0, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1, 0],
    [1, 1, 1, 1, 1, 0, 0],
]

GLYPH_K = [
    [1, 0, 0, 0, 0, 0, 1],
    [1, 0, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 1, 0, 0],
    [1, 0, 0, 1, 0, 0, 0],
    [1, 0, 1, 0, 0, 0, 0],
    [1, 1, 1, 0, 0, 0, 0],
    [1, 0, 0, 1, 0, 0, 0],
    [1, 0, 0, 0, 1, 0, 0],
    [1, 0, 0, 0, 0, 1, 0],
    [1, 0, 0, 0, 0, 0, 1],
]


def _render_icon(size: int) -> list[list[tuple[int, int, int, int]]]:
    """Render an RGBA icon image at the given size.

    Returns a 2D list of (R, G, B, A) tuples.
    """
    img = [[(0, 0, 0, 0)] * size for _ in range(size)]

    # --- Draw rounded rectangle outline ---
    margin = max(1, size // 16)
    radius = max(2, size // 6)
    stroke = max(1, size // 32)
    black = (0, 0, 0, 255)

    x0, y0 = margin, margin
    x1, y1 = size - 1 - margin, size - 1 - margin

    def _in_rounded_rect_border(px: int, py: int) -> bool:
        """Check if pixel (px, py) is on the border of the rounded rectangle."""
        # Check if inside outer rounded rect
        def _in_rounded_rect(rx0, ry0, rx1, ry1, r, cx, cy):
            if cx < rx0 or cx > rx1 or cy < ry0 or cy > ry1:
                return False
            # Check corners
            corners = [
                (rx0 + r, ry0 + r),  # top-left
                (rx1 - r, ry0 + r),  # top-right
                (rx0 + r, ry1 - r),  # bottom-left
                (rx1 - r, ry1 - r),  # bottom-right
            ]
            for corner_x, corner_y in corners:
                # In corner region?
                in_corner_x = (cx < rx0 + r and corner_x == rx0 + r) or (
                    cx > rx1 - r and corner_x == rx1 - r
                )
                in_corner_y = (cy < ry0 + r and corner_y == ry0 + r) or (
                    cy > ry1 - r and corner_y == ry1 - r
                )
                if in_corner_x and in_corner_y:
                    dist_sq = (cx - corner_x) ** 2 + (cy - corner_y) ** 2
                    return dist_sq <= r * r
            return True

        outer = _in_rounded_rect(x0, y0, x1, y1, radius, px, py)
        inner_margin = stroke
        inner = _in_rounded_rect(
            x0 + inner_margin,
            y0 + inner_margin,
            x1 - inner_margin,
            y1 - inner_margin,
            max(0, radius - inner_margin),
            px,
            py,
        )
        return outer and not inner

    for py in range(size):
        for px in range(size):
            if _in_rounded_rect_border(px, py):
                img[py][px] = black

    # --- Draw "DK" text ---
    glyph_w, glyph_h = 7, 10
    total_glyph_w = glyph_w * 2 + 1  # D + gap + K = 15 units wide
    total_glyph_h = glyph_h  # 10 units tall

    # Available area inside the rounded rect (with some padding)
    inner_pad = margin + stroke + max(1, size // 10)
    avail_w = size - 2 * inner_pad
    avail_h = size - 2 * inner_pad

    # Scale factor
    scale = min(avail_w / total_glyph_w, avail_h / total_glyph_h)
    scale = max(1, int(scale))

    text_w = total_glyph_w * scale
    text_h = total_glyph_h * scale

    # Center the text
    text_x0 = (size - text_w) // 2
    text_y0 = (size - text_h) // 2

    def _draw_glyph(glyph, offset_x, offset_y):
        for gy in range(glyph_h):
            for gx in range(glyph_w):
                if glyph[gy][gx]:
                    # Fill a scale x scale block
                    for dy in range(scale):
                        for dx in range(scale):
                            px = offset_x + gx * scale + dx
                            py = offset_y + gy * scale + dy
                            if 0 <= px < size and 0 <= py < size:
                                img[py][px] = black

    _draw_glyph(GLYPH_D, text_x0, text_y0)
    _draw_glyph(GLYPH_K, text_x0 + (glyph_w + 1) * scale, text_y0)

    return img


def _encode_png(img: list[list[tuple[int, int, int, int]]], width: int, height: int) -> bytes:
    """Encode RGBA image data as PNG bytes."""
    # Build raw image data with filter byte 0 (None) per row
    raw = bytearray()
    for row in img:
        raw.append(0)  # filter byte
        for r, g, b, a in row:
            raw.extend((r, g, b, a))

    compressed = zlib.compress(bytes(raw), 9)

    def _chunk(chunk_type: bytes, data: bytes) -> bytes:
        c = chunk_type + data
        crc = zlib.crc32(c) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + c + struct.pack(">I", crc)

    png = b"\x89PNG\r\n\x1a\n"
    # IHDR
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    png += _chunk(b"IHDR", ihdr_data)
    # IDAT
    png += _chunk(b"IDAT", compressed)
    # IEND
    png += _chunk(b"IEND", b"")
    return png


def _encode_ico(png_data_list: list[tuple[int, bytes]]) -> bytes:
    """Encode multiple PNG images into a single ICO file.

    png_data_list: list of (size, png_bytes)
    """
    count = len(png_data_list)
    # ICO header: 6 bytes
    header = struct.pack("<HHH", 0, 1, count)

    # Directory entries: 16 bytes each
    entries = bytearray()
    data_parts = bytearray()
    offset = 6 + 16 * count

    for size, png_bytes in png_data_list:
        w = size if size < 256 else 0
        h = size if size < 256 else 0
        entries += struct.pack(
            "<BBBBHHII",
            w,  # width
            h,  # height
            0,  # color palette
            0,  # reserved
            1,  # color planes
            32,  # bits per pixel
            len(png_bytes),  # size of image data
            offset,  # offset to image data
        )
        data_parts += png_bytes
        offset += len(png_bytes)

    return header + bytes(entries) + bytes(data_parts)


def _encode_icns(png_data_list: list[tuple[int, bytes]]) -> bytes:
    """Encode multiple PNG images into an ICNS file.

    png_data_list: list of (size, png_bytes)
    """
    # ICNS type codes for PNG-embedded icons
    size_to_type = {
        16: b"icp4",
        32: b"icp5",
        64: b"icp6",
        128: b"ic07",
        256: b"ic08",
        512: b"ic09",
        1024: b"ic10",
    }

    entries = bytearray()
    for size, png_bytes in png_data_list:
        if size not in size_to_type:
            continue
        icon_type = size_to_type[size]
        entry_len = 8 + len(png_bytes)
        entries += icon_type + struct.pack(">I", entry_len) + png_bytes

    total_len = 8 + len(entries)
    return b"icns" + struct.pack(">I", total_len) + bytes(entries)


def generate_all():
    """Generate all icon files."""
    # Desktop app icons
    app_assets_dir = ROOT_DIR / "dkitle-app" / "assets"
    app_assets_dir.mkdir(parents=True, exist_ok=True)

    # Main PNG icon (256x256)
    img256 = _render_icon(256)
    png256 = _encode_png(img256, 256, 256)
    png256_path = app_assets_dir / "icon.png"
    png256_path.write_bytes(png256)
    print(f"Generated: {png256_path}")

    # Windows ICO (16, 32, 48, 256)
    ico_sizes = [16, 32, 48, 256]
    ico_entries = []
    for s in ico_sizes:
        if s == 256:
            ico_entries.append((s, png256))
        else:
            img = _render_icon(s)
            ico_entries.append((s, _encode_png(img, s, s)))

    ico_path = app_assets_dir / "icon.ico"
    ico_path.write_bytes(_encode_ico(ico_entries))
    print(f"Generated: {ico_path}")

    # macOS ICNS (16, 32, 128, 256)
    macos_dir = app_assets_dir / "macos"
    macos_dir.mkdir(parents=True, exist_ok=True)

    icns_sizes = [16, 32, 128, 256]
    icns_entries = []
    for s in icns_sizes:
        if s == 256:
            icns_entries.append((s, png256))
        else:
            img = _render_icon(s)
            icns_entries.append((s, _encode_png(img, s, s)))

    icns_path = macos_dir / "AppIcon.icns"
    icns_path.write_bytes(_encode_icns(icns_entries))
    print(f"Generated: {icns_path}")

    print("All icons generated.")


if __name__ == "__main__":
    generate_all()
