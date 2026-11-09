import { h, dropzone, statusLine, download, canvasToBlob, openPdf, loadScript, baseName, tests } from '/js/ui.js';

export default function mount(root) {
  const status = statusLine();
  const options = h(`<div class="row">
      <label class="field">Image quality
        <select name="dpi">
          <option value="150">Normal (150 DPI)</option>
          <option value="220" selected>High (220 DPI)</option>
          <option value="300">Print (300 DPI)</option>
        </select>
      </label>
      <label class="field">Format
        <select name="fmt"><option value="jpg" selected>JPG</option><option value="png">PNG (lossless)</option></select>
      </label>
    </div>`);
  const actions = h(`<div class="actions"><button class="btn primary big" disabled>Convert to images</button><button class="btn" disabled>Download all (ZIP)</button></div>`);
  const [convertBtn, zipBtn] = actions.querySelectorAll('button');
  const grid = h('<div class="preview-grid"></div>');
  let file = null;
  let pages = []; // { name, blob, url }

  const dz = dropzone({
    accept: '.pdf,application/pdf', multiple: false, paste: false, maxSizeMB: 100,
    title: 'Drop or upload a PDF', sub: 'Every page becomes an image', test: tests.isPdf,
    onFiles: (files, skipped) => {
      if (!files.length) return status.set('Please choose a PDF file (max 100 MB).', true);
      file = files[0];
      reset();
      convertBtn.disabled = false;
      status.set(`Selected: ${file.name}. Click "Convert to images".`);
    },
  });

  function reset() {
    pages.forEach((p) => URL.revokeObjectURL(p.url));
    pages = []; grid.innerHTML = ''; zipBtn.disabled = true;
  }

  convertBtn.onclick = async () => {
    convertBtn.disabled = true; reset();
    const dpi = Number(options.querySelector('[name=dpi]').value);
    const fmt = options.querySelector('[name=fmt]').value;
    try {
      const doc = await openPdf(file);
      for (let n = 1; n <= doc.numPages; n++) {
        status.set(`Rendering page ${n} of ${doc.numPages}…`);
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale: dpi / 72 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // JPG has no transparency
        await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise; // keeps working in background tabs
        const blob = await canvasToBlob(canvas, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.92);
        const name = `${baseName(file.name)}-page-${String(n).padStart(String(doc.numPages).length, '0')}.${fmt}`;
        const url = URL.createObjectURL(blob);
        pages.push({ name, blob, url });
        const card = h(`<div class="preview"><img alt="Page ${n}" src="${url}" /><div class="cap"><span>Page ${n}</span><button class="btn sm">Download</button></div></div>`);
        card.querySelector('button').onclick = () => download(blob, name);
        grid.appendChild(card);
        page.cleanup();
      }
      zipBtn.disabled = false;
      status.set(`Done! ${doc.numPages} page(s) converted.`);
    } catch (err) {
      console.error(err);
      status.set(err.name === 'PasswordException' ? 'This PDF is password-protected.' : 'Could not read this PDF: ' + err.message, true);
    } finally { convertBtn.disabled = !file; }
  };

  zipBtn.onclick = async () => {
    zipBtn.disabled = true;
    status.set('Creating ZIP…');
    await loadScript('/vendor/jszip.js');
    const zip = new window.JSZip();
    pages.forEach((p) => zip.file(p.name, p.blob));
    download(await zip.generateAsync({ type: 'blob' }), baseName(file.name) + '-images.zip');
    status.set('ZIP downloaded.');
    zipBtn.disabled = false;
  };

  root.append(dz, options, actions, status, grid);
}
