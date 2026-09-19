#!/usr/bin/env python3
"""
Generate the two apps' icon sets from their approved artwork.

    python3 scripts/make-icons.py

This is a one-off asset generator, not part of any build. It exists so the
icons can be regenerated and reviewed rather than appearing in the repository
as binaries nobody can reproduce.

Neither image is redrawn, recoloured or altered. The public icon is a CROP of
the approved "The Man Under the Ash" cover already in the repository; the
Measurement icon is the approved artwork used whole.

The crop box is the interesting part. The cover has lettering, and an icon must
carry none:

    title  "THE MAN UNDER THE ASH"   occupies x <=  1649
    artist "JOE E. HANSON"           occupies x <=  1272

so any crop whose left edge is at or beyond x = 1400 is word-free by
construction, at any height. JOE_CROP starts at 1400. It also keeps the guitar
in frame, which is what stops the public icon reading as the same picture as
Measurement's at 48 pixels: both are Joe, in the same sepia, and without some
second object they are one dark smudge apiece on a home screen.
"""

import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'public', 'assets', 'icons')

# Approved cover, already in the repo. Crop only: left edge 1400 clears all
# lettering, and the box keeps Joe and the guitar.
ASH = os.path.join(ROOT, 'public', 'assets', 'images', '126.jpg')
JOE_CROP = (1400, 1200, 2900, 2700)

# Approved Measurement artwork, used whole.
MEASUREMENT = os.path.join(ROOT, 'assets-src', 'measurement-source.png')

# Android may crop a maskable icon to a circle, so everything that matters has
# to sit inside the middle 80%. Both sources already sit on near-black, so the
# inset is invisible rather than a letterbox.
SAFE = 0.80


def square(im):
    assert im.size[0] == im.size[1], f'not square: {im.size}'
    return im


def write(im, name, size):
    path = os.path.join(ICONS, f'{name}-{size}.png')
    square(im).resize((size, size), Image.LANCZOS).save(path, 'PNG', optimize=True)
    return path


def maskable(im, size, bg):
    """Inset the whole image inside the safe zone on a matching background."""
    canvas = Image.new('RGB', (size, size), bg)
    inner = int(size * SAFE)
    canvas.paste(square(im).resize((inner, inner), Image.LANCZOS),
                 ((size - inner) // 2, (size - inner) // 2))
    return canvas


def corner_colour(im):
    """The artwork's own edge tone, so the inset does not show as a border."""
    w = im.size[0]
    patch = im.crop((0, 0, w // 20, w // 20)).resize((1, 1), Image.LANCZOS)
    return patch.getpixel((0, 0))


def main():
    os.makedirs(ICONS, exist_ok=True)
    written = []

    joe = Image.open(ASH).convert('RGB').crop(JOE_CROP)
    for size in (180, 192, 512):
        written.append(write(joe, 'icon', size))
    written.append(
        maskable(joe, 512, corner_colour(joe)).save(
            os.path.join(ICONS, 'icon-maskable-512.png'), 'PNG', optimize=True)
        or os.path.join(ICONS, 'icon-maskable-512.png'))

    # apple-touch-icon is referenced directly by index.html, not the manifest.
    joe.resize((180, 180), Image.LANCZOS).save(
        os.path.join(ROOT, 'public', 'apple-touch-icon.png'), 'PNG', optimize=True)
    written.append(os.path.join(ROOT, 'public', 'apple-touch-icon.png'))

    m = Image.open(MEASUREMENT).convert('RGB')
    for size in (180, 192, 512):
        written.append(write(m, 'admin', size))
    # The approved artwork has its own rounded frame and the bars run close to
    # the edge, so the maskable variant insets it rather than cropping, which
    # would cut the bars off.
    maskable(m, 512, (0, 0, 0)).save(
        os.path.join(ICONS, 'admin-maskable-512.png'), 'PNG', optimize=True)
    written.append(os.path.join(ICONS, 'admin-maskable-512.png'))

    for p in written:
        im = Image.open(p)
        print(f'  {os.path.relpath(p, ROOT):46s} {im.size[0]}x{im.size[1]}  '
              f'{os.path.getsize(p):>8,} bytes')


if __name__ == '__main__':
    main()
