#!/usr/bin/env python3
"""Regenerates the web app's brand assets from the originals in images/ (fenwira_v2/images).

Usage: python3 scripts/brand-assets.py   (needs Pillow and numpy; a manual tool, not run in CI)

Outputs (see docs/brand/README.md for where each one is used):
  apps/web/app/favicon.ico, public/brand/favicon-*.png  favicons (light/dark, by colour scheme)
  public/brand/apple-icon.png                           iOS home screen (full-bleed app icon)
  apps/web/app/opengraph-image.png, twitter-image.png  link previews (dark banner, 1200x630)
  apps/web/public/brand/*.png                          mark, lockups, manifest icons, brand kit
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'images'
APP = ROOT / 'apps/web/app'
PUB = ROOT / 'apps/web/public/brand'
PUB.mkdir(parents=True, exist_ok=True)


def load(name: str) -> Image.Image:
    return Image.open(SRC / name).convert('RGBA')


def save(img: Image.Image, path: Path) -> None:
    img.save(path, optimize=True)
    print(f'{path.relative_to(ROOT)}  {img.width}x{img.height}  {path.stat().st_size // 1024} KB')


def largest_component(alpha: np.ndarray, threshold: int = 24) -> np.ndarray:
    """Mask of the largest 4-connected region with alpha > threshold (drops stray specks)."""
    solid = alpha > threshold
    seen = np.zeros_like(solid)
    best: list[tuple[int, int]] = []
    h, w = solid.shape
    for y0, x0 in zip(*np.nonzero(solid)):
        if seen[y0, x0]:
            continue
        comp, queue = [], deque([(y0, x0)])
        seen[y0, x0] = True
        while queue:
            y, x = queue.popleft()
            comp.append((y, x))
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and solid[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    queue.append((ny, nx))
        if len(comp) > len(best):
            best = comp
    mask = np.zeros_like(solid)
    ys, xs = zip(*best)
    mask[list(ys), list(xs)] = True
    # Keep the antialiased edge: grow the mask by 3 px.
    for _ in range(3):
        grown = mask.copy()
        grown[1:] |= mask[:-1]
        grown[:-1] |= mask[1:]
        grown[:, 1:] |= mask[:, :-1]
        grown[:, :-1] |= mask[:, 1:]
        mask = grown
    return mask


def trim(img: Image.Image, pad: float = 0.0, square: bool = False) -> Image.Image:
    """Crops to the non-transparent content, adds `pad` (fraction of the long side)."""
    box = img.getbbox()
    img = img.crop(box)
    w, h = img.size
    p = int(max(w, h) * pad)
    size = (max(w, h) + 2 * p,) * 2 if square else (w + 2 * p, h + 2 * p)
    out = Image.new('RGBA', size, (0, 0, 0, 0))
    out.paste(img, ((size[0] - w) // 2, (size[1] - h) // 2))
    return out


def white_to_alpha(img: Image.Image) -> Image.Image:
    """GIMP-style color-to-alpha for a white background: exact when composited on white, and the
    antialiased edges stay smooth on any light surface."""
    a = np.asarray(img.convert('RGB')).astype(np.float64)
    alpha = np.max(255 - a, axis=2) / 255
    alpha[alpha < 0.05] = 0  # off-white paper noise
    safe = np.where(alpha > 0, alpha, 1)[..., None]
    rgb = np.clip((a - 255 * (1 - alpha[..., None])) / safe, 0, 255)
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def card(img: Image.Image, dark: bool, size: int) -> Image.Image:
    """A favicon from a rounded-square icon: cropped to the card's outline (found on the middle
    row and column), with transparent rounded corners, at `size` px."""
    s = np.asarray(img.convert('RGB')).astype(int).sum(axis=2)
    h, w = s.shape
    row, col = s[h // 2], s[:, w // 2]
    pick = np.argmax if dark else np.argmin  # bright outline (dark) or grey border (light)
    third = int(w * 0.15)  # the outline lies in the outer band; the F starts further in
    x0, x1 = pick(row[:third]), w - third + pick(row[-third:])
    y0, y1 = pick(col[:third]), h - third + pick(col[-third:])
    crop = img.crop((x0, y0, x1 + 1, y1 + 1)).convert('RGBA')
    big = crop.width * 4
    mask = Image.new('L', (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=int(big * 0.22), fill=255)
    crop = crop.resize((big, big), Image.LANCZOS)
    crop.putalpha(mask)
    return crop.resize((size, size), Image.LANCZOS)


def full_bleed(img: Image.Image) -> Image.Image:
    """The rounded-square icon without its white margin: the square is cropped inward just far
    enough that none of the rounded corners (or the white outside them) remains, so platforms that
    apply their own mask (iOS, Android maskable) never show white or a double rim."""
    rgb = np.asarray(img.convert('RGB')).astype(int)
    dark = rgb.sum(axis=2) < 600
    ys, xs = np.nonzero(dark)
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    side = min(x1 - x0, y1 - y0)
    # Walk the diagonal from the top-left corner: past the white margin, then past the bright rim.
    k = 0
    while k < side // 2 and not dark[y0 + k, x0 + k]:
        k += 1
    rim = 0
    while rim < 24 and rgb[y0 + k, x0 + k].sum() > 300:  # the rim is thin; the F starts later
        k += 1
        rim += 1
    inset = k + 2
    print(f'full-bleed inset {inset}px of {side}px')
    crop = rgb[y0 + inset : y0 + side - inset, x0 + inset : x0 + side - inset]
    return Image.fromarray(crop.astype(np.uint8), 'RGB')


# Symbol (transparent F, stray specks removed): the sidebar mark.
mark = load('Fenwira_symbol_emerald.png')
arr = np.asarray(mark).copy()
arr[~largest_component(arr[:, :, 3])] = 0
mark = trim(Image.fromarray(arr, 'RGBA'), pad=0.04, square=True)
save(mark.resize((256, 256), Image.LANCZOS), PUB / 'fenwira-mark.png')

# Favicons: the light icon for light colour schemes, the dark (glow) icon for dark ones.
light_fav = card(load('Fenwira_favicon_light.png'), dark=False, size=256)
dark_fav = card(load('Fenwira_Favicon_dark.png'), dark=True, size=256)
for name, fav in (('favicon-light', light_fav), ('favicon-dark', dark_fav)):
    save(fav.resize((64, 64), Image.LANCZOS), PUB / f'{name}.png')
light_fav.save(APP / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('apps/web/app/favicon.ico  16/32/48 (light)')

# App icon (dark): iOS home screen and the web app manifest.
icon = full_bleed(load('Fenwira_App_Icon.png'))
save(icon.resize((180, 180), Image.LANCZOS), PUB / 'apple-icon.png')
for s in (192, 512):
    save(icon.resize((s, s), Image.LANCZOS), PUB / f'app-icon-{s}.png')

# Light-surface lockup: auth pages and transactional email header.
lockup = trim(white_to_alpha(load('Fenwira_primary_logo_light.png')), pad=0.01)
save(lockup.resize((960, round(960 * lockup.height / lockup.width)), Image.LANCZOS), PUB / 'fenwira-lockup-light.png')

# Link previews: dark banner, 1200x630 (content is centred; crop the 1.9:1 band).
banner = load('Fenwira_stacked_logo.png').convert('RGB')
bh = round(banner.width / 1.905)
top = (banner.height - bh) // 2
og = banner.crop((0, top, banner.width, top + bh)).resize((1200, 630), Image.LANCZOS)
save(og, APP / 'opengraph-image.png')
save(og, APP / 'twitter-image.png')

# Brand kit (not used by the UI directly): documented in docs/brand/README.md.
for src, dst, size in (
    ('Fenwira_primary_logo_dark.png', 'fenwira-lockup-dark.png', 1200),
    ('Fenwira_rounded_icon.png', 'fenwira-rounded-icon.png', 1024),
    ('Fenwira_stacked_logo.png', 'fenwira-stacked-logo.png', 1536),
):
    img = load(src).convert('RGB')
    save(img.resize((size, round(size * img.height / img.width)), Image.LANCZOS), PUB / dst)
