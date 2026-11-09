import { h, dropzone, statusLine, download, copyText, openPdf, baseName, tests, bengaliTextBroken } from '/js/ui.js';

// A page's text layer is "unusable" if it is (almost) empty, or full of private-use / replacement characters.
// That happens with scanned PDFs and with old Bengali PDFs made with non-Unicode fonts (e.g. SutonnyMJ).
function textLooksBroken(text) {
  const t = text.replace(/\s/g, '');
  if (t.length < 15) return true;
  const bad = (t.match(/[-�]/g) || []).length;
  return bad / t.length > 0.05;
}

// Old Bengali "ANSI" fonts store Bengali as Latin letters with lots of symbols like ©, ¨, ‡, ˆ, Š.
function looksLikeLegacyBengali(text) {
  const t = text.replace(/\s/g, '');
  if (t.length < 40) return false;
  const odd = (t.match(/[¡-ÿŒ-ƒˆ-˜–-›]/g) || []).length;
  return odd / t.length > 0.12;
}

export default function mount(root) {
  const status = statusLine();
  const options = h(`<div class="row">
      <label class="field">Language (for scanned pages)
        <select name="lang">
          <option value="eng+ben" selected>English + Bengali</option>
          <option value="eng">English</option><option value="ben">Bengali</option>
          <option value="ara+eng">Arabic</option><option value="hin+eng">Hindi</option>
          <option value="chi_sim+eng">Chinese</option><option value="jpn+eng">Japanese</option>
        </select>
      </label>
      <label class="check field inline"><input type="checkbox" name="forceOcr" /> Read every page with OCR</label>
    </div>`);
  const actions = h(`<div class="actions"><button class="btn primary big" disabled>Extract text</button></div>`);
  const convertBtn = actions.querySelector('button');
  const output = h(`<div hidden>
      <textarea class="text big-text" spellcheck="false"></textarea>
      <div class="result-actions"><span class="stats"></span><button class="btn copy">Copy</button><button class="btn primary dl">Download .txt</button></div>
    </div>`);
  const ta = output.querySelector('textarea');
  let file = null;
  let worker = null, workerLang = null;

  const dz = dropzone({
    accept: '.pdf,application/pdf', multiple: false, paste: false, maxSizeMB: 100,
    title: 'Drop or upload a PDF', sub: 'Text PDFs and scanned PDFs both work', test: tests.isPdf,
    onFiles: (files) => {
      if (!files.length) return status.set('Please choose a PDF file (max 100 MB).', true);
      file = files[0]; convertBtn.disabled = false; output.hidden = true;
      status.set(`Selected: ${file.name}. Click "Extract text".`);
    },
  });

  let onProgress = null;
  async function ocrPage(page, lang, label) {
    if (!worker || workerLang !== lang) {
      if (worker) await worker.terminate();
      status.set('Loading OCR engine… (first time only, a few seconds)');
      worker = await Tesseract.createWorker(lang, 1, { logger: (m) => onProgress?.(m) });
      workerLang = lang;
    }
    const viewport = page.getViewport({ scale: 300 / 72 }); // 300 DPI for good OCR
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // intent "print" doesn't wait for animation frames, so it keeps working while the tab is in the background
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise;
    onProgress = (m) => { if (m.status === 'recognizing text') status.set(`${label} Reading with OCR… ${Math.round(m.progress * 100)}%`); };
    const { data } = await worker.recognize(canvas);
    onProgress = null;
    let text = data.text.trim();
    if (lang.includes('ben')) {
      const { repairBengali } = await import('/js/ocr.js');
      text = (await repairBengali({ text: data.text, lines: data.lines || [], input: canvas }, (msg) => status.set(`${label} ${msg}`))).trim();
    }
    return text;
  }

  convertBtn.onclick = async () => {
    convertBtn.disabled = true;
    const lang = options.querySelector('[name=lang]').value;
    const forceOcr = options.querySelector('[name=forceOcr]').checked;
    try {
      const doc = await openPdf(file);
      const parts = [];
      let ocrCount = 0, legacy = false;
      for (let n = 1; n <= doc.numPages; n++) {
        status.set(`Reading page ${n} of ${doc.numPages}…`);
        const page = await doc.getPage(n);
        const content = await page.getTextContent();
        let text = content.items.map((i) => (i.str ?? '') + (i.hasEOL ? '\n' : '')).join('').replace(/[ \t]+\n/g, '\n').trim();
        const legacyPage = looksLikeLegacyBengali(text) || bengaliTextBroken(text);
        legacy ||= legacyPage;
        if (forceOcr || textLooksBroken(text) || legacyPage) {
          status.set(`Page ${n} of ${doc.numPages}: reading with OCR…`);
          text = await ocrPage(page, lang, `Page ${n} of ${doc.numPages}:`);
          ocrCount++;
        }
        parts.push(doc.numPages > 1 ? `--- Page ${n} ---\n${text}` : text);
        page.cleanup();
      }
      ta.value = parts.join('\n\n');
      const words = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
      output.querySelector('.stats').textContent = `${doc.numPages} page(s) · ${words} words${ocrCount ? ` · ${ocrCount} page(s) read with OCR` : ''}`;
      output.hidden = false;
      status.set(legacy ? 'Done. The Bengali text inside this PDF was stored in a scrambled way, so those pages were read with OCR for correct spelling.' : 'Done!');
    } catch (err) {
      console.error(err);
      status.set(err.name === 'PasswordException' ? 'This PDF is password-protected.' : 'Could not read this PDF: ' + err.message, true);
    } finally { convertBtn.disabled = !file; }
  };

  output.querySelector('.copy').onclick = (e) => copyText(ta.value, e.currentTarget);
  output.querySelector('.dl').onclick = () => download(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }), baseName(file.name) + '.txt');

  root.append(dz, options, actions, status, output);
}
