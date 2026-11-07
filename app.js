/* TextSnap — client-side image to text (OCR) using Tesseract.js */
(() => {
  const MAX_FILES = 20;
  const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

  const $ = (sel) => document.querySelector(sel);
  const dropzone = $('#dropzone');
  const fileInput = $('#fileInput');
  const browseBtn = $('#browseBtn');
  const urlForm = $('#urlForm');
  const urlInput = $('#urlInput');
  const langSelect = $('#langSelect');
  const enhanceBox = $('#enhance');
  const convertBtn = $('#convertBtn');
  const clearBtn = $('#clearBtn');
  const statusEl = $('#status');
  const resultsEl = $('#results');
  const tpl = $('#resultTpl');
  const bulkBar = $('#bulkBar');
  const bulkCount = $('#bulkCount');

  /** @type {{id:number, blob:Blob, name:string, url:string, status:'pending'|'working'|'done'|'error', text:string, el:HTMLElement}[]} */
  let items = [];
  let nextId = 1;
  let busy = false;

  // ---------- OCR worker (one shared worker, recreated when language changes) ----------
  let worker = null;
  let workerLang = null;
  let progressHandler = null;

  async function getWorker(lang) {
    if (worker && workerLang === lang) return worker;
    if (worker) { await worker.terminate(); worker = null; }
    setStatus(`Loading OCR engine (${langSelect.selectedOptions[0]?.text || lang})… first time can take a few seconds.`);
    worker = await Tesseract.createWorker(lang, 1, {
      logger: (m) => progressHandler && progressHandler(m),
    });
    workerLang = lang;
    return worker;
  }

  // ---------- Image preprocessing ----------
  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this image.')); };
      img.src = url;
    });
  }

  // Upscale small images, grayscale, then adaptive threshold (Bradley) so text becomes black on white
  // even with highlights, grey overlays, shadows or uneven lighting.
  async function preprocess(blob) {
    const img = await loadImage(blob);
    let w = img.naturalWidth, h = img.naturalHeight;
    const longest = Math.max(w, h);
    // Aim for ~2500px on the long side: small screenshots get up to 4x bigger, huge photos get shrunk.
    const scale = Math.min(4, 2500 / longest);
    const s = longest < 2500 ? Math.max(1, scale) : scale;
    w = Math.round(w * s); h = Math.round(h * s);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h); // flatten transparency onto white
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    const n = w * h;

    // 1) grayscale
    const gray = new Float32Array(n);
    for (let i = 0, j = 0; j < n; i += 4, j++) gray[j] = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];

    // 2) integral image for fast local means
    const integral = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
      let rowSum = 0;
      for (let x = 0; x < w; x++) {
        rowSum += gray[y * w + x];
        integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
      }
    }

    // 3) Bradley adaptive threshold: a pixel is "ink" if it is clearly darker than its neighbourhood
    const half = Math.max(8, Math.round(Math.max(w, h) / 32));
    const T = 0.15;
    const out = new Uint8Array(n);
    let inkCount = 0;
    for (let y = 0; y < h; y++) {
      const y1 = Math.max(0, y - half), y2 = Math.min(h - 1, y + half);
      for (let x = 0; x < w; x++) {
        const x1 = Math.max(0, x - half), x2 = Math.min(w - 1, x + half);
        const count = (x2 - x1 + 1) * (y2 - y1 + 1);
        const sum = integral[(y2 + 1) * (w + 1) + (x2 + 1)] - integral[y1 * (w + 1) + (x2 + 1)]
                  - integral[(y2 + 1) * (w + 1) + x1] + integral[y1 * (w + 1) + x1];
        const ink = gray[y * w + x] * count < sum * (1 - T);
        out[y * w + x] = ink ? 0 : 255;
        if (ink) inkCount++;
      }
    }

    // 4) Light text on a dark background → mostly "ink"; flip so text is black on white.
    const invert = inkCount > n * 0.5;
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      const v = invert ? 255 - out[j] : out[j];
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  // ---------- AI mode (server → Claude) ----------
  let aiAvailable = false;
  const currentMode = () => document.querySelector('input[name="mode"]:checked').value;

  // Shrink to ≤2000px and JPEG-encode before upload: faster, cheaper, and well under the API's size limit.
  async function toAiPayload(blob) {
    const img = await loadImage(blob);
    const s = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * s);
    canvas.height = Math.round(img.naturalHeight * s);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { image: canvas.toDataURL('image/jpeg', 0.92).split(',')[1], mediaType: 'image/jpeg' };
  }

  async function recognizeAi(item) {
    setItemState(item, 'working', 'AI is reading the image…', 0.35);
    const payload = await toAiPayload(item.blob);
    const res = await fetch('/api/ocr-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let data;
    try { data = await res.json(); } catch { throw new Error(`Server error (${res.status})`); }
    if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
    return data;
  }

  async function loadConfig() {
    const aiLabel = $('#aiModeLabel');
    const aiRadio = aiLabel.querySelector('input');
    try {
      const res = await fetch('/api/config');
      aiAvailable = res.ok && (await res.json()).ai === true;
    } catch { aiAvailable = false; }
    aiRadio.disabled = !aiAvailable;
    aiLabel.classList.toggle('disabled', !aiAvailable);
    if (!aiAvailable) $('#aiModeNote').textContent = 'Not available on this server yet (needs an API key).';
  }

  document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => {
    $('#fastOptions').hidden = currentMode() === 'ai';
    items.forEach((i) => { if (i.status === 'done') setItemState(i, 'pending', 'Ready (mode changed)', 0); });
    refreshControls();
  }));

  // ---------- Adding images ----------
  function addBlobs(blobs) {
    let skipped = 0;
    for (const blob of blobs) {
      if (!blob.type.startsWith('image/')) { skipped++; continue; }
      if (blob.size > MAX_SIZE) { skipped++; continue; }
      if (items.length >= MAX_FILES) { skipped++; continue; }
      const item = {
        id: nextId++,
        blob,
        name: blob.name || `pasted-image-${nextId - 1}.png`,
        url: URL.createObjectURL(blob),
        status: 'pending',
        text: '',
      };
      item.el = renderItem(item);
      items.push(item);
    }
    if (skipped) setStatus(`${skipped} file(s) skipped (not an image, over 10 MB, or over the ${MAX_FILES}-image limit).`, true);
    else setStatus(`${items.filter(i => i.status === 'pending').length} image(s) ready. Click Convert.`);
    refreshControls();
  }

  function renderItem(item) {
    const el = tpl.content.firstElementChild.cloneNode(true);
    el.querySelector('.thumb').src = item.url;
    el.querySelector('.name').textContent = item.name;
    el.querySelector('.name').title = item.name;
    el.querySelector('.state').textContent = 'Ready';
    const textarea = el.querySelector('.text');
    textarea.addEventListener('input', () => { item.text = textarea.value; updateStats(item); });
    el.querySelector('.remove').addEventListener('click', () => removeItem(item));
    el.querySelector('.copy').addEventListener('click', (e) => copyText(item.text, e.currentTarget));
    el.querySelector('.download').addEventListener('click', () => downloadText(item.text, baseName(item.name) + '.txt'));
    resultsEl.appendChild(el);
    return el;
  }

  function removeItem(item) {
    if (item.status === 'working') return;
    URL.revokeObjectURL(item.url);
    item.el.remove();
    items = items.filter((i) => i !== item);
    refreshControls();
    if (!items.length) setStatus('');
  }

  function setItemState(item, status, label, progress) {
    item.status = status;
    const state = item.el.querySelector('.state');
    state.textContent = label;
    state.className = 'state ' + status;
    if (status === 'warn') item.status = 'done'; // finished, just flagged
    if (progress != null) item.el.querySelector('.bar span').style.width = Math.round(progress * 100) + '%';
  }

  function updateStats(item) {
    const t = item.text.trim();
    const words = t ? t.split(/\s+/).length : 0;
    item.el.querySelector('.stats').textContent = `${words} words · ${item.text.length} characters`;
    const has = t.length > 0;
    item.el.querySelector('.copy').disabled = !has;
    item.el.querySelector('.download').disabled = !has;
  }

  // ---------- Automatic language detection ----------
  // Tesseract's own script detector is unreliable on short text, so we detect by trying:
  // read as English+Bengali first; if confidence is low, try other scripts (each mixed with English)
  // and keep whichever reads best. Extra language files download only when needed, then stay cached.
  const LANG_NAMES = {
    'eng+ben': 'English + Bengali', 'ara+eng': 'Arabic', 'hin+eng': 'Hindi', 'urd+eng': 'Urdu',
    'rus+eng': 'Russian', 'chi_sim+eng': 'Chinese', 'jpn+eng': 'Japanese', 'kor+eng': 'Korean',
  };
  const AUTO_FIRST = 'eng+ben';
  const AUTO_OTHERS = ['ara+eng', 'hin+eng', 'rus+eng', 'chi_sim+eng', 'jpn+eng', 'kor+eng'];
  const GOOD_ENOUGH = 70;

  async function recognizeWith(lang, input) {
    const w = await getWorker(lang);
    const { data } = await w.recognize(input);
    let text = data.text.trim();
    // Tesseract puts spaces between Chinese/Japanese characters; those languages don't use them.
    if (/chi_sim|jpn/.test(lang)) text = text.replace(/(?<=[぀-ヿ㐀-鿿＀-￯])[ \t]+(?=[぀-ヿ㐀-鿿＀-￯])/g, '');
    return { text, confidence: Math.round(data.confidence), lang };
  }

  async function recognizeAuto(input, item) {
    let best = await recognizeWith(AUTO_FIRST, input);
    if (best.confidence >= GOOD_ENOUGH || !best.text) return best;
    for (const lang of AUTO_OTHERS) {
      setItemState(item, 'working', `Detecting language… trying ${LANG_NAMES[lang]}`, 0);
      const r = await recognizeWith(lang, input);
      if (r.confidence > best.confidence) best = r;
      if (best.confidence >= GOOD_ENOUGH) break;
    }
    // Remember the winner so the next image in this batch tries it first
    if (best.lang !== AUTO_FIRST) {
      AUTO_OTHERS.splice(AUTO_OTHERS.indexOf(best.lang), 1);
      AUTO_OTHERS.unshift(best.lang);
    }
    return best;
  }

  // ---------- Conversion ----------
  async function convertAll() {
    const queue = items.filter((i) => i.status === 'pending' || i.status === 'error');
    if (!queue.length || busy) return;
    busy = true;
    refreshControls();

    const aiMode = currentMode() === 'ai';
    const lang = langSelect.value;
    try {
      if (!aiMode && lang !== 'auto') await getWorker(lang);
      let n = 0;
      for (const item of queue) {
        if (!items.includes(item)) continue; // removed meanwhile
        n++;
        setStatus(`Converting ${n} of ${queue.length}…`);
        setItemState(item, 'working', 'Preparing…', 0);
        progressHandler = (m) => {
          if (m.status === 'recognizing text') setItemState(item, 'working', `Recognizing… ${Math.round(m.progress * 100)}%`, m.progress);
        };
        try {
          if (aiMode) {
            const data = await recognizeAi(item);
            item.text = data.text;
            item.el.querySelector('.text').value = item.text;
            updateStats(item);
            setItemState(item, item.text ? 'done' : 'warn',
              !item.text ? 'Done · no text found' : data.truncated ? 'Done (AI) · text was very long and got cut off' : 'Done · AI high accuracy', 1);
            continue;
          }
          const input = enhanceBox.checked ? await preprocess(item.blob) : item.blob;
          const result = lang === 'auto'
            ? await recognizeAuto(input, item)
            : await recognizeWith(lang, input);
          item.text = result.text;
          item.el.querySelector('.text').value = item.text;
          updateStats(item);
          const conf = result.confidence;
          const detected = lang === 'auto' ? ` · detected ${LANG_NAMES[result.lang]}` : '';
          const label = !item.text ? 'Done · no text found'
            : conf < 60 ? `Low confidence (${conf}%)${detected}. Try AI mode for this image.`
            : `Done · ${conf}% confidence${detected}`;
          setItemState(item, conf < 60 || !item.text ? 'warn' : 'done', label, 1);
        } catch (err) {
          console.error(err);
          setItemState(item, 'error', 'Failed: ' + (err.message || err), 0);
        }
      }
      setStatus('All done. Edit, copy or download your text below.');
    } catch (err) {
      console.error(err);
      setStatus('Could not load the OCR engine. Check your internet connection and try again.', true);
      // Force a fresh worker next time
      worker = null; workerLang = null;
    } finally {
      progressHandler = null;
      busy = false;
      refreshControls();
    }
  }

  // ---------- Helpers ----------
  function setStatus(msg, isError = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', isError);
  }

  function refreshControls() {
    const pending = items.some((i) => i.status === 'pending' || i.status === 'error');
    convertBtn.disabled = busy || !pending;
    convertBtn.textContent = busy ? 'Converting…' : 'Convert';
    clearBtn.disabled = busy || !items.length;
    langSelect.disabled = busy;
    const done = items.filter((i) => i.status === 'done' && i.text);
    bulkBar.hidden = done.length < 2;
    bulkCount.textContent = `${done.length} images converted`;
  }

  function baseName(name) { return name.replace(/\.[^.]+$/, '') || 'text'; }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
    if (btn) { const old = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => (btn.textContent = old), 1200); }
  }

  function downloadText(text, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function allText() {
    return items.filter((i) => i.text).map((i) => `===== ${i.name} =====\n${i.text}`).join('\n\n');
  }

  // ---------- Events ----------
  browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', () => { addBlobs([...fileInput.files]); fileInput.value = ''; });

  ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', (e) => addBlobs([...e.dataTransfer.files]));
  // Stop the browser from opening images dropped outside the zone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  document.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.items || [])]
      .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
      .map((it) => it.getAsFile());
    if (files.length) { e.preventDefault(); addBlobs(files); }
  });

  urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;
    setStatus('Fetching image…');
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const blob = await res.blob();
      if (!blob.type.startsWith('image/')) throw new Error('That link is not an image.');
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'image-from-url');
      addBlobs([new File([blob], name, { type: blob.type })]);
      urlInput.value = '';
    } catch (err) {
      setStatus(`Couldn't load that URL (${err.message}). Many sites block direct access. Save the image and upload it instead.`, true);
    }
  });

  convertBtn.addEventListener('click', convertAll);
  clearBtn.addEventListener('click', () => {
    [...items].forEach(removeItem);
    setStatus('');
  });
  langSelect.addEventListener('change', () => {
    // Re-run already-converted images if the user switches language
    items.forEach((i) => { if (i.status === 'done') setItemState(i, 'pending', 'Ready (language changed)', 0); });
    refreshControls();
  });

  $('#copyAllBtn').addEventListener('click', (e) => copyText(allText(), e.currentTarget));
  $('#downloadAllBtn').addEventListener('click', () => downloadText(allText(), 'textsnap-results.txt'));

  // Theme toggle (remembered per browser)
  const root = document.documentElement;
  try { const t = localStorage.getItem('theme'); if (t) root.dataset.theme = t; } catch {}
  $('#themeToggle').addEventListener('click', () => {
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch {}
  });

  $('#year').textContent = new Date().getFullYear();
  loadConfig();
})();
