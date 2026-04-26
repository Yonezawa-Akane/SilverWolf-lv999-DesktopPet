"""Generate assets/icon.ico (and assets/icon.png) using the 🐺 wolf emoji
rendered via Windows' Segoe UI Emoji color font.

Requires: Pillow >= 9.2 (for embedded_color), Windows with seguiemj.ttf.

Usage: python scripts/gen_icon.py  (run from project root)
"""
import struct, io, os
from PIL import Image, ImageDraw, ImageFont

EMOJI = '\U0001F43A'   # 🐺
FONT_PATH = 'C:/Windows/Fonts/seguiemj.ttf'
SIZES = [16, 24, 32, 48, 64, 128, 256]

def render_size(size):
    """Render the emoji centered into a `size`x`size` RGBA canvas.

    Segoe UI Emoji's color bitmap glyphs top out around 136 px; rendering directly at 256
    produces an upscaled-bitmap look. For 256 we render at 128 and upscale via LANCZOS,
    which is sharper and avoids Pillow's missing-glyph fallback at huge sizes.
    """
    render_px = min(size, 128)
    font = ImageFont.truetype(FONT_PATH, int(render_px * 0.92))
    canvas = Image.new('RGBA', (render_px, render_px), (0, 0, 0, 0))
    ImageDraw.Draw(canvas).text(
        (render_px / 2, render_px / 2),
        EMOJI,
        font=font,
        embedded_color=True,
        anchor='mm',
    )
    if render_px != size:
        canvas = canvas.resize((size, size), Image.LANCZOS)
    return canvas

def to_png_bytes(img):
    buf = io.BytesIO()
    img.save(buf, 'PNG')
    return buf.getvalue()

def build_ico(images, out_path):
    n = len(images)
    hdr = struct.pack('<HHH', 0, 1, n)
    off = 6 + n * 16
    ents = b''
    blobs = b''
    for size, png in images:
        sw = 0 if size == 256 else size  # ICO encodes 256 as 0
        ents += struct.pack('<BBBBHHII', sw, sw, 0, 0, 1, 32, len(png), off)
        off += len(png)
        blobs += png
    with open(out_path, 'wb') as f:
        f.write(hdr + ents + blobs)

def main():
    if not os.path.exists(FONT_PATH):
        raise SystemExit(f'Segoe UI Emoji not found at {FONT_PATH}; this script is Windows-only.')
    os.makedirs('assets', exist_ok=True)
    rendered = [(s, render_size(s)) for s in SIZES]
    pngs = [(s, to_png_bytes(img)) for s, img in rendered]
    build_ico(pngs, 'assets/icon.ico')
    print(f'assets/icon.ico ok ({len(pngs)} sizes: {", ".join(str(s) for s, _ in pngs)})')
    # Companion 256 PNG for BrowserWindow `icon:` option (used at runtime for taskbar).
    rendered[-1][1].save('assets/icon.png', 'PNG')
    print('assets/icon.png ok (256x256)')

if __name__ == '__main__':
    main()
