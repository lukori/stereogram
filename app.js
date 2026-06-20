// app.js — UI wiring for the Stereogram Creator.
import { generateStereogram } from './stereogram.js';

// --- element refs ----------------------------------------------------------
const $ = (id) => document.getElementById(id);

const els = {
  patternDrop: $('patternDrop'),
  patternInput: $('patternInput'),
  patternThumb: $('patternThumb'),
  depthDrop: $('depthDrop'),
  depthInput: $('depthInput'),
  depthThumb: $('depthThumb'),
  patternScale: $('patternScale'),
  patternScaleVal: $('patternScaleVal'),
  outWidth: $('outWidth'),
  outHeight: $('outHeight'),
  invert: $('invert'),
  popIn: $('popIn'),
  downloadBtn: $('downloadBtn'),
  resetBtn: $('resetBtn'),
  status: $('status'),
  output: $('output'),
};

// Loaded source images, drawn to offscreen canvases for fast pixel access.
const sources = { pattern: null, depth: null };

const DEFAULTS = {
  patternScale: 1, // pattern repeats per separation band
  outWidth: 900,
  outHeight: 600,
  invert: false,
  popIn: false,
};

// --- helpers ---------------------------------------------------------------

/** Read a File into an Image, then onto an offscreen canvas. */
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
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function setStatus(msg) {
  els.status.textContent = msg;
}

// --- core regenerate -------------------------------------------------------

function regenerate() {
  if (!sources.pattern || !sources.depth) return;

  const opts = {
    width: clampNum(els.outWidth.value, 100, 2400, 900),
    height: clampNum(els.outHeight.value, 100, 2400, 600),
    patternRepeats: Number(els.patternScale.value),
    invert: els.invert.checked,
    popIn: els.popIn.checked,
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

function clampNum(v, lo, hi, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// --- upload wiring ---------------------------------------------------------

async function handleFile(kind, file) {
  try {
    const { canvas, dataURL } = await loadImageFile(file);
    sources[kind] = canvas;

    const drop = kind === 'pattern' ? els.patternDrop : els.depthDrop;
    const thumb = kind === 'pattern' ? els.patternThumb : els.depthThumb;
    thumb.src = dataURL;
    thumb.hidden = false;
    drop.classList.add('has-image');

    // Default output size to the depth map's aspect on first depth load.
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
    dropEl.addEventListener(evt, (e) => {
      e.preventDefault();
      dropEl.classList.add('dragover');
    })
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

// --- slider/label sync -----------------------------------------------------

function syncLabels() {
  els.patternScaleVal.textContent = `${Number(els.patternScale.value)}×`;
}

function wireControls() {
  els.patternScale.addEventListener('input', () => {
    syncLabels();
    regenerateDebounced();
  });

  [els.outWidth, els.outHeight].forEach((el) =>
    el.addEventListener('input', regenerateDebounced)
  );

  [els.invert, els.popIn].forEach((el) => el.addEventListener('change', regenerate));
}

// --- download / reset ------------------------------------------------------

els.downloadBtn.addEventListener('click', () => {
  if (els.downloadBtn.disabled) return;
  const link = document.createElement('a');
  link.download = 'stereogram.png';
  link.href = els.output.toDataURL('image/png');
  link.click();
});

els.resetBtn.addEventListener('click', () => {
  els.patternScale.value = DEFAULTS.patternScale;
  els.outWidth.value = DEFAULTS.outWidth;
  els.outHeight.value = DEFAULTS.outHeight;
  els.invert.checked = DEFAULTS.invert;
  els.popIn.checked = DEFAULTS.popIn;
  syncLabels();
  regenerate();
});

// --- init ------------------------------------------------------------------

wireDropzone('pattern', els.patternDrop, els.patternInput);
wireDropzone('depth', els.depthDrop, els.depthInput);
wireControls();
syncLabels();

// Auto-load bundled samples if present, so the tool works on first open.
(async function tryLoadSamples() {
  try {
    const [pat, dep] = await Promise.all([
      fetch('samples/pattern.png'),
      fetch('samples/depth.png'),
    ]);
    if (!pat.ok || !dep.ok) return;
    const [patBlob, depBlob] = await Promise.all([pat.blob(), dep.blob()]);
    await handleFile('pattern', new File([patBlob], 'pattern.png', { type: patBlob.type }));
    await handleFile('depth', new File([depBlob], 'depth.png', { type: depBlob.type }));
    setStatus('Loaded sample pattern + depth map. Try the controls, or upload your own.');
  } catch {
    /* no samples bundled — fine */
  }
})();
