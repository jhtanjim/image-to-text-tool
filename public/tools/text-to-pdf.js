import { h, dropzone, statusLine, download, baseName, serverConvert } from '/js/ui.js';

export default function mount(root) {
  const status = statusLine();
  let fileName = 'document';
  const textarea = h('<textarea class="big-text" placeholder="Type or paste your text here, or drop a .txt file below… (বাংলা, हिन्दी, العربية all supported)"></textarea>');
  const dz = dropzone({
    accept: '.txt,text/plain,.md', multiple: false, paste: false, maxSizeMB: 10,
    title: 'Drop or upload a .txt file', sub: 'Or type directly in the box above',
    test: (f) => f.type.startsWith('text/') || /\.(txt|md|log|csv)$/i.test(f.name),
    onFiles: async (files) => {
      if (!files.length) return status.set('Please choose a text file.', true);
      textarea.value = await files[0].text();
      fileName = baseName(files[0].name);
      status.set(`Loaded ${files[0].name}.`);
    },
  });
  dz.querySelector('.dz-icon').remove();
  dz.style.padding = '18px';
  const options = h(`<div class="row">
      <label class="field">Title (optional)<input type="text" name="title" placeholder="Document title" /></label>
      <label class="field">Font<select name="font"><option value="sans">Sans</option><option value="serif">Serif</option><option value="mono">Monospace</option></select></label>
      <label class="field">Size<select name="fontSize">${[10, 11, 12, 14, 16, 18, 20, 24].map((s) => `<option${s === 12 ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="field">Page<select name="pageSize"><option>A4</option><option>Letter</option><option>Legal</option><option>A5</option></select></label>
      <label class="field">Margins<select name="margin"><option value="small">Small</option><option value="normal" selected>Normal</option><option value="large">Large</option></select></label>
      <label class="check field inline"><input type="checkbox" name="landscape" /> Landscape</label>
    </div>`);
  const actions = h(`<div class="actions"><button class="btn primary big">Convert to PDF</button></div>`);
  const btn = actions.querySelector('button');
  const val = (n) => options.querySelector(`[name=${n}]`);

  btn.onclick = async () => {
    if (!textarea.value.trim()) return status.set('Type or upload some text first.', true);
    btn.disabled = true; status.set('Creating PDF…');
    try {
      const title = val('title').value.trim();
      const { blob } = await serverConvert('/api/convert/text-pdf', {
        text: textarea.value, title, font: val('font').value, fontSize: Number(val('fontSize').value),
        pageSize: val('pageSize').value, margin: val('margin').value, landscape: val('landscape').checked,
      });
      download(blob, (title || fileName).replace(/[\\/:*?"<>|]/g, '') + '.pdf');
      status.set('PDF downloaded.');
    } catch (e) { status.set(e.message, true); }
    finally { btn.disabled = false; }
  };

  root.append(textarea, dz, options, actions, status);
}
