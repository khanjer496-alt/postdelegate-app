# PostDelegate logo: orbit slot

A calendar slot with a violet orbit passing through it and a lime dot landed inside the slot. The far side of the orbit breaks where it goes behind the slot; the near side crosses in front.

All four files are drawn on the same 64-unit grid.

| File | Use |
| --- | --- |
| `postdelegate-tile.svg` | App icon: rounded square (rx 16) on Void. Use for 48px and up: `mark.svg`, `postdelegate-mark.svg`, the 192/512 icons, apple-touch (full-bleed square), extension 48/128. |
| `postdelegate-mark-dark.svg` | Mark only, transparent, for dark backgrounds (off-white slot). |
| `postdelegate-mark-light.svg` | Mark only, transparent, for light backgrounds (ink slot). |
| `postdelegate-favicon-small.svg` | 16–32px only: thicker strokes, square tabs, one orbit arc, walls aligned to the 16px pixel grid. Used for `postdelegate.svg` (the SVG favicon), the 16/32 favicon.ico frames and extension 16/32. |

## Colours

| Name | Hex | Role |
| --- | --- | --- |
| Orbit Violet | `#7357FF` | Orbit |
| Signal Lime | `#C8FF4D` | Dot |
| Off-white | `#F7F7F2` | Slot on dark |
| Ink | `#11141C` | Slot on light |
| Void | `#080A0F` | Tile background |

## Usage

- Beside the wordmark, set the mark at about 1.5x the wordmark's cap height, with a gap of roughly a third of the mark's width.
- Keep clear space of at least the dot's diameter around the mark.
- Don't recolour, rotate, add effects or redraw the orbit.
- Use the small variant only for favicon and toolbar sizes (16–32px raster). In UI the full mark holds up from about 28px CSS, since it renders on high-density screens.
- The two mark-only files are cropped to `viewBox="6 6.5 52 52"`, so they line up with text without extra padding.
