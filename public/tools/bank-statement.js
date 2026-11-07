import { h, esc, dropzone, statusLine, download, baseName, loadScript, tests } from '/js/ui.js';
import { aiAvailable, aiExtract, checkBank, bankToXlsx, bankToCsv } from '/js/ai.js';

const fmt = (n) => (n == null ? '' : Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function mount(root) {
  const status = statusLine();
  const summary = h('<div></div>');
  const tableBox = h('<div></div>');
  const actions = h(`<div class="actions" hidden><button class="btn primary big">Download .xlsx</button><button class="btn">Download CSV</button></div>`);
  const [xlsxBtn, csvBtn] = actions.querySelectorAll('button');
  let st = null, name = 'statement';

  const dz = dropzone({
    accept: '.pdf,application/pdf,image/*', multiple: false, paste: true, maxSizeMB: 24,
    title: 'Drop or upload your bank statement', sub: 'PDF (text or scanned) or a photo · up to 24 MB · processed securely, not stored',
    test: (f) => tests.isPdf(f) || tests.isImage(f),
    onFiles: async (files) => {
      if (!files.length) return status.set('Please choose a PDF or an image.', true);
      if (!(await aiAvailable())) return status.set('This tool needs AI, which is not set up on this server yet (missing API key).', true);
      name = baseName(files[0].name);
      summary.innerHTML = tableBox.innerHTML = ''; actions.hidden = true;
      status.set('AI is reading every transaction… (about 20–90 seconds for long statements)');
      try {
        st = await aiExtract('bank', files[0]);
        if (!st.transactions?.length) return status.set('No transactions were found. Is this a bank statement?', true);
        render();
        status.set('');
      } catch (e) { console.error(e); status.set(e.message, true); }
    },
  });

  function render() {
    const c = checkBank(st);
    const verdict = c.issues.size
      ? `<p class="status error" style="margin:0">⚠ ${c.issues.size} row(s) don't add up with the printed balance. They are highlighted. Please check them against your statement.</p>`
      : c.checkedRows
        ? `<p style="margin:0;color:var(--success);font-weight:600">✓ All ${c.checkedRows} printed balances add up correctly${c.closingOk ? ', and opening + transactions = closing balance' : ''}.</p>`
        : '<p class="hint" style="margin:0">This statement has no running balance column, so rows could not be cross-checked.</p>';
    const closing = c.closingOk === false ? '<p class="status error" style="margin:4px 0 0">⚠ Opening balance + credits − debits does not equal the closing balance. A row may be missing.</p>' : '';
    summary.innerHTML = `<div class="output-box">
        <div class="row" style="gap:6px 28px">
          ${[['Bank', st.bank_name], ['Account', [st.account_holder, st.account_number].filter(Boolean).join(' · ')], ['Period', [st.period_start, st.period_end].filter(Boolean).join(' → ')], ['Currency', st.currency]]
            .filter(([, v]) => v).map(([k, v]) => `<div><small class="hint">${k}</small><div><b>${esc(v)}</b></div></div>`).join('')}
        </div>
        <div class="row" style="gap:6px 28px;margin-top:10px">
          <div><small class="hint">Opening</small><div><b>${fmt(st.opening_balance) || '–'}</b></div></div>
          <div><small class="hint">Money in</small><div><b style="color:var(--success)">+${fmt(c.totalIn)}</b></div></div>
          <div><small class="hint">Money out</small><div><b style="color:var(--danger)">−${fmt(c.totalOut)}</b></div></div>
          <div><small class="hint">Closing</small><div><b>${fmt(st.closing_balance) || '–'}</b></div></div>
          <div><small class="hint">Transactions</small><div><b>${c.count}</b></div></div>
        </div>
        <div style="margin-top:12px">${verdict}${closing}</div>
      </div>`;
    tableBox.innerHTML = `<div class="table-wrap" style="max-height:480px"><table>
        <thead><tr><th>Date</th><th>Description</th><th>Ref</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th><th style="text-align:right">Balance</th></tr></thead>
        <tbody>${st.transactions.map((t, i) => `<tr${c.issues.has(i) ? ' style="background:rgba(229,72,77,.14)" title="Balance does not add up"' : ''}>
          <td>${esc(t.date)}</td><td style="white-space:normal;min-width:220px">${esc(t.description)}</td><td>${esc(t.reference)}</td>
          <td style="text-align:right">${fmt(t.debit)}</td><td style="text-align:right">${fmt(t.credit)}</td><td style="text-align:right">${fmt(t.balance)}</td></tr>`).join('')}</tbody>
      </table></div>`;
    actions.hidden = false;
  }

  xlsxBtn.onclick = async () => download(await bankToXlsx(st), name + '.xlsx');
  csvBtn.onclick = async () => { await loadScript('/vendor/papaparse.js'); download(new Blob([bankToCsv(st)], { type: 'text/csv;charset=utf-8' }), name + '.csv'); };

  root.append(dz, status, summary, actions, tableBox);
  aiAvailable().then((ok) => { if (!ok) status.set('This tool needs AI, which is not set up on this server yet (missing API key).', true); });}
