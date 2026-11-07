// Shared UI helpers for tool pages (ES module).

export const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

export function baseName(name) { return String(name).replace(/\.[^.]+$/, '') || 'file'; }

export function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  if (btn) { const old = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => (btn.textContent = old), 1200); }
}

/** Status line with error styling. */
export function statusLine() {
  const el = h('<p class="status" role="status" aria-live="polite"></p>');
  el.set = (msg, isError = false) => { el.textContent = msg; el.classList.toggle('error', isError); };
  return el;
}

/**
 * Drop zone: click, drag & drop, and (optionally) paste.
 * accept: e.g. 'image/*' or '.pdf,application/pdf'; test(file) decides which files are accepted.
 */
export function dropzone({ accept, multiple = true, title, sub, test, onFiles, paste = true, maxSizeMB = 50 }) {
  const el = h(`<div class="dropzone" tabindex="0" role="button">
      <div class="dz-icon">⬆</div>
      <p class="dz-title">${esc(title)}</p>
      <p class="dz-sub">${esc(sub || '')}</p>
      <button type="button" class="btn primary">Browse files</button>
      <input type="file" hidden ${multiple ? 'multiple' : ''} accept="${esc(accept)}" />
    </div>`);
  const input = el.querySelector('input');
  const take = (list) => {
    const files = [...list];
    const ok = files.filter((f) => (!test || test(f)) && f.size <= maxSizeMB * 1024 * 1024);
    const skipped = files.length - ok.length;
    if (ok.length || skipped) onFiles(multiple ? ok : ok.slice(0, 1), skipped);
  };
  el.addEventListener('click', (e) => { if (e.target !== input) input.click(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { take(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.remove('drag'); }));
  el.addEventListener('drop', (e) => take(e.dataTransfer.files));
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());
  if (paste) {
    document.addEventListener('paste', (e) => {
      if (e.target.closest && e.target.closest('textarea, input')) return;
      const files = [...(e.clipboardData?.items || [])].filter((i) => i.kind === 'file').map((i) => i.getAsFile());
      if (files.length) { e.preventDefault(); take(files); }
    });
  }
  return el;
}

/**
 * Reorderable file list (drag handles + up/down buttons + remove).
 * Returns { el, items, add(files), clear(), onChange }.
 */
export function fileList({ thumb } = {}) {
  const el = h('<ul class="file-list"></ul>');
  const state = { el, items: [], onChange: () => {} };
  let dragFrom = null;

  function render() {
    el.innerHTML = '';
    state.items.forEach((it, i) => {
      const li = h(`<li class="file-row" draggable="true">
          <span class="handle" title="Drag to reorder">⋮⋮</span>
          <span class="num">${i + 1}</span>
          ${it.thumb ? `<img class="thumb" src="${it.thumb}" alt="" />` : `<span class="thumb doc">${esc(it.badge || 'FILE')}</span>`}
          <span class="fname" title="${esc(it.file.name)}">${esc(it.file.name)}<small>${formatBytes(it.file.size)}${it.info ? ' · ' + esc(it.info) : ''}</small></span>
          <span class="row-btns">
            <button class="icon-btn up" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon-btn down" title="Move down" ${i === state.items.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon-btn rm" title="Remove">✕</button>
          </span>
        </li>`);
      li.querySelector('.up').onclick = () => move(i, i - 1);
      li.querySelector('.down').onclick = () => move(i, i + 1);
      li.querySelector('.rm').onclick = () => { const [r] = state.items.splice(i, 1); if (r.thumb) URL.revokeObjectURL(r.thumb); render(); };
      li.addEventListener('dragstart', () => { dragFrom = i; li.classList.add('dragging'); });
      li.addEventListener('dragend', () => li.classList.remove('dragging'));
      li.addEventListener('dragover', (e) => e.preventDefault());
      li.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); if (dragFrom !== null) move(dragFrom, i); dragFrom = null; });
      el.appendChild(li);
    });
    state.onChange(state.items);
  }
  function move(from, to) {
    if (to < 0 || to >= state.items.length) return;
    const [it] = state.items.splice(from, 1);
    state.items.splice(to, 0, it);
    render();
  }
  state.add = (files, extra = () => ({})) => {
    for (const file of files) state.items.push({ file, thumb: thumb ? URL.createObjectURL(file) : null, ...extra(file) });
    render();
  };
  state.update = render;
  state.clear = () => { state.items.forEach((r) => r.thumb && URL.revokeObjectURL(r.thumb)); state.items = []; render(); };
  return state;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = src instanceof Blob ? URL.createObjectURL(src) : src;
    img.onload = () => { if (src instanceof Blob) URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { if (src instanceof Blob) URL.revokeObjectURL(url); reject(new Error('Could not read this image.')); };
    img.src = url;
  });
}

export const canvasToBlob = (canvas, type = 'image/png', quality) =>
  new Promise((resolve) => canvas.toBlob(resolve, type, quality));

const isImage = (f) => f.type.startsWith('image/');
const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const tests = { isImage, isPdf };

/** Lazy-load pdf.js (ES module) once. */
let pdfjsPromise;
export function getPdfjs() {
  pdfjsPromise ||= import('/vendor/pdf.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = '/vendor/pdf.worker.mjs';
    return lib;
  });
  return pdfjsPromise;
}

/** Open a PDF with pdf.js (with character maps + standard fonts for accurate text). */
export async function openPdf(file) {
  const pdfjs = await getPdfjs();
  return pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: '/vendor/cmaps/', cMapPacked: true,
    standardFontDataUrl: '/vendor/standard_fonts/',
  }).promise;
}

/**
 * Send a conversion job to the server. `body` is an object (sent as JSON) or a File (sent raw).
 * Returns { blob, name } or throws an Error with a friendly message.
 */
export async function serverConvert(endpoint, body) {
  const isFile = body instanceof Blob;
  let res;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: isFile ? { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(body.name || 'file') }
        : { 'Content-Type': 'application/json' },
      body: isFile ? body : JSON.stringify(body),
    });
  } catch { throw new Error('Could not reach the server. Check your connection.'); }
  if (!res.ok) {
    let msg = `Server error (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const name = res.headers.get('X-Output-Name');
  return { blob: await res.blob(), name: name ? decodeURIComponent(name) : null };
}

/** Which server engines are available: { pdf, office } */
let statusPromise;
export function engineStatus() {
  statusPromise ||= fetch('/api/convert/status').then((r) => r.json()).catch(() => ({ pdf: false, office: false }));
  return statusPromise;
}

/** Render PDF pages to images. onPage({ n, total, blob, url }) is called for each page. */
export async function renderPdfPages(file, { dpi = 220, type = 'image/jpeg', quality = 0.92, onPage }) {
  const doc = await openPdf(file);
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: dpi / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await canvasToBlob(canvas, type, quality);
    await onPage({ n, total: doc.numPages, blob, url: URL.createObjectURL(blob) });
    page.cleanup();
  }
  return doc.numPages;
}

/** Load a classic <script> once (for UMD libraries). */
const loaded = {};
export function loadScript(src) {
  loaded[src] ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Failed to load ' + src));
    document.head.appendChild(s);
  });
  return loaded[src];
}
