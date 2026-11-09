import { h, esc, dropzone, statusLine, download, loadImage, canvasToBlob, baseName, formatBytes, tests } from '/js/ui.js';

// Common sizes. Bangladesh government job applications (Teletalk) ask for exactly these.
const PRESETS = [
  { id: 'job-photo', label: 'Job photo', sub: '300×300 · max 100 KB', w: 300, h: 300, kb: 100 },
  { id: 'signature', label: 'Signature', sub: '300×80 · max 60 KB', w: 300, h: 80, kb: 60 },
  { id: 'passport', label: 'Passport photo', sub: '600×600 (2×2 in)', w: 600, h: 600, kb: '' },
  { id: 'square', label: 'Social post', sub: '1080×1080', w: 1080, h: 1080, kb: '' },
  { id: 'custom', label: 'Custom', sub: 'Any size', w: null, h: null, kb: '' },
];
const MAX_SIDE = 8000;

// mode: "resize" (all options) | "compress" (keep size, just reach a target KB)
export default function mount(root, { mode }) {
  const compressOnly = mode === 'compress';
  const status = statusLine();
  let img = null, file = null;
  const st = { w: 300, h: 300, fit: 'crop', zoom: 1, px: 0.5, py: 0.5, bg: '#ffffff', transparent: false, fmt: 'image/jpeg', kb: '', lock: false };
  if (compressOnly) Object.assign(st, { fit: 'stretch', kb: 100 });

  const dz = dropzone({
    accept: 'image/*', multiple: false, test: tests.isImage, maxSizeMB: 30,
    title: compressOnly ? 'Drop the image you want to make smaller' : 'Drop your photo or signature here',
    sub: 'or paste a screenshot with Ctrl+V · JPG, PNG, WEBP · up to 30 MB',
    onFiles: async (files) => {
      if (!files.length) return status.set('Please choose an image.', true);
      try {
        file = files[0];
        img = await loadImage(file);
        if (compressOnly || !st.w) { st.w = img.naturalWidth; st.h = img.naturalHeight; }
        st.zoom = 1; st.px = st.py = 0.5;
        if (file.type === 'image/png' && !compressOnly) st.fmt = 'image/png';
        dz.hidden = true; editor.hidden = false;
        info.textContent = `${file.name} · ${img.naturalWidth}×${img.naturalHeight} px · ${formatBytes(file.size)}`;
        syncInputs(); draw(); estimate();
      } catch { status.set('Could not open this image.', true); }
    },
  });

  // ------------------------------------------------------------------ editor UI
  const editor = h(`<div class="rz" hidden>
      <div class="rz-preview">
        <div class="rz-stage"><canvas></canvas></div>
        <p class="hint rz-hint"></p>
        <div class="row rz-zoom"><label class="field inline" style="flex:1">Zoom <input type="range" name="zoom" min="1" max="4" step="0.01" value="1" style="flex:1" /></label></div>
        <p class="hint rz-info"></p>
      </div>
      <div class="rz-controls">
        ${compressOnly ? '' : `
        <div class="rz-sec"><h3>Size</h3>
          <div class="chips">${PRESETS.map((p) => `<button type="button" class="chip" data-preset="${p.id}"><b>${esc(p.label)}</b><small>${esc(p.sub)}</small></button>`).join('')}</div>
          <div class="row rz-dims">
            <label class="field">Width (px)<input type="number" name="w" min="1" max="${MAX_SIDE}" /></label>
            <button type="button" class="icon-btn lock" title="Keep the image's shape (lock ratio)" aria-pressed="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg></button>
            <label class="field">Height (px)<input type="number" name="h" min="1" max="${MAX_SIDE}" /></label>
          </div>
        </div>
        <div class="rz-sec"><h3>How to fit</h3>
          <div class="seg" role="radiogroup">
            <button type="button" data-fit="crop">Crop</button>
            <button type="button" data-fit="fit">Background</button>
            <button type="button" data-fit="stretch">Stretch</button>
          </div>
          <p class="hint fit-hint"></p>
          <div class="row bg-row">
            <label class="field">Background<input type="color" name="bg" value="#ffffff" /></label>
            <div class="swatches">${['#ffffff', '#f2f2f2', '#2b6cde', '#d32f2f', '#000000'].map((c) => `<button type="button" class="sw" data-c="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
            <label class="check field inline"><input type="checkbox" name="transparent" /> Transparent</label>
          </div>
        </div>`}
        <div class="rz-sec"><h3>File size</h3>
          <div class="row">
            <label class="field">Format<select name="fmt"><option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp">WEBP</option></select></label>
            <label class="field">Max size (KB)<input type="number" name="kb" min="5" max="20000" placeholder="e.g. 50" /></label>
          </div>
          <p class="hint kb-hint">Leave empty for best quality.</p>
        </div>
        <div class="actions">
          <button type="button" class="btn primary big dl">Download</button>
          <button type="button" class="btn ghost reset">New image</button>
        </div>
        <p class="rz-est"></p>
      </div>
    </div>`);
  const canvas = editor.querySelector('canvas');
  const info = editor.querySelector('.rz-info');
  const est = editor.querySelector('.rz-est');
  const q = (s) => editor.querySelector(s);

  // ------------------------------------------------------------------ drawing
  function geometry(W, H) {
    const iw = img.naturalWidth, ih = img.naturalHeight;
    if (st.fit === 'stretch') return { x: 0, y: 0, w: W, h: H };
    if (st.fit === 'fit') { const s = Math.min(W / iw, H / ih); return { x: (W - iw * s) / 2, y: (H - ih * s) / 2, w: iw * s, h: ih * s }; }
    const s = Math.max(W / iw, H / ih) * st.zoom; // crop: cover the box, then zoom and pan
    const w = iw * s, h = ih * s;
    return { x: -(w - W) * st.px, y: -(h - H) * st.py, w, h };
  }
  function paint(ctx, W, H) {
    ctx.clearRect(0, 0, W, H);
    const keepAlpha = st.transparent && st.fmt !== 'image/jpeg';
    if (!keepAlpha) { ctx.fillStyle = st.bg; ctx.fillRect(0, 0, W, H); }
    const g = geometry(W, H);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, g.x, g.y, g.w, g.h);
  }
  // High-quality downscaling: halve repeatedly before the final draw (avoids jagged edges on big photos)
  function render(W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = geometry(W, H);
    const shrink = Math.min(g.w / img.naturalWidth, g.h / img.naturalHeight);
    let src = img;
    if (shrink < 0.5) {
      let sw = img.naturalWidth, sh = img.naturalHeight;
      while (sw * shrink * 2 < sw / 2 && sw > 2) {
        const t = document.createElement('canvas'); t.width = Math.ceil(sw / 2); t.height = Math.ceil(sh / 2);
        const tc = t.getContext('2d'); tc.imageSmoothingQuality = 'high'; tc.drawImage(src, 0, 0, t.width, t.height);
        src = t; sw = t.width; sh = t.height;
      }
    }
    const ctx = c.getContext('2d');
    const keepAlpha = st.transparent && st.fmt !== 'image/jpeg';
    if (!keepAlpha) { ctx.fillStyle = st.bg; ctx.fillRect(0, 0, W, H); }
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, g.x, g.y, g.w, g.h);
    return c;
  }
  function draw() {
    if (!img) return;
    canvas.width = st.w; canvas.height = st.h;
    paint(canvas.getContext('2d'), st.w, st.h);
    const crop = st.fit === 'crop';
    q('.rz-zoom').hidden = !crop || compressOnly;
    q('.rz-hint').textContent = compressOnly ? `${st.w}×${st.h} px (same as your image)`
      : crop ? `${st.w}×${st.h} px · drag the photo to choose what stays in the frame` : `${st.w}×${st.h} px`;
    canvas.style.cursor = crop && !compressOnly ? 'grab' : 'default';
    editor.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', presetFor() === c.dataset.preset));
    editor.querySelectorAll('[data-fit]').forEach((b) => b.classList.toggle('on', b.dataset.fit === st.fit));
    const fh = q('.fit-hint');
    if (fh) fh.textContent = { crop: 'Fills the whole size and trims the edges. Nothing is stretched.', fit: 'Keeps the whole image and fills the empty space with a color.', stretch: 'Squeezes the image to the exact size (may look distorted).' }[st.fit];
    const bgRow = q('.bg-row');
    if (bgRow) bgRow.hidden = st.fit !== 'fit'; // background color only matters when there is empty space
  }
  const presetFor = () => PRESETS.find((p) => p.w === st.w && p.h === st.h && String(p.kb) === String(st.kb))?.id || 'custom';

  function syncInputs() {
    if (!compressOnly) { q('[name=w]').value = st.w; q('[name=h]').value = st.h; q('[name=zoom]').value = st.zoom; }
    q('[name=fmt]').value = st.fmt; q('[name=kb]').value = st.kb;
  }

  // ------------------------------------------------------------------ encoding (with target size)
  const encode = (c, quality) => canvasToBlob(c, st.fmt, quality);
  async function makeBlob() {
    const target = Number(st.kb) * 1024;
    // Compress-only: if the original is already small enough (same size and format), keep it untouched
    if (compressOnly && target && file.size <= target && file.type === st.fmt && st.w === img.naturalWidth && st.h === img.naturalHeight) {
      return { blob: file, quality: 1, original: true };
    }
    const c = render(st.w, st.h);
    if (!target) return { blob: await encode(c, 0.92), quality: 0.92 };
    if (st.fmt === 'image/png') {
      const blob = await encode(c);
      return { blob, quality: 1, pngTooBig: blob.size > target };
    }
    // Binary search the highest quality that fits under the target
    let lo = 0.05, hi = 0.95, best = null;
    const first = await encode(c, hi);
    if (first.size <= target) return { blob: first, quality: hi };
    for (let i = 0; i < 9; i++) {
      const mid = (lo + hi) / 2;
      const b = await encode(c, mid);
      if (b.size <= target) { best = { blob: b, quality: mid }; lo = mid; } else hi = mid;
    }
    if (best) return best;
    const smallest = await encode(c, 0.05);
    return { blob: smallest, quality: 0.05, tooBig: smallest.size > target };
  }

  let estTimer, estRun = 0;
  function estimate() {
    clearTimeout(estTimer);
    est.textContent = 'Calculating file size…';
    estTimer = setTimeout(async () => {
      const run = ++estRun;
      const r = await makeBlob();
      if (run !== estRun) return; // a newer change is already being calculated
      const kb = (r.blob.size / 1024).toFixed(1);
      if (r.original) est.innerHTML = `<span class="ok">✓</span> Your image is already ${kb} KB, under the ${esc(st.kb)} KB limit. You'll get the original, unchanged.`;
      else if (r.pngTooBig) est.innerHTML = `<span class="bad">PNG can't be squeezed to ${esc(st.kb)} KB (it is ${kb} KB). Choose JPG for a smaller file.</span>`;
      else if (r.tooBig) est.innerHTML = `<span class="bad">Can't reach ${esc(st.kb)} KB at ${st.w}×${st.h}. Smallest possible: ${kb} KB. Make the size smaller.</span>`;
      else {
        est.innerHTML = `<span class="ok">✓</span> Output: <b>${st.w}×${st.h} px · ${kb} KB</b>${st.kb ? ` (limit ${esc(st.kb)} KB)` : ''}${r.quality < 0.92 ? ` · quality ${Math.round(r.quality * 100)}%` : ''}`;
        // Very low quality looks blurry: a smaller pixel size keeps it sharper at the same KB
        if (r.quality < 0.4) est.innerHTML += `<br><span class="hint">Tip: quality is low. For a clearer image, also make it smaller in pixels${compressOnly ? ' with <a href="/resize-image">Resize Image</a>' : ' (lower Width/Height)'}.</span>`;
      }
    }, 250);
  }
  const update = () => { draw(); estimate(); };

  // ------------------------------------------------------------------ events
  editor.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-preset]');
    if (chip) {
      const p = PRESETS.find((x) => x.id === chip.dataset.preset);
      if (p.w) { Object.assign(st, { w: p.w, h: p.h, kb: p.kb, fit: 'crop', zoom: 1, px: 0.5, py: 0.5 }); if (p.kb) st.fmt = 'image/jpeg'; }
      else { st.w = img.naturalWidth; st.h = img.naturalHeight; st.kb = ''; }
      syncInputs(); update();
    }
    const fit = e.target.closest('[data-fit]');
    if (fit) { st.fit = fit.dataset.fit; update(); }
    const sw = e.target.closest('.sw');
    if (sw) { st.bg = sw.dataset.c; st.transparent = false; q('[name=bg]').value = sw.dataset.c; q('[name=transparent]').checked = false; update(); }
    if (e.target.closest('.lock')) {
      st.lock = !st.lock;
      const b = q('.lock'); b.setAttribute('aria-pressed', String(st.lock)); b.classList.toggle('on', st.lock);
    }
  });
  editor.addEventListener('input', (e) => {
    const t = e.target;
    const ratio = img ? img.naturalHeight / img.naturalWidth : 1;
    if (t.name === 'w' || t.name === 'h') {
      const v = Math.min(MAX_SIDE, Math.max(1, Math.round(Number(t.value) || 1)));
      if (t.name === 'w') { st.w = v; if (st.lock) { st.h = Math.max(1, Math.round(v * ratio)); q('[name=h]').value = st.h; } }
      else { st.h = v; if (st.lock) { st.w = Math.max(1, Math.round(v / ratio)); q('[name=w]').value = st.w; } }
    }
    if (t.name === 'zoom') st.zoom = Number(t.value);
    if (t.name === 'bg') { st.bg = t.value; st.transparent = false; q('[name=transparent]').checked = false; }
    if (t.name === 'transparent') { st.transparent = t.checked; if (t.checked && st.fmt === 'image/jpeg') { st.fmt = 'image/png'; q('[name=fmt]').value = st.fmt; } }
    if (t.name === 'fmt') { st.fmt = t.value; if (st.fmt === 'image/jpeg' && st.transparent) { st.transparent = false; const tr = q('[name=transparent]'); if (tr) tr.checked = false; } }
    if (t.name === 'kb') { st.kb = t.value ? Math.max(1, Number(t.value)) : ''; if (st.kb && st.fmt === 'image/png') { st.fmt = 'image/jpeg'; q('[name=fmt]').value = st.fmt; } }
    update();
  });

  // Drag to move the photo inside the frame (crop mode); mouse wheel zooms
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (st.fit !== 'crop' || compressOnly) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, px: st.px, py: st.py };
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const g = geometry(st.w, st.h);
    const scale = st.w / canvas.getBoundingClientRect().width; // screen px → image px
    const freeX = g.w - st.w, freeY = g.h - st.h;
    if (freeX > 0) st.px = Math.min(1, Math.max(0, drag.px - ((e.clientX - drag.x) * scale) / freeX));
    if (freeY > 0) st.py = Math.min(1, Math.max(0, drag.py - ((e.clientY - drag.y) * scale) / freeY));
    draw();
  });
  const endDrag = () => { if (drag) { drag = null; canvas.style.cursor = 'grab'; estimate(); } };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (st.fit !== 'crop' || compressOnly) return;
    e.preventDefault();
    st.zoom = Math.min(4, Math.max(1, st.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    q('[name=zoom]').value = st.zoom; update();
  }, { passive: false });

  q('.dl').onclick = async () => {
    const r = await makeBlob(); // always from the current settings
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[r.original ? file.type : st.fmt] || 'jpg';
    download(r.blob, `${baseName(file.name)}-${st.w}x${st.h}.${ext}`);
    status.set(`Downloaded: ${st.w}×${st.h} px, ${(r.blob.size / 1024).toFixed(1)} KB.`);
  };
  q('.reset').onclick = () => { img = null; file = null; editor.hidden = true; dz.hidden = false; status.set(''); };

  root.append(dz, editor, status);
}
