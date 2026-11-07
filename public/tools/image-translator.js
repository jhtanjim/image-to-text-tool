import { h, esc, dropzone, statusLine, download, copyText, baseName, tests } from '/js/ui.js';
import { aiAvailable, aiExtract } from '/js/ai.js';

const LANGS = ['English', 'Bengali', 'Hindi', 'Urdu', 'Arabic', 'Spanish', 'French', 'German', 'Portuguese', 'Russian',
  'Turkish', 'Indonesian', 'Malay', 'Chinese (Simplified)', 'Japanese', 'Korean', 'Italian', 'Dutch', 'Thai', 'Vietnamese'];

export default function mount(root) {
  const status = statusLine();
  const options = h(`<div class="row"><label class="field">Translate to
      <select name="target">${LANGS.map((l) => `<option${l === 'English' ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label></div>`);
  const out = h(`<div class="two-col" hidden>
      <div><p class="hint" style="margin:0 0 6px">Original <span class="tag detected"></span></p><textarea class="big-text orig" spellcheck="false"></textarea>
        <div class="result-actions"><button class="btn copy-o">Copy</button></div></div>
      <div><p class="hint" style="margin:0 0 6px">Translation <span class="tag target"></span></p><textarea class="big-text trans" spellcheck="false"></textarea>
        <div class="result-actions"><button class="btn copy-t">Copy</button><button class="btn primary dl">Download .txt</button></div></div>
    </div>`);
  const preview = h('<img alt="" style="max-width:100%;max-height:260px;border-radius:12px;display:block;margin:0 auto" hidden />');
  let file = null;

  async function translate() {
    if (!file) return;
    if (!(await aiAvailable())) return status.set('This tool needs AI, which is not set up on this server yet (missing API key).', true);
    const target = options.querySelector('select').value;
    out.hidden = true;
    status.set(`Reading and translating to ${target}…`);
    try {
      const r = await aiExtract('translate', file, { target });
      if (!r.original_text.trim()) { status.set('No text was found in this image.', true); return; }
      out.querySelector('.orig').value = r.original_text;
      out.querySelector('.trans').value = r.translated_text;
      out.querySelector('.detected').textContent = r.detected_language;
      out.querySelector('.target').textContent = target;
      out.hidden = false;
      status.set('Done! You can edit either side before copying.');
    } catch (e) { console.error(e); status.set(e.message, true); }
  }

  const dz = dropzone({
    accept: 'image/*', multiple: false, test: tests.isImage,
    title: 'Drop, upload or paste an image with text', sub: 'Signs, menus, documents, screenshots · any language',
    onFiles: (files) => {
      if (!files.length) return status.set('Please choose an image.', true);
      file = files[0];
      if (preview.src) URL.revokeObjectURL(preview.src);
      preview.src = URL.createObjectURL(file); preview.hidden = false;
      translate();
    },
  });
  options.querySelector('select').addEventListener('change', translate);
  out.querySelector('.copy-o').onclick = (e) => copyText(out.querySelector('.orig').value, e.currentTarget);
  out.querySelector('.copy-t').onclick = (e) => copyText(out.querySelector('.trans').value, e.currentTarget);
  out.querySelector('.dl').onclick = () => download(new Blob([out.querySelector('.trans').value], { type: 'text/plain;charset=utf-8' }), `${baseName(file.name)}-${options.querySelector('select').value}.txt`);

  root.append(dz, options, preview, status, out);
  aiAvailable().then((ok) => { if (!ok) status.set('This tool needs AI, which is not set up on this server yet (missing API key).', true); });
}
