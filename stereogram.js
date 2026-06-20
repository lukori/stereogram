// stereogram.js
// Core texture-mapped Single Image Stereogram (SIS) generator.
//
// Algorithm: the classic Thimbleby–Inglis–Witten separation method
// ("Displaying 3D Images: Algorithms for Single Image Random Dot Stereograms"),
// adapted to seed pixel colors from an uploaded repeating pattern tile instead
// of random dots. The result is a flat repeating-pattern image that warps around
// a hidden 3D shape encoded by the depth map.
//
// Depth convention: Z is the normalized luminance of the depth map in [0,1].
// White (Z=1) = near (small separation, pops toward the viewer); black = far.

/**
 * Generate a stereogram into an output canvas.
 *
 * @param {CanvasImageSource & {width:number,height:number}} patternCanvas - pattern tile
 * @param {CanvasImageSource & {width:number,height:number}} depthCanvas   - grayscale depth map
 * @param {HTMLCanvasElement} outCanvas - destination canvas (resized in place)
 * @param {Object} opts
 * @param {number}  [opts.width=800]       - output width in px
 * @param {number}  [opts.height=600]      - output height in px
 * @param {number}  [opts.eyeSep=300]      - eye separation E in px (max pattern period)
 * @param {number}  [opts.mu=0.3333]       - depth factor (fraction of eyeSep used as depth range)
 * @param {number}  [opts.patternRepeats=1]- times the pattern tiles within one separation band (>=1)
 * @param {boolean} [opts.invert=false]    - invert depth (swap near/far)
 * @param {boolean} [opts.popIn=false]     - false = shape pops OUT toward viewer, true = sinks IN
 */
export function generateStereogram(patternCanvas, depthCanvas, outCanvas, opts = {}) {
  const width = Math.max(1, Math.round(opts.width || 800));
  const height = Math.max(1, Math.round(opts.height || 600));
  const eyeSep = Math.max(2, Math.round(opts.eyeSep || 300));
  const mu = clamp(opts.mu ?? 1 / 3, 0.01, 0.9);
  const patternRepeats = Math.max(1, Math.round(opts.patternRepeats || 1));
  const invert = !!opts.invert;
  const popIn = !!opts.popIn;

  // --- Read depth map, resampled to the output size -> normalized Z [0,1] ----
  const depthData = sampleToImageData(depthCanvas, width, height);
  const depth = new Float32Array(width * height);
  {
    const d = depthData.data;
    for (let i = 0, p = 0; i < depth.length; i++, p += 4) {
      let z = (0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2]) / 255;
      if (invert) z = 1 - z;
      if (popIn) z = 1 - z; // sink the shape in instead of popping it out
      depth[i] = z;
    }
  }

  // --- Pattern lookup canvas tiled across the full output size ---------------
  // CRITICAL: the pattern's horizontal period must equal the far-plane (background)
  // separation s0, otherwise the unconstrained pixels carry a second, competing
  // period that shows up as a ghosted / doubled wallpaper. Lock the band width to s0.
  const s0 = Math.max(2, separation(0, mu, eyeSep));
  const patLookup = buildPatternLookup(patternCanvas, width, height, s0, patternRepeats);
  const pat = patLookup.data;

  // --- Output buffer ---------------------------------------------------------
  outCanvas.width = width;
  outCanvas.height = height;
  const octx = outCanvas.getContext('2d');
  const outImg = octx.createImageData(width, height);
  const out = outImg.data;

  const same = new Int32Array(width); // per-row links: same[x] points to a pixel of equal color

  for (let y = 0; y < height; y++) {
    const row = y * width;

    for (let x = 0; x < width; x++) same[x] = x;

    for (let x = 0; x < width; x++) {
      const z = depth[row + x];
      const sep = separation(z, mu, eyeSep);

      const left = x - (sep >> 1);
      const right = left + sep;

      if (left >= 0 && right < width) {
        // Hidden-surface removal: a nearer surface between the two image points
        // would occlude this constraint, so only link when the point is visible.
        let visible = true;
        let t = 1;
        let zt;
        do {
          zt = z + (2 * (2 - mu * z) * t) / (mu * eyeSep);
          const xl = x - t;
          const xr = x + t;
          visible =
            (xl < 0 || depth[row + xl] < zt) && (xr >= width || depth[row + xr] < zt);
          t++;
        } while (visible && zt < 1);

        if (visible) {
          // Link toward the right so resolution (right -> left) finds it already done.
          same[left] = right;
        }
      }
    }

    // Resolve colors right -> left following the links.
    for (let x = width - 1; x >= 0; x--) {
      const outIdx = (row + x) << 2;
      let srcIdx;
      if (same[x] === x) {
        srcIdx = (row + x) << 2; // unconstrained: seed from the pattern
        out[outIdx] = pat[srcIdx];
        out[outIdx + 1] = pat[srcIdx + 1];
        out[outIdx + 2] = pat[srcIdx + 2];
      } else {
        srcIdx = (row + same[x]) << 2; // copy from the already-resolved linked pixel
        out[outIdx] = out[srcIdx];
        out[outIdx + 1] = out[srcIdx + 1];
        out[outIdx + 2] = out[srcIdx + 2];
      }
      out[outIdx + 3] = 255;
    }
  }

  octx.putImageData(outImg, 0, 0);
  return outCanvas;
}

// --- helpers ---------------------------------------------------------------

/** Stereo separation in px for a normalized depth z. Larger z -> nearer -> smaller sep. */
function separation(z, mu, eyeSep) {
  return Math.round(((1 - mu * z) * eyeSep) / (2 - mu * z));
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Draw a source canvas/image scaled to (w,h) and return its ImageData. */
function sampleToImageData(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/**
 * Tile the pattern across a (w,h) canvas with a fixed horizontal period and
 * return ImageData, so any output pixel has a defined seed color.
 *
 * The tile band is exactly `period` px wide (= the background separation), with
 * the pattern drawn `reps` times across it. Because the band width matches the
 * stereo separation, the resulting wallpaper resolves cleanly with no competing
 * period (no ghosting/doubling). `reps` controls how small the pattern looks.
 */
function buildPatternLookup(patternCanvas, w, h, period, reps) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });

  const tileW = Math.max(1, Math.round(period));
  const copyW = tileW / reps; // each pattern copy fills 1/reps of the band
  const copyH = (patternCanvas.height * copyW) / patternCanvas.width; // keep aspect
  const tileH = Math.max(1, Math.round(copyH));

  const tile = document.createElement('canvas');
  tile.width = tileW;
  tile.height = tileH;
  const tctx = tile.getContext('2d');
  tctx.imageSmoothingEnabled = true;
  // Draw `reps` identical copies side by side; the band wraps seamlessly at tileW.
  for (let i = 0; i < reps; i++) {
    tctx.drawImage(patternCanvas, i * copyW, 0, copyW, tileH);
  }

  ctx.fillStyle = ctx.createPattern(tile, 'repeat');
  ctx.fillRect(0, 0, w, h);

  return ctx.getImageData(0, 0, w, h);
}
