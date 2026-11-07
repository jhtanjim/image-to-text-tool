// AI tools: send a PDF/image to the server, get structured JSON back, and build Word / Excel / CSV / HTML files.
import { loadImage, loadScript, esc } from '/js/ui.js';
import { toCell } from '/tools/csv-to-excel.js';

let cfg;
export async function aiAvailable() {
  cfg ||= fetch('/api/config').then((r) => r.json()).catch(() => ({ ai: false }));
  return (await cfg).ai === true;
}

// Images are shrunk to ≤2000px JPEG before upload: faster, cheaper, and plenty for reading text.
async function prepareImage(file) {
  const img = await loadImage(file);
  const s = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
}

/** Run an AI task on a PDF or image. Returns the structured data. */
export async function aiExtract(task, file, { target } = {}) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (isPdf && file.size > 24 * 1048576) throw new Error('This PDF is too large for AI processing (max 24 MB). Try splitting it.');
  const body = isPdf ? file : await prepareImage(file);
  const q = new URLSearchParams({ task, ...(target ? { target } : {}) });
  let res;
  try {
    res = await fetch('/api/ai/extract?' + q, { method: 'POST', headers: { 'Content-Type': isPdf ? 'application/pdf' : 'image/jpeg' }, body });
  } catch { throw new Error('Could not reach the server. Check your connection.'); }
  let json;
  try { json = await res.json(); } catch { throw new Error(`Server error (${res.status})`); }
  if (!res.ok) throw new Error(json.error || `Server error (${res.status})`);
  return json.data;
}

// ------------------------------------------------------------------ Word (.docx)
const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', cs: 'Nirmala UI', eastAsia: 'Microsoft YaHei' };
const A4_TEXT_WIDTH = 9026; // twips: A4 width minus 1-inch margins

export async function blocksToDocx(doc) {
  await loadScript('/vendor/docx.js');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, LevelFormat, AlignmentType, PageBreak, ShadingType } = window.docx;
  const HEAD = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3];
  const run = (text, extra = {}) => new TextRun({ text, font: FONT, ...extra });
  const children = [];
  let listId = 0;
  for (const b of doc.blocks || []) {
    if (b.type === 'heading') children.push(new Paragraph({ heading: HEAD[Math.min(3, Math.max(1, b.level || 1))], children: [run(b.text)] }));
    else if (b.type === 'paragraph') children.push(new Paragraph({ spacing: { after: 120 }, children: [run(b.text)] }));
    else if (b.type === 'list') {
      const ref = b.ordered ? `num-${listId++}` : null; // each numbered list restarts at 1
      for (const item of b.items || []) {
        children.push(new Paragraph({ children: [run(item)], ...(ref ? { numbering: { reference: ref, level: 0 } } : { bullet: { level: 0 } }) }));
      }
    } else if (b.type === 'table' && b.rows?.length) {
      const cols = Math.max(...b.rows.map((r) => r.length));
      const w = Math.floor(A4_TEXT_WIDTH / cols); // explicit column widths: without them some apps squash the table
      const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
      children.push(new Table({
        width: { size: A4_TEXT_WIDTH, type: WidthType.DXA },
        columnWidths: Array(cols).fill(w),
        borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
        rows: b.rows.map((row, ri) => new TableRow({
          tableHeader: ri === 0,
          children: Array.from({ length: cols }, (_, ci) => new TableCell({
            width: { size: w, type: WidthType.DXA },
            ...(ri === 0 ? { shading: { type: ShadingType.CLEAR, fill: 'E8EAF6', color: 'auto' } } : {}),
            children: [new Paragraph({ children: [run(row[ci] ?? '', { bold: ri === 0 })] })],
          })),
        })),
      }));
      children.push(new Paragraph({ children: [] }));
    } else if (b.type === 'page_break') children.push(new Paragraph({ children: [new PageBreak()] }));
  }
  const numbering = { config: Array.from({ length: listId }, (_, i) => ({
    reference: `num-${i}`,
    levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.START, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
  })) };
  return Packer.toBlob(new Document({ title: doc.title || 'Document', numbering, sections: [{ children }] }));
}

