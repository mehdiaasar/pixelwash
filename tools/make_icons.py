#!/usr/bin/env python3
"""Render every Pixelwash icon, the Android launcher/splash images and the Play Store graphics from one SVG design.

Needs rsvg-convert (brew install librsvg) and Pillow. Run from the repo root:  python3 tools/make_icons.py
"""
import io, os, subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageFont

GRAD = ('<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#007cf0"/>'
        '<stop offset=".5" stop-color="#7928ca"/><stop offset="1" stop-color="#ff0080"/></linearGradient>')
WAVES = ('<path d="M6 15.5c2.2-1.6 3.8-1.6 6 0s3.8 1.6 6 0M6 10.5c2.2-1.6 3.8-1.6 6 0s3.8 1.6 6 0" '
         'stroke="#fff" stroke-width="1.8" fill="none" stroke-linecap="round"/>')
def svg(shape, scale=1):
    w = WAVES if scale == 1 else f'<g transform="translate(12 12) scale({scale}) translate(-12 -12)">{WAVES}</g>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs>{GRAD}</defs>{shape}{w}</svg>'

ROUNDED = svg('<rect x="1" y="1" width="22" height="22" rx="6" fill="url(#g)"/>')   # web icon, legacy launcher, splash
FULL = svg('<rect width="24" height="24" fill="url(#g)"/>')                          # Play (it rounds the corners itself)
SAFE = svg('<rect width="24" height="24" fill="url(#g)"/>', 0.7)                     # maskable / adaptive: waves inside the safe zone
ROUND = svg('<circle cx="12" cy="12" r="11" fill="url(#g)"/>')                       # legacy round launcher

def render(src, size):
    png = subprocess.run(['rsvg-convert', '-w', str(size), '-h', str(size), '-f', 'png'],
                         input=src.encode(), capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(png)).convert('RGBA')

def save(im, path):
    os.makedirs(os.path.dirname(path), exist_ok=True); im.save(path, optimize=True); print('wrote', path, im.size)

# ---- website
save(render(ROUNDED, 192), 'public/icons/icon-192.png')
save(render(ROUNDED, 512), 'public/icons/icon-512.png')
save(render(SAFE, 512), 'public/icons/icon-512-maskable.png')
with open('public/icons/icon.svg', 'w') as f: f.write(ROUNDED)

# ---- Android launcher (adaptive 108dp foreground; the waves sit inside the 66dp safe zone)
RES = 'android/app/src/main/res'
for d, s in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
    save(render(SAFE, round(108 * s)), f'{RES}/mipmap-{d}/ic_launcher_foreground.png')
    save(render(ROUNDED, round(48 * s)), f'{RES}/mipmap-{d}/ic_launcher.png')
    save(render(ROUND, round(48 * s)), f'{RES}/mipmap-{d}/ic_launcher_round.png')

# ---- Android splash: logo at 22% of the short side, centred on the same light background as before
for d, (w, h) in {'drawable': (480, 320), 'drawable-land-mdpi': (480, 320), 'drawable-land-hdpi': (800, 480),
                  'drawable-land-xhdpi': (1280, 720), 'drawable-land-xxhdpi': (1600, 960), 'drawable-land-xxxhdpi': (1920, 1280),
                  'drawable-port-mdpi': (320, 480), 'drawable-port-hdpi': (480, 800), 'drawable-port-xhdpi': (720, 1280),
                  'drawable-port-xxhdpi': (960, 1600), 'drawable-port-xxxhdpi': (1280, 1920)}.items():
    im = Image.new('RGB', (w, h), (250, 250, 250))
    n = round(min(w, h) * 0.22); logo = render(ROUNDED, n)
    im.paste(logo, ((w - n) // 2, (h - n) // 2), logo)
    save(im, f'{RES}/{d}/splash.png')

# ---- Play Store: 512 icon (full square, Play rounds the corners) and the 1024x500 feature graphic
save(render(FULL, 512).convert('RGB'), 'store/play/icon-512.png')
W, H = 1024, 500
fg = Image.new('RGB', (W, H), (10, 10, 10))
glow = Image.new('RGB', (W, H), (10, 10, 10)); g = ImageDraw.Draw(glow)
for (x, y, r, c) in [(760, 120, 230, (0, 124, 240)), (900, 330, 210, (121, 40, 202)), (640, 420, 190, (255, 0, 128)), (980, 60, 120, (249, 203, 40))]:
    g.ellipse((x - r, y - r, x + r, y + r), fill=c)
fg = Image.blend(fg, glow.filter(ImageFilter.GaussianBlur(110)), 0.55)
logo = render(ROUNDED, 168); fg.paste(logo, (72, (H - 168) // 2 - 70), logo)
FONT = 'node_modules/@fontsource/geist-sans/files/geist-sans-latin-{}-normal.woff'
d = ImageDraw.Draw(fg)
d.text((72, 300), 'Pixelwash', font=ImageFont.truetype(FONT.format(600), 92), fill=(255, 255, 255))
d.text((76, 408), 'Remove watermarks. Upscale videos. On your device.', font=ImageFont.truetype(FONT.format(400), 30), fill=(200, 200, 200))
save(fg, 'store/play/feature-graphic-1024x500.png')
