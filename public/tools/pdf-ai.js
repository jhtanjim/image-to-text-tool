import { h, dropzone, statusLine, download, baseName, serverConvert, openPdf, engineStatus, tests } from '/js/ui.js';
import { aiAvailable, aiExtract, blocksToDocx, blocksToHtml } from '/js/ai.js';

// No-AI HTML from the PDF text layer.
// Lines are rebuilt from text positions; a big vertical gap starts a new paragraph,
// and short lines in clearly larger type become headings.
const block = (type, text, level = 0) => ({ type, level, text, ordered: false, items: [], rows: [] });

async function simpleBlocks(file) {
  const doc = await openPdf(file);
  const blocks = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const items = (await page.getTextContent()).items.filter((i) => i.str?.trim());
    // 1) group items into lines by their baseline (y), top to bottom
    const lines = [];
    for (const it of items) {
      const y = it.transform[5], size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 10;
      let line = lines.find((l) => Math.abs(l.y - y) < size * 0.4);
      if (!line) lines.push(line = { y, size, parts: [] });
      line.size = Math.max(line.size, size);
      line.parts.push({ x: it.transform[4], str: it.str });
    }
    lines.sort((a, b) => b.y - a.y);
    lines.forEach((l) => { l.text = l.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim(); });
    if (!lines.length) { if (n < doc.numPages) blocks.push(block('page_break', '')); continue; }

    // 2) body text size = the most common line size
    const counts = {};
    lines.forEach((l) => { const k = Math.round(l.size); counts[k] = (counts[k] || 0) + l.text.length; });
    const body = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);

    // 3) build paragraphs and headings
    let para = null, prev = null;
    const flush = () => { if (para) blocks.push(block('paragraph', para)); para = null; };
    for (const l of lines) {
      const isHeading = l.size >= body * 1.25 && l.text.length <= 120;
      const gap = prev ? prev.y - l.y : 0;
      if (isHeading) {
        flush();
        blocks.push(block('heading', l.text, l.size >= body * 1.8 ? 1 : l.size >= body * 1.45 ? 2 : 3));
      } else if (!para || gap > l.size * 1.9 || (prev && prev.size >= body * 1.25)) {
        flush(); para = l.text;
      } else {
        para += (para.endsWith('-') ? '' : ' ') + l.text; // join wrapped lines
      }
      prev = l;
    }
    flush();
    if (n < doc.numPages) blocks.push(block('page_break', ''));
  }
  if (!blocks.some((b) => b.type !== 'page_break')) throw new Error('This PDF has no text layer (it is probably scanned). Use AI mode, or PDF to Text which reads scanned pages.');
  return { title: blocks.find((b) => b.type === 'heading')?.text || baseName(file.name), blocks };
}

// mode: "word" | "html"
export default function mount(root, { mode }) {
  const word = mode === 'word';
  const status = statusLine();
  const modes = h(`<div class="modes">
      <label class="mode" data-ai><input type="radio" name="how" value="ai" /><span><b>AI: editable</b><small class="ai-note">${word ? 'Clean headings, paragraphs, lists and real Word tables. Reads scanned PDFs too.' : 'Clean, semantic HTML with headings, lists and tables. Reads scanned PDFs too.'}</small></span></label>
      <label class="mode"><input type="radio" name="how" value="plain" checked /><span><b>${word ? 'Exact layout' : 'Simple'} (no AI)</b><small>${word ? 'Looks like the original page. Best for forms and designed pages.' : 'Paragraphs from the PDF text layer. Free and instant.'}</small></span></label>
    </div>`);
  const actions = h(`<div class="actions"><button class="btn primary big" disabled>Convert to ${word ? 'Word' : 'HTML'}</button></div>`);
  const btn = actions.querySelector('button');
  const preview = h('<div hidden><p class="hint" style="margin:0 0 8px">Preview</p><iframe class="html-preview" sandbox="" style="width:100%;height:480px;border:1px solid var(--border);border-radius:12px;background:#fff"></iframe></div>');
  let file = null;
  const how = () => modes.querySelector('input:checked').value;

  const dz = dropzone({
    accept: '.pdf,application/pdf', multiple: false, paste: false, maxSizeMB: 24,
    title: 'Drop or upload a PDF', sub: 'Up to 24 MB', test: tests.isPdf,
    onFiles: (files) => {
      if (!files.length) return status.set('Please choose a PDF (max 24 MB).', true);
      file = files[0]; btn.disabled = false; preview.hidden = true;
      status.set(`Selected: ${file.name}.`);
    },
  });

  btn.onclick = async () => {
    btn.disabled = true; preview.hidden = true;
    const name = baseName(file.name);
    try {
      if (how() === 'ai') {
        status.set('AI is reading your PDF… (about 10–60 seconds depending on length)');
        const doc = await aiExtract('document', file);
        doc.title ||= name;
        const html = blocksToHtml(doc);
        preview.querySelector('iframe').srcdoc = html;
        preview.hidden = false;
        if (word) download(await blocksToDocx(doc), name + '.docx');
        else download(new Blob([html], { type: 'text/html;charset=utf-8' }), name + '.html');
        status.set(`Done! ${doc.blocks.filter((b) => b.type === 'table').length} table(s), ${doc.blocks.filter((b) => b.type === 'heading').length} heading(s) found.`);
      } else if (word) {
        status.set('Converting with layout preserved…');
        const { blob } = await serverConvert('/api/convert/office?type=pdf&to=docx', file);
        download(blob, name + '.docx');
        status.set('Done! Text is editable; complex pages keep their look using text boxes.');
      } else {
        status.set('Reading PDF text…');
        const html = blocksToHtml(await simpleBlocks(file));
        preview.querySelector('iframe').srcdoc = html;
        preview.hidden = false;
        download(new Blob([html], { type: 'text/html;charset=utf-8' }), name + '.html');
        status.set('Done!');
      }
    } catch (e) { console.error(e); status.set(e.message, true); }
    finally { btn.disabled = !file; }
  };

  root.append(dz, modes, actions, status, preview);

  // Enable AI mode only when the server has an API key; PDF→Word "exact layout" needs LibreOffice.
  Promise.all([aiAvailable(), engineStatus()]).then(([ai, eng]) => {
    const aiLabel = modes.querySelector('[data-ai]');
    if (ai) { aiLabel.querySelector('input').checked = true; }
    else {
      aiLabel.classList.add('disabled');
      aiLabel.querySelector('input').disabled = true;
      aiLabel.querySelector('.ai-note').textContent = 'Not available on this server yet (needs an API key).';
    }
    if (word && !eng.office && !ai) status.set('PDF to Word is not available on this server yet (needs LibreOffice or an API key).', true);
  });
}
