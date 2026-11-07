import { h, esc, dropzone, statusLine, download, baseName, loadScript, tests } from '/js/ui.js';
import { previewTable } from '/tools/csv-to-excel.js';
import { aiAvailable, aiExtract, tablesToXlsx, tableToCsv } from '/js/ai.js';

// mode: "pdf-excel" | "pdf-csv" | "jpg-excel"
export default function mount(root, { mode }) {
  const csv = mode === 'pdf-csv';
  const images = mode === 'jpg-excel';
  const status = statusLine();
  const out = h('<div></div>');
  const actions = h(`<div class="actions" hidden><button class="btn primary big">${csv ? 'Download CSV' : 'Download .xlsx'}</button>${csv ? '' : '<button class="btn">Download CSV</button>'}</div>`);
  const [mainBtn, altBtn] = actions.querySelectorAll('button');
  let tables = [], name = 'tables';

  const dz = dropzone({
    accept: images ? 'image/*' : '.pdf,application/pdf,image/*', multiple: false, paste: true, maxSizeMB: 24,
    title: images ? 'Drop, upload or paste a photo of a table' : 'Drop or upload a PDF (or an image)',
    sub: images ? 'Photos, screenshots and scans of tables, receipts and price lists' : 'Text and scanned PDFs · up to 24 MB',
    test: (f) => tests.isImage(f) || (!images && tests.isPdf(f)),
    onFiles: async (files) => {
      if (!files.length) return status.set(images ? 'Please choose an image.' : 'Please choose a PDF or an image.', true);
      if (!(await aiAvailable())) return status.set('This tool needs AI, which is not set up on this server yet (missing API key).', true);
      const file = files[0];
      name = baseName(file.name);
      out.innerHTML = ''; actions.hidden = true;
      status.set('AI is finding and reading the tables… (about 10–60 seconds)');
      try {
        const data = await aiExtract('tables', file);
        tables = (data.tables || []).filter((t) => t.headers?.length || t.rows?.length);
        if (!tables.length) return status.set('No tables were found in this file.', true);
        // Make every row as wide as the header so columns line up in Excel
        tables.forEach((t) => { const n = Math.max(t.headers.length, ...t.rows.map((r) => r.length)); [t.headers, ...t.rows].forEach((r) => { while (r.length < n) r.push(''); }); });
        out.innerHTML = tables.map((t, i) => `<h3 style="margin:18px 0 8px;font-size:1rem">${esc(t.title || 'Table ' + (i + 1))} <span class="hint">(${t.rows.length} rows × ${t.headers.length} columns)</span></h3>${previewTable([t.headers, ...t.rows], 30)}`).join('');
        actions.hidden = false;
        if (csv) mainBtn.textContent = tables.length > 1 ? 'Download CSVs (ZIP)' : 'Download CSV';
        status.set(`Found ${tables.length} table(s). Please check the preview before using the numbers.`);
      } catch (e) { console.error(e); status.set(e.message, true); }
    },
  });

  async function downloadCsv() {
    await loadScript('/vendor/papaparse.js');
    if (tables.length === 1) return download(new Blob([tableToCsv(tables[0])], { type: 'text/csv;charset=utf-8' }), name + '.csv');
    await loadScript('/vendor/jszip.js');
    const zip = new window.JSZip();
    tables.forEach((t, i) => zip.file(`${i + 1}-${(t.title || 'table').replace(/[\\/:*?"<>|]/g, '').slice(0, 40)}.csv`, tableToCsv(t)));
    download(await zip.generateAsync({ type: 'blob' }), name + '-tables.zip');
  }
  mainBtn.onclick = async () => (csv ? downloadCsv() : download(await tablesToXlsx(tables), name + '.xlsx'));
  if (altBtn) altBtn.onclick = downloadCsv;

  root.append(dz, status, actions, out);
  aiAvailable().then((ok) => { if (!ok) status.set('This tool needs AI, which is not set up on this server yet (missing API key).', true); });
}
