import { h, dropzone, statusLine, download, baseName, esc } from '/js/ui.js';

// Turn a cell into a real number only when it is clearly a plain number.
// Keeps IDs/phone numbers with leading zeros (e.g. 01712345678) and very long numbers as text.
export function toCell(v) {
  const s = v.trim();
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(s)) return Number(s);
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, '')); // 1,234,567.89
  return v;
}

export function previewTable(rows, max = 50) {
  const head = rows[0] || [];
  const body = rows.slice(1, max);
  return `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export default function mount(root) {
  const status = statusLine();
  const options = h(`<div class="row">
      <label class="check field inline"><input type="checkbox" name="header" checked /> First row is a header</label>
      <label class="check field inline"><input type="checkbox" name="numbers" checked /> Convert numbers (keeps leading zeros)</label>
    </div>`);
  const preview = h('<div></div>');
  const actions = h(`<div class="actions"><button class="btn primary big" disabled>Download .xlsx</button></div>`);
  const btn = actions.querySelector('button');
  let rows = null, file = null;

  const dz = dropzone({
    accept: '.csv,text/csv,.tsv,.txt', multiple: false, paste: false, maxSizeMB: 50,
    title: 'Drop or upload a CSV file', sub: 'Comma, semicolon and tab separated files are detected automatically',
    test: (f) => /\.(csv|tsv|txt)$/i.test(f.name) || f.type.includes('csv'),
    onFiles: (files) => {
      if (!files.length) return status.set('Please choose a .csv file.', true);
      file = files[0];
      status.set('Reading…');
      window.Papa.parse(file, {
        skipEmptyLines: 'greedy', encoding: 'UTF-8',
        complete: (res) => {
          rows = res.data;
          if (!rows.length) { status.set('This file is empty.', true); btn.disabled = true; return; }
          const cols = Math.max(...rows.map((r) => r.length));
          preview.innerHTML = previewTable(rows);
          btn.disabled = false;
          status.set(`${rows.length} rows × ${cols} columns · delimiter "${res.meta.delimiter === '\t' ? 'tab' : res.meta.delimiter}"${rows.length > 50 ? ' · showing first 50 rows' : ''}`);
        },
        error: (err) => status.set('Could not read this CSV: ' + err.message, true),
      });
    },
  });

  btn.onclick = async () => {
    btn.disabled = true;
    try {
      const header = options.querySelector('[name=header]').checked;
      const numbers = options.querySelector('[name=numbers]').checked;
      const wb = new window.ExcelJS.Workbook();
      wb.creator = 'TextSnap';
      const ws = wb.addWorksheet(baseName(file.name).slice(0, 31) || 'Sheet1');
      rows.forEach((r, i) => ws.addRow(numbers && !(header && i === 0) ? r.map(toCell) : r));
      if (header) {
        const first = ws.getRow(1);
        first.font = { bold: true };
        first.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
        ws.views = [{ state: 'frozen', ySplit: 1 }];
        const cols = Math.max(...rows.map((r) => r.length));
        ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
      }
      // Column widths based on content (capped)
      ws.columns.forEach((col) => {
        let max = 8;
        col.eachCell({ includeEmpty: false }, (c) => { max = Math.max(max, String(c.value ?? '').length + 2); });
        col.width = Math.min(max, 60);
      });
      const buf = await wb.xlsx.writeBuffer();
      download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), baseName(file.name) + '.xlsx');
      status.set('Excel file downloaded.');
    } catch (e) {
      console.error(e);
      status.set('Could not create the Excel file: ' + e.message, true);
    } finally { btn.disabled = false; }
  };

  root.append(dz, options, actions, status, preview);
}
