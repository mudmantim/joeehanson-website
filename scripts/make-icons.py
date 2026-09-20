#!/usr/bin/env python3
"""
Generate the two apps' icon sets from their approved artwork.

    python3 scripts/make-icons.py

This is a one-off asset generator, not part of any build. It exists so the
icons can be regenerated and reviewed rather than appearing in the repository
as binaries nobody can reproduce.

Neither image is redrawn, recoloured or altered; both are crops only. The
public icon comes from the text-free portrait supplied 2026-09-20; the
Measurement icon is the approved artwork used whole.

Neither source carries lettering, so the crops are chosen purely for how each
icon reads small. The public one is tight on the head and shoulders: the
previous version was a wide frame from the album cover, and at 48 pixels -- the
size that actually decides whether you can tell two apps apart on a home
screen -- Joe's face was a handful of dark pixels.

That does bring it closer in feel to the Measurement icon, which is also a
portrait of the same man in the same sepia. They stay apart because Measurement
carries four bright amber bars, the lightest thing in that tile at any size,
and because PorchLight keeps its lantern.
"""

import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, 'public', 'assets', 'icons')

# Approved text-free portrait, supplied 2026-09-20. Crop only: the figure is
# untouched.
#
# The crop is tight on the head and shoulders on purpose. The previous public
# icon was a wider frame taken from the album cover, and at 48 pixels -- which
# is the size that actually matters on a home screen -- Joe's face was a few
# dark pixels. Face first, everything else second.
#
# It does bring this closer in feel to the Measurement icon, which is also a
# portrait of the same man. They stay apart because Measurement carries four
# bright amber bars, which are the lightest thing in that tile at any size.
ASH = os.path.join(ROOT, 'assets-src', 'joe-portrait-source.png')
JOE_CROP = (405, 215, 805, 615)

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
