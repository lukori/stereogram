// app.js — UI wiring for the Stereogram Creator.
import { generateStereogram } from './stereogram.js';

// --- element refs ----------------------------------------------------------
const $ = (id) => document.getElementById(id);

const els = {
  patternDrop:     $('patternDrop'),
  patternInput:    $('patternInput'),
  patternThumb:    $('patternThumb'),
  genPatternBtn:   $('genPatternBtn'),
  depthDrop:       $('depthDrop'),
  depthInput:      $('depthInput'),
  depthThumb:      $('depthThumb'),
  patternScale:    $('patternScale'),
  patternScaleVal: $('patternScaleVal'),
  outWidth:        $('outWidth'),
  outHeight:       $('outHeight'),
  invert:          $('invert'),
  popIn:           $('popIn'),
  downloadBtn:     $('downloadBtn'),
  resetBtn:        $('resetBtn'),
  status:          $('status'),
  output:          $('output'),
};

const sources = { pattern: null, depth: null, patternIsGenerated: false };

const DEFAULTS = {
  patternScale: 1,
  outWidth: 900,
  outHeight: 600,
  invert: false,
  popIn: false,
};

// --- helpers ---------------------------------------------------------------

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Not an image file'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve({ canvas: c, dataURL: c.toDataURL() });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function setStatus(msg) { els.status.textContent = msg; }

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
}

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

// --- core regenerate -------------------------------------------------------

function regenerate() {
  if (!sources.pattern || !sources.depth) return;

  const opts = {
    width:          clampNum(els.outWidth.value, 100, 2400, 900),
    height:         clampNum(els.outHeight.value, 100, 2400, 600),
    patternRepeats:  Number(els.patternScale.value),
    aperiodicTexture: sources.patternIsGenerated,
    invert:          els.invert.checked,
    popIn:          els.popIn.checked,
  };

  const t0 = performance.now();
  try {
    generateStereogram(sources.pattern, sources.depth, els.output, opts);
    const ms = Math.round(performance.now() - t0);
    setStatus(`Generated ${opts.width}×${opts.height} in ${ms} ms.`);
    els.downloadBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus('Error generating stereogram: ' + err.message);
  }
}

const regenerateDebounced = debounce(regenerate, 150);

// --- Generate Pattern -------------------------------------------------------

function generatePattern() {
  // Random color scheme: pick 5–8 hues, add light + vivid variants each.
  const numHues = 5 + Math.floor(Math.random() * 4);
  const hues    = Array.from({ length: numHues }, () => Math.random() * 360);
  const darkBg  = Math.random() < 0.65; // mostly dark backgrounds, like the references
  const bgH     = hues[0];

  const palette = [];
  const bg = darkBg
    ? hslToRgb(bgH, 0.25, 0.07 + Math.random() * 0.06)
    : hslToRgb(bgH, 0.15, 0.88 + Math.random() * 0.06);
  palette.push(bg);

  for (const h of hues) {
    palette.push(hslToRgb(h, 0.80 + Math.random() * 0.20, 0.45 + Math.random() * 0.20));
    palette.push(hslToRgb(h, 0.60 + Math.random() * 0.20, 0.72 + Math.random() * 0.15));
    if (Math.random() < 0.5) {
      palette.push(hslToRgb(h, 0.90, 0.22 + Math.random() * 0.10));
    }
  }

  // Build a small preview canvas carrying those colors as random dots.
  // stereogram.js extracts the palette from this canvas; the actual lookup
  // is rebuilt as aperiodic dots on every regeneration.
  const W = 200, H = 200;
  const c   = document.createElement('canvas');
  c.width   = W;
  c.height  = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
  ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 700; i++) {
    const col = palette[Math.floor(Math.random() * palette.length)];
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, 1 + Math.random() * 5, 0, Math.PI * 2);
    ctx.fill();
  }

  sources.pattern          = c;
  sources.patternIsGenerated = true;
  els.patternThumb.src    = c.toDataURL();
  els.patternThumb.hidden = false;
  els.patternDrop.classList.add('has-image');

  regenerate();
}

// --- upload wiring ---------------------------------------------------------

async function handleFile(kind, file) {
  try {
    const { canvas, dataURL } = await loadImageFile(file);
    sources[kind] = canvas;

    const drop  = kind === 'pattern' ? els.patternDrop  : els.depthDrop;
    const thumb = kind === 'pattern' ? els.patternThumb : els.depthThumb;
    thumb.src    = dataURL;
    thumb.hidden = false;
    drop.classList.add('has-image');
    if (kind === 'pattern') sources.patternIsGenerated = false;

    if (kind === 'depth') {
      const aspect = canvas.height / canvas.width;
      const w = clampNum(els.outWidth.value, 100, 2400, 900);
      els.outHeight.value = clampNum(Math.round(w * aspect), 100, 2400, 600);
    }

    regenerate();
  } catch (err) {
    setStatus(err.message);
  }
}

function wireDropzone(kind, dropEl, inputEl) {
  inputEl.addEventListener('change', () => {
    if (inputEl.files[0]) handleFile(kind, inputEl.files[0]);
  });
  ['dragenter', 'dragover'].forEach((evt) =>
    dropEl.addEventListener(evt, (e) => { e.preventDefault(); dropEl.classList.add('dragover'); })
  );
  ['dragleave', 'dragend', 'drop'].forEach((evt) =>
    dropEl.addEventListener(evt, () => dropEl.classList.remove('dragover'))
  );
  dropEl.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(kind, file);
  });
}

// --- slider / label sync ---------------------------------------------------

function syncLabels() {
  els.patternScaleVal.textContent = `${Number(els.patternScale.value)}×`;
}

function wireControls() {
  els.patternScale.addEventListener('input', () => { syncLabels(); regenerateDebounced(); });
  [els.outWidth, els.outHeight].forEach((el) => el.addEventListener('input', regenerateDebounced));
  [els.invert, els.popIn].forEach((el) => el.addEventListener('change', regenerate));
}

// --- download / reset ------------------------------------------------------

els.downloadBtn.addEventListener('click', () => {
  if (els.downloadBtn.disabled) return;
  const link  = document.createElement('a');
  link.download = 'stereogram.png';
  link.href     = els.output.toDataURL('image/png');
  link.click();
});

els.resetBtn.addEventListener('click', () => {
  els.patternScale.value = DEFAULTS.patternScale;
  els.outWidth.value     = DEFAULTS.outWidth;
  els.outHeight.value    = DEFAULTS.outHeight;
  els.invert.checked     = DEFAULTS.invert;
  els.popIn.checked      = DEFAULTS.popIn;
  syncLabels();
  regenerate();
});

els.genPatternBtn.addEventListener('click', generatePattern);

// --- init ------------------------------------------------------------------

wireDropzone('pattern', els.patternDrop, els.patternInput);
wireDropzone('depth',   els.depthDrop,   els.depthInput);
wireControls();
syncLabels();

// Auto-load bundled samples — generates a fresh random pattern instead of
// the old repeating dot tile, so the first load already shows the fixed behaviour.
(async function tryLoadSamples() {
  try {
    const dep = await fetch('samples/depth.png');
    if (!dep.ok) return;
    const depBlob = await dep.blob();
    await handleFile('depth', new File([depBlob], 'depth.png', { type: depBlob.type }));
    generatePattern(); // start with a fresh random aperiodic pattern
    setStatus('Click "Generate Pattern" for a new random palette, or drop your own image.');
  } catch {
    /* no samples — fine */
  }
})();
