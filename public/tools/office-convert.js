import { h, esc, dropzone, statusLine, download, baseName, serverConvert, engineStatus, renderPdfPages, loadScript } from '/js/ui.js';

const KINDS = {
  word: { label: 'Word', exts: ['doc', 'docx', 'odt', 'rtf'] },
  excel: { label: 'Excel', exts: ['xls', 'xlsx', 'xlsm', 'ods', 'csv'] },
  ppt: { label: 'PowerPoint', exts: ['ppt', 'pptx', 'pps', 'ppsx', 'odp'] },
};

// mode: "word-pdf" | "excel-pdf" | "ppt-pdf" | "word-jpg" | "excel-jpg"
export default function mount(root, { mode }) {
  const [kind, target] = mode.split('-');
  const K = KINDS[kind];
  const toJpg = target === 'jpg';
  const status = statusLine();
  const list = h('<div class="results"></div>');
  const options = h(`<div class="row">
      ${kind === 'excel' ? '<label class="check field inline"><input type="checkbox" name="onePage" checked /> Fit each sheet on one page (no cut-off columns)</label>' : ''}
      ${toJpg ? `<label class="field">Image quality<select name="dpi"><option value="150">Normal (150 DPI)</option><option value="220" selected>High (220 DPI)</option><option value="300">Print (300 DPI)</option></select></label>` : ''}
    </div>`);
  const queue = [];
  let busy = false;

  const dz = dropzone({
    accept: K.exts.map((e) => '.' + e).join(','), paste: false, maxSizeMB: 50,
    title: `Drop or upload ${K.label} files`, sub: `${K.exts.map((e) => '.' + e).join(' ')} · up to 50 MB each · layout, fonts and images are kept`,
    test: (f) => K.exts.includes(f.name.split('.').pop().toLowerCase()),
    onFiles: (files, skipped) => {
      if (skipped) status.set(`${skipped} file(s) skipped: please upload ${K.exts.map((e) => '.' + e).join(', ')} files (max 50 MB).`, true);
      files.forEach((f) => queue.push(addRow(f)));
      run();
    },
  });

  function addRow(file) {
    const row = h(`<article class="result card">
        <div class="result-head">
          <span class="thumb doc t-${kind}" style="background:var(--surface-2);color:var(--text)">${esc(file.name.split('.').pop().toUpperCase())}</span>
          <div class="meta"><div class="name">${esc(file.name)}</div><div class="state">Waiting…</div><div class="bar"><span></span></div></div>
        </div>
        <div class="out"></div>
      </article>`);
    list.appendChild(row);
    return { file, row };
  }
  const setState = (row, text, cls = '', progress) => {
    const s = row.querySelector('.state'); s.textContent = text; s.className = 'state ' + cls;
    if (progress != null) row.querySelector('.bar span').style.width = progress * 100 + '%';
  };

  async function run() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const { file, row } = queue.shift();
      setState(row, 'Converting… (large files can take up to a minute)', '', 0.3);
      try {
        const onePage = options.querySelector('[name=onePage]')?.checked ? '1' : '0';
        const { blob } = await serverConvert(`/api/convert/office?type=${kind}&onePage=${onePage}`, file);
        const pdfName = baseName(file.name) + '.pdf';
        if (!toJpg) {
          const pages = await countPages(blob);
          setState(row, `Done · ${pages} page(s)`, 'done', 1);
          const btn = h('<div class="result-actions"><span class="stats"></span><button class="btn primary">Download PDF</button></div>');
          btn.querySelector('button').onclick = () => download(blob, pdfName);
          row.querySelector('.out').append(btn);
          download(blob, pdfName);
        } else {
          await toImages(blob, file, row);
        }
      } catch (e) {
        setState(row, 'Failed: ' + e.message, 'error', 0);
      }
    }
    busy = false;
    status.set('');
  }

  async function countPages(blob) {
    try {
      const { openPdf } = await import('/js/ui.js');
      return (await openPdf(blob)).numPages;
    } catch { return '?'; }
  }

  async function toImages(pdfBlob, file, row) {
    const dpi = Number(options.querySelector('[name=dpi]').value);
    const grid = h('<div class="preview-grid" style="margin-top:12px"></div>');
    const images = [];
    row.querySelector('.out').append(grid);
    const total = await renderPdfPages(pdfBlob, {
      dpi,
      onPage: ({ n, total, blob, url }) => {
        setState(row, `Rendering page ${n} of ${total}…`, '', 0.5 + (n / total) * 0.5);
        const name = `${baseName(file.name)}-page-${String(n).padStart(String(total).length, '0')}.jpg`;
        images.push({ name, blob });
        const card = h(`<div class="preview"><img alt="Page ${n}" src="${url}" /><div class="cap"><span>Page ${n}</span><button class="btn sm">Download</button></div></div>`);
        card.querySelector('button').onclick = () => download(blob, name);
        grid.appendChild(card);
      },
    });
    setState(row, `Done · ${total} image(s)`, 'done', 1);
    const bar = h('<div class="result-actions"><span class="stats"></span><button class="btn primary">Download all (ZIP)</button></div>');
    bar.querySelector('button').onclick = async () => {
      await loadScript('/vendor/jszip.js');
      const zip = new window.JSZip();
      images.forEach((i) => zip.file(i.name, i.blob));
      download(await zip.generateAsync({ type: 'blob' }), baseName(file.name) + '-images.zip');
    };
    row.querySelector('.out').prepend(bar);
  }

  root.append(dz, options, status, list);
  engineStatus().then((s) => {
    if (!s.office) status.set('Office conversion is not available on this server yet (LibreOffice is not installed).', true);
  });
}