// ------------------------------------------------------------------ HTML
export function blocksToHtml(doc) {
  const body = (doc.blocks || []).map((b) => {
    if (b.type === 'heading') { const l = Math.min(3, Math.max(1, b.level || 1)); return `<h${l}>${esc(b.text)}</h${l}>`; }
    if (b.type === 'paragraph') return `<p>${esc(b.text)}</p>`;
    if (b.type === 'list') { const t = b.ordered ? 'ol' : 'ul'; return `<${t}>${(b.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</${t}>`; }
    if (b.type === 'table' && b.rows?.length) {
      const [head, ...rows] = b.rows;
      return `<table><thead><tr>${head.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
    if (b.type === 'page_break') return '<hr class="page-break">';
    return '';
  }).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title || 'Document')}</title>
<style>
  body { max-width: 820px; margin: 40px auto; padding: 0 16px; font: 16px/1.6 "Segoe UI", "Nirmala UI", "Noto Sans Bengali", Roboto, Arial, sans-serif; color: #1a1d29; }
  h1, h2, h3 { line-height: 1.25; } table { border-collapse: collapse; width: 100%; margin: 16px 0; }
  th, td { border: 1px solid #ccd; padding: 6px 10px; text-align: left; } th { background: #eef0ff; }
  hr.page-break { border: 0; border-top: 1px dashed #ccd; margin: 32px 0; }
  @media print { hr.page-break { break-after: page; border: 0; } }
</style></head>
<body>
${body}
</body></html>`;
}

// ------------------------------------------------------------------ Excel / CSV
const sheetName = (s, used) => {
  let n = (s || 'Table').replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Table';
  let k = n, i = 2;
  while (used.has(k.toLowerCase())) k = `${n} ${i++}`;
  used.add(k.toLowerCase());
  return k;
};

function styleSheet(ws, cols) {
  const head = ws.getRow(1);
  head.font = { bold: true };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  if (cols) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
  ws.columns.forEach((col) => {
    let max = 8;
    col.eachCell({ includeEmpty: false }, (c) => { max = Math.max(max, String(c.text ?? c.value ?? '').length + 2); });
    col.width = Math.min(max, 60);
  });
}

/** tables: [{ title, headers, rows }] → .xlsx Blob (one sheet per table) */
export async function tablesToXlsx(tables, { numbers = true } = {}) {
  await loadScript('/vendor/exceljs.js');
  const wb = new window.ExcelJS.Workbook();
  wb.creator = 'TextSnap';
  const used = new Set();
  tables.forEach((t, i) => {
    const ws = wb.addWorksheet(sheetName(t.title || `Table ${i + 1}`, used));
    const cols = Math.max(t.headers.length, ...t.rows.map((r) => r.length));
    ws.addRow(t.headers);
    t.rows.forEach((r) => {
      const row = ws.addRow(numbers ? r.map(cleanNumber) : r);
      // Keep percentages looking like percentages (0.45 shown as 45%)
      if (numbers) r.forEach((v, i) => { if (typeof v === 'string' && /%\s*\)?$/.test(v.trim()) && typeof row.getCell(i + 1).value === 'number') row.getCell(i + 1).numFmt = '0.##%'; });
    });
    styleSheet(ws, cols);
  });
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// "৳ 1,250.00", "$12.5", "(300.00)", "-45%" → numbers where it is safe; everything else stays text.
const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
function cleanNumber(v) {
  if (typeof v !== 'string') return v;
  const s = v.trim().replace(/[০-৯]/g, (d) => BN_DIGITS.indexOf(d));
  const neg = /^\(.*\)$/.test(s);
  const core = s.replace(/^\(|\)$/g, '').replace(/^[৳$€£₹¥]\s?|\s?(BDT|USD|Tk\.?|৳)$/gi, '').trim();
  if (/^-?\d+(\.\d+)?%$/.test(core)) return Number(core.slice(0, -1)) / 100;
  const n = toCell(core);
  if (typeof n === 'number') return neg ? -n : n;
  return v;
}

export function tableToCsv(t) {
  return '﻿' + window.Papa.unparse([t.headers, ...t.rows], { newline: '\r\n' });
}

// ------------------------------------------------------------------ Bank statements
const round2 = (n) => Math.round(n * 100) / 100;

/** Re-add every row and compare with the printed balances. Returns { rowIssues: Set(index), summary } */
export function checkBank(st) {
  const tx = st.transactions || [];
  const issues = new Set();
  let prev = st.opening_balance;
  tx.forEach((t, i) => {
    const expected = prev == null ? null : round2(prev + (t.credit || 0) - (t.debit || 0));
    if (t.balance != null && expected != null && Math.abs(expected - t.balance) > 0.011) issues.add(i);
    if (t.debit != null && t.credit != null && t.debit && t.credit) issues.add(i);
    prev = t.balance != null ? t.balance : expected;
  });
  const totalIn = round2(tx.reduce((s, t) => s + (t.credit || 0), 0));
  const totalOut = round2(tx.reduce((s, t) => s + (t.debit || 0), 0));
  let closingOk = null;
  if (st.opening_balance != null && st.closing_balance != null) closingOk = Math.abs(round2(st.opening_balance + totalIn - totalOut) - st.closing_balance) <= 0.011;
  const checkedRows = tx.filter((t) => t.balance != null).length;
  return { issues, totalIn, totalOut, closingOk, checkedRows, count: tx.length };
}

export async function bankToXlsx(st) {
  await loadScript('/vendor/exceljs.js');
  const wb = new window.ExcelJS.Workbook();
  wb.creator = 'TextSnap';
  const ws = wb.addWorksheet('Transactions');
  const money = '#,##0.00;[Red]-#,##0.00';
  ws.columns = [
    { header: 'Date', key: 'date', width: 12, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Description', key: 'description', width: 48 },
    { header: 'Reference', key: 'reference', width: 16 },
    { header: 'Debit (out)', key: 'debit', width: 14, style: { numFmt: money } },
    { header: 'Credit (in)', key: 'credit', width: 14, style: { numFmt: money } },
    { header: 'Balance', key: 'balance', width: 16, style: { numFmt: money } },
  ];
  const { issues } = checkBank(st);
  (st.transactions || []).forEach((t, i) => {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? new Date(t.date + 'T00:00:00Z') : t.date;
    const row = ws.addRow({ ...t, date: d });
    if (issues.has(i)) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E1' } };
  });
  const n = ws.rowCount;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.autoFilter = { from: 'A1', to: 'F1' };
  const total = ws.addRow({ description: 'Total' });
  total.getCell('debit').value = { formula: `SUM(D2:D${n})` };
  total.getCell('credit').value = { formula: `SUM(E2:E${n})` };
  total.font = { bold: true };

  const info = wb.addWorksheet('Summary');
  info.columns = [{ width: 22 }, { width: 40 }];
  [['Bank', st.bank_name], ['Account holder', st.account_holder], ['Account number', st.account_number], ['Currency', st.currency],
    ['Period', [st.period_start, st.period_end].filter(Boolean).join(' to ')], ['Opening balance', st.opening_balance], ['Closing balance', st.closing_balance],
    ['Transactions', (st.transactions || []).length]].forEach((r) => info.addRow(r));
  info.getColumn(1).font = { bold: true };
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function bankToCsv(st) {
  const rows = (st.transactions || []).map((t) => [t.date, t.description, t.reference, t.debit ?? '', t.credit ?? '', t.balance ?? '']);
  return '﻿' + window.Papa.unparse([['Date', 'Description', 'Reference', 'Debit', 'Credit', 'Balance'], ...rows], { newline: '\r\n' });
}
