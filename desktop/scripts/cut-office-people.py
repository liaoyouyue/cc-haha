"""Cut the office-people atlas into 24 clean sprites.

Grid thirds bleed into each other, so each sprite is the single alpha-connected
component nearest its nominal cell centre — neighbour fragments are separate
components and get dropped. Feet are anchored to the canvas bottom.

Run: python scripts/cut-office-people.py <atlas.png> [outdir] [rows] [cols] [labels]
Default grid is 8 rows × 3 cols labelled sit/walk/talk. A custom grid names each
sprite person-<n>-<label> left-to-right, top-to-bottom, labels cycling per row.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

CANVAS, FIT, FEET_Y = 256, 232, 248


def component_from(seed, mask):
    grown = np.zeros_like(mask)
    grown[seed] = True
    while True:
        dil = grown.copy()
        dil[1:] |= grown[:-1]
        dil[:-1] |= grown[1:]
        dil[:, 1:] |= grown[:, :-1]
        dil[:, :-1] |= grown[:, 1:]
        new = dil & mask
        if (new == grown).all():
            return grown
        grown = new


def cut(atlas_path, outdir, rows=8, cols=3, labels=('sit', 'walk', 'talk')):
    atlas = np.array(Image.open(atlas_path).convert('RGBA'))
    h, w = atlas.shape[:2]
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    sheet = Image.new('RGBA', (cols * 130, rows * 130), (30, 34, 44, 255))

    for row in range(rows):
        for col in range(cols):
            pose = labels[col % len(labels)]
            n = row * cols + col + 1
            x0, x1 = round(col * w / cols), round((col + 1) * w / cols)
            band = atlas[:, x0:x1]
            mask = band[..., 3] > 8
            cy, cx = (row + 0.5) * h / rows, (x1 - x0) / 2
            pts = np.argwhere(mask)
            for _ in range(5):
                seed = tuple(pts[np.argmin((pts[:, 0] - cy) ** 2 + (pts[:, 1] - cx) ** 2)])
                comp = component_from(seed, mask)
                if comp.sum() >= 1000:
                    break
                mask = mask & ~comp  # bleed speck near the centre — drop and reseed
                pts = np.argwhere(mask)
            else:
                raise RuntimeError(f'no figure found at row {row + 1} col {col}')
            (y0, x0), (y1, x1) = np.argwhere(comp).min(0), np.argwhere(comp).max(0)
            sprite = band[y0:y1 + 1, x0:x1 + 1]
            scale = FIT / max(sprite.shape[:2])
            size = (max(1, round(sprite.shape[1] * scale)), max(1, round(sprite.shape[0] * scale)))
            sprite = Image.fromarray(sprite).resize(size, Image.LANCZOS)
            canvas = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
            canvas.paste(sprite, ((CANVAS - size[0]) // 2, FEET_Y - size[1]), sprite)
            canvas.save(outdir / f'person-{n}-{pose}.png')
            thumb = canvas.resize((128, 128), Image.LANCZOS)
            sheet.paste(thumb, (col * 130 + 1, row * 130 + 1), thumb)
            print(f'person-{n}-{pose}: bbox {size[0]}x{size[1]}')

    sheet.convert('RGB').save(outdir / 'contact-sheet.png')
    print('contact sheet:', outdir / 'contact-sheet.png')


if __name__ == '__main__':
    rows, cols = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (8, 3)
    labels = tuple(sys.argv[5].split(',')) if len(sys.argv) > 5 else ('sit', 'walk', 'talk')
    cut(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'src/assets/office-people', rows, cols, labels)
