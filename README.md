# Stereogram Creator

A browser tool that turns a **repeating pattern** + a **depth map** into an
**autostereogram** ("Magic Eye" image): a flat 2D picture that reveals a hidden
3D shape when you relax your eyes and look "through" it.

🔗 **Live:** https://lukori.github.io/stereogram/

This is the first of three planned tools. Coming next: a **pattern maker** and a
**3D-file → depth-map maker**.

## Use it

1. Open the live site (or `index.html` locally — see below).
2. Drop in a **pattern** image (a small, busy, high-contrast tile works best).
3. Drop in a **depth map** (grayscale: **white = near**, black = far background).
4. Adjust the sliders; the preview regenerates live.
5. Click **Download PNG**.

The page ships with a sample pattern + depth map (`samples/`) that load
automatically, so you can try it immediately.

### How to see the 3D
Relax your eyes and look *through* the screen (wall-eyed / diverged), as if
focusing on something behind it, until the repeating columns drift together. The
hidden shape will float out of the surface.

## Controls

| Control | What it does |
| --- | --- |
| **Pattern repeats** | How many times the pattern tiles within one separation band (1 = one motif per band, like the references). Higher = smaller pattern. |
| **Width / Height** | Output size. Height defaults to the depth map's aspect ratio. |
| **Invert depth** | Swap near/far (use if your depth maps are black = near). |
| **Pop in (sink)** | Make the shape recede into the surface instead of popping out. |

### Automatic eye separation & depth (learned from references)

Eye separation and depth strength are **not** exposed as controls — they're fixed
to proportions measured from real Magic-Eye stereograms (`references/`):

- **Eye separation** → background pattern period = **13% of the output width**
  (≈ 7.6 repeats across), so it scales correctly with any output size.
- **Depth strength** → `mu = 0.36` (the average implied by the references).

Both live as `SEP_FRACTION` and `DEPTH_MU` constants at the top of
[`stereogram.js`](stereogram.js).

## How it works

It implements the classic **Thimbleby–Inglis–Witten** single-image-stereogram
separation algorithm ([core in `stereogram.js`](stereogram.js)), seeding pixel
colors from your pattern instead of random dots.

For each scanline, every pixel's horizontal *separation* is computed from its
depth `Z`:

```
separation = round((1 - mu*Z) * E / (2 - mu*Z))
```

Nearer points (larger `Z`, brighter in the depth map) get a **smaller**
separation. Pixels separated by that distance are constrained to share a color;
unconstrained pixels are filled from the tiled pattern. Your eyes interpret the
locally-varying repetition period as depth.

## Run locally

It's a static site, but it uses ES modules and `fetch()` for the bundled
samples, so it needs to be served over HTTP (not opened as a `file://`):

```bash
cd stereogram
python3 -m http.server 5180
# then open http://localhost:5180/
```

## Project files

- `index.html` / `styles.css` — UI and layout
- `app.js` — uploads, controls, live regenerate, download
- `stereogram.js` — the stereogram algorithm
- `samples/` — bundled demo pattern + depth map
- `.github/workflows/deploy.yml` — auto-deploys to GitHub Pages on push to `main`
