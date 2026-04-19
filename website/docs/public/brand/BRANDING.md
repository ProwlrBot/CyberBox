# CyberBox Brand Guidelines

Canonical brand assets for the CyberBox project and associated ProwlrBot surfaces
(prowlrbot.com, GitHub org, GHCR images, docs site).

## Files

| File | Use |
| --- | --- |
| `icon.svg` | App icon — 64×64 source, used as square avatar |
| `favicon.svg` | Browser tab favicon — 32×32 source |
| `logo-light.svg` | Horizontal wordmark for light backgrounds |
| `logo-dark.svg` | Horizontal wordmark for dark backgrounds |

All four are placeholders. Final artwork TBD; keep filenames stable so
downstream references (`rspress.config.ts`, README embeds, SDK READMEs,
social preview) don't need to change when real art lands.

## Colors

Primary palette — violet / carbon, inspired by the Prowlr lineage:

| Token | Hex | Use |
| --- | --- | --- |
| `--cb-ink` | `#0b0f17` | Canvas, dark surfaces |
| `--cb-violet-500` | `#8b5cf6` | Primary action, outlines |
| `--cb-violet-400` | `#a78bfa` | Secondary strokes, hover |
| `--cb-violet-300` | `#c4b5fd` | Accents, dividers |
| `--cb-violet-200` | `#ddd6fe` | Surface tint on dark |
| `--cb-violet-50` | `#f5f3ff` | Wordmark on dark |

## Typography

- **Display / wordmark**: Inter 700, letter-spacing `-0.3`
- **Body**: Inter 400, system stack fallback
- **Mono**: JetBrains Mono, ui-monospace fallback

## Do

- Use `icon.svg` for square contexts (GitHub org, npm, PyPI, Docker label).
- Use `logo-light.svg` on `#ffffff`..`#e5e5ea` backgrounds.
- Use `logo-dark.svg` on `#000000`..`#1a1a2e` backgrounds.
- Keep at least 8px clear space around any mark.
- Keep the hex prism intact — it represents the sandbox.

## Don't

- Don't recolor the mark outside the palette above.
- Don't rasterize — ship SVG everywhere SVG is supported.
- Don't squash aspect ratios; scale uniformly.
- Don't drop the wordmark and use just "CB" — that's an internal shorthand.

## Social / meta

Social preview image (`.github/brand/social-preview.png`, 1280×640) and Open
Graph image (`.github/brand/og-image.png`, 1200×630) are composited from
`banner.png` via ImageMagick center-crop + 256-color quantize. Regenerate
via:

```bash
magick website/docs/public/brand/banner.png -resize 1280x640^ \
  -gravity center -extent 1280x640 -strip -colors 256 \
  -define png:compression-level=9 .github/brand/social-preview.png
magick website/docs/public/brand/banner.png -resize 1200x630^ \
  -gravity center -extent 1200x630 -strip -colors 256 \
  -define png:compression-level=9 .github/brand/og-image.png
```

Replace when the four placeholder SVGs land with real artwork.

## Replacing placeholders

When finalized artwork is ready:

1. Drop the new SVG into this directory under the SAME filename.
2. Verify color contrast against backgrounds used in `website/` (Lighthouse a11y check).
3. Regenerate social/og rasters (manually or via a Playwright screenshot script).
4. Update this document if any token values change.

## Banner

- **File**: `website/docs/public/brand/banner.png` (served at `/brand/banner.png`)
- **Dimensions**: 600x400
- **Source**: AI-generated (ChatGPT image, 2026-04-18)
- **Palette**: orange / blue (accent hero art — sits alongside the violet/carbon core palette above; do not treat its hexes as brand tokens)
- **Subject**: fortified chest with biohazard seal + "CyberBox" wordmark
- **Chips shown**: Prowlr, Harbinger, LLM, Caido
- **Used in**: `README.md` (top hero), `website/docs/en/index.md` (rspress home hero `image.src`)
