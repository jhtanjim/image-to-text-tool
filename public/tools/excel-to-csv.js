import { h, dropzone, statusLine, download, baseName } from '/js/ui.js';
import { previewTable } from '/tools/csv-to-excel.js';

const pad = (n) => String(n).padStart(2, '0');

// Convert an ExcelJS cell value to plain text the way Excel shows it.
function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // Excel dates are stored without a time zone; read them as UTC
    const d = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    const hasTime = v.getUTCHours() || v.getUTCMinutes() || v.getUTCSeconds();
    return hasTime ? `${d} ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}:${pad(v.getUTCSeconds())}` : d;
  }
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return v.result instanceof Date ? cellText({ value: v.result }) : String(v.result ?? ''); // formula
    if (v.text !== undefined) return typeof v.text === 'string' ? v.text : v.text.richText?.map((r) => r.text).join('') ?? ''; // hyperlink
    if (v.error) return v.error;
    return cell.text ?? '';
  }
  return String(v);
}

function sheetRows(ws) {
  const rows = [];
  const width = ws.actualColumnCount ? ws.columnCount : 0;
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const r = [];
    for (let c = 1; c <= width; c++) r.push(cellText(row.getCell(c)));
    rows[n - 1] = r;
  });
  for (let i = 0; i < rows.length; i++) rows[i] ||= new Array(width).fill('');
  // drop trailing empty rows
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

export default function mount(root) {
  const status = statusLine();
  const options = h(`<div class="row">
      <label class="field">Sheet<select name="sheet" disabled></select></label>
      <label class="field">Separator<select name="delim"><option value=",">Comma ( , )</option><option value=";">Semicolon ( ; )</option><option value="\t">Tab</option></select></label>
      <label class="check field inline"><input type="checkbox" name="bom" checked /> Excel-friendly UTF-8 (keeps বাংলা and other languages readable in Excel)</label>
    </div>`);
  const preview = h('<div></div>');
  const actions = h(`<div class="actions"><button class="btn primary big" disabled>Download .csv</button></div>`);
  const btn = actions.querySelector('button');
  const sheetSel = options.querySelector('[name=sheet]');
  let wb = null, file = null;

  const current = () => wb.getWorksheet(Number(sheetSel.value));
  function showSheet() {
    const rows = sheetRows(current());
    preview.innerHTML = rows.length ? previewTable(rows) : '<p class="hint">This sheet is empty.</p>';
    btn.disabled = !rows.length;
    status.set(`${rows.length} rows${rows.length > 50 ? ' · showing first 50' : ''}`);
  }

  const dz = dropzone({
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', multiple: false, paste: false, maxSizeMB: 50,
    title: 'Drop or upload an Excel file (.xlsx)', sub: 'Old .xls files: open in Excel and "Save As" .xlsx first',
    test: (f) => /\.xlsx$/i.test(f.name),
    onFiles: async (files, skipped) => {
      if (!files.length) return status.set(skipped ? 'Please choose an .xlsx file.' : '', !!skipped);
      file = files[0];
      status.set('Reading…');
      try {
        wb = new window.ExcelJS.Workbook();
        await wb.xlsx.load(new Uint8Array(await file.arrayBuffer()));
        sheetSel.innerHTML = wb.worksheets.map((ws) => `<option value="${ws.id}">${ws.name}</option>`).join('');
        sheetSel.disabled = wb.worksheets.length < 2;
        showSheet();
      } catch (e) {
        console.error(e);
        status.set('Could not read this file. Make sure it is a valid .xlsx file.', true);
      }
    },
  });
  sheetSel.onchange = showSheet;

  btn.onclick = () => {
    const ws = current();
    const csv = window.Papa.unparse(sheetRows(ws), { delimiter: options.querySelector('[name=delim]').value, newline: '\r\n' });
    const bom = options.querySelector('[name=bom]').checked ? '﻿' : '';
    const name = wb.worksheets.length > 1 ? `${baseName(file.name)}-${ws.name}` : baseName(file.name);
    download(new Blob([bom + csv], { type: 'text/csv;charset=utf-8' }), name.replace(/[\\/:*?"<>|]/g, '') + '.csv');
    status.set('CSV downloaded.');
  };

  root.append(dz, options, actions, status, preview);
}
