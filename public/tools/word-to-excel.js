import { h, dropzone, statusLine, download, baseName, loadScript, serverConvert } from '/js/ui.js';
import { previewTable } from '/tools/csv-to-excel.js';
import { tablesToXlsx, tableToCsv } from '/js/ai.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const kids = (el, name) => [...el.childNodes].filter((n) => n.namespaceURI === W && n.localName === name);
const attr = (el, name) => el?.getAttributeNS(W, name) ?? el?.getAttribute('w:' + name);

// Text of a paragraph, keeping tabs and line breaks
function paraText(p) {
  let s = '';
  p.querySelectorAll('*').forEach((n) => {
    if (n.namespaceURI !== W) return;
    if (n.localName === 't') s += n.textContent;
    else if (n.localName === 'tab') s += '\t';
    else if (n.localName === 'br' || n.localName === 'cr') s += '\n';
  });
  return s;
}

function cellText(tc) {
  // only this cell's own paragraphs (nested tables are extracted separately)
  const paras = [];
  const walk = (el) => {
    for (const n of el.children) {
      if (n.namespaceURI !== W) continue;
      if (n.localName === 'p') paras.push(paraText(n));
      else if (n.localName !== 'tbl') walk(n);
    }
  };
  walk(tc);
  return paras.join('\n').trim();
}

function readTable(tbl) {
  const rows = [];
  const above = []; // for vertically merged cells
  for (const tr of kids(tbl, 'tr')) {
    const row = [];
    for (const tc of kids(tr, 'tc')) {
      const pr = kids(tc, 'tcPr')[0];
      const span = Number(attr(pr && kids(pr, 'gridSpan')[0], 'val')) || 1;
      const vMerge = pr && kids(pr, 'vMerge')[0];
      const continued = vMerge && attr(vMerge, 'val') !== 'restart';
      const col = row.length;
      // A continued vertical merge shows the merged value again, so every row is complete in Excel
      row.push(continued ? (above[col] ?? '') : cellText(tc));
      for (let i = 1; i < span; i++) row.push('');
    }
    row.forEach((v, i) => { above[i] = v; });
    rows.push(row);
  }
  const cols = Math.max(0, ...rows.map((r) => r.length));
  rows.forEach((r) => { while (r.length < cols) r.push(''); });
  return rows;
}

export async function docxTables(buffer) {
  await loadScript('/vendor/jszip.js');
  const zip = await window.JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('This is not a valid Word (.docx) file.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const tables = [...doc.getElementsByTagNameNS(W, 'tbl')];
  return tables.map((tbl, i) => {
    const rows = readTable(tbl).filter((r) => r.some((c) => c !== ''));
    // Use the paragraph right before the table as its title if it is short (e.g. "Table 1: Sales")
    let prev = tbl.previousElementSibling, title = '';
    if (prev?.localName === 'p') { const t = paraText(prev).trim(); if (t && t.length <= 60) title = t; }
    return { title: title || `Table ${i + 1}`, headers: rows[0] || [], rows: rows.slice(1) };
  }).filter((t) => t.headers.length);
}

export default function mount(root) {
  const status = statusLine();
  const out = h('<div></div>');
  const actions = h(`<div class="actions" hidden><button class="btn primary big">Download .xlsx</button><button class="btn">Download CSV</button></div>`);
  const [xlsxBtn, csvBtn] = actions.querySelectorAll('button');
  let tables = [], file = null;

  const dz = dropzone({
    accept: '.docx,.doc,.odt,.rtf', multiple: false, paste: false, maxSizeMB: 50,
    title: 'Drop or upload a Word file', sub: '.docx works instantly in your browser · .doc, .odt, .rtf are converted first',
    test: (f) => /\.(docx|doc|odt|rtf)$/i.test(f.name),
    onFiles: async (files) => {
      if (!files.length) return status.set('Please choose a Word file (.docx, .doc, .odt, .rtf).', true);
      file = files[0]; out.innerHTML = ''; actions.hidden = true;
      try {
        let buf;
        if (/\.docx$/i.test(file.name)) buf = new Uint8Array(await file.arrayBuffer());
        else {
          status.set('Converting to .docx first…');
          buf = new Uint8Array(await (await serverConvert('/api/convert/office?type=word&to=docx', file)).blob.arrayBuffer());
        }
        status.set('Reading tables…');
        tables = await docxTables(buf);
        if (!tables.length) return status.set('No tables found in this document. Word to Excel copies the tables in a Word file.', true);
        out.innerHTML = tables.map((t) => `<h3 style="margin:18px 0 8px;font-size:1rem">${t.title.replace(/</g, '&lt;')} <span class="hint">(${t.rows.length} rows × ${t.headers.length} columns)</span></h3>${previewTable([t.headers, ...t.rows], 20)}`).join('');
        actions.hidden = false;
        csvBtn.textContent = tables.length > 1 ? 'Download CSVs (ZIP)' : 'Download CSV';
        status.set(`Found ${tables.length} table(s). Each becomes its own sheet in Excel.`);
      } catch (e) { console.error(e); status.set(e.message || 'Could not read this file.', true); }
    },
  });

  xlsxBtn.onclick = async () => download(await tablesToXlsx(tables), baseName(file.name) + '.xlsx');
  csvBtn.onclick = async () => {
    await loadScript('/vendor/papaparse.js');
    if (tables.length === 1) return download(new Blob([tableToCsv(tables[0])], { type: 'text/csv;charset=utf-8' }), baseName(file.name) + '.csv');
    await loadScript('/vendor/jszip.js');
    const zip = new window.JSZip();
    tables.forEach((t, i) => zip.file(`${i + 1}-${t.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 40)}.csv`, tableToCsv(t)));
    download(await zip.generateAsync({ type: 'blob' }), baseName(file.name) + '-tables.zip');
  };

  root.append(dz, status, actions, out);
}
