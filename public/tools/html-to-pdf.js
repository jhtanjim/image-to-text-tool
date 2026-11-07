import { h, dropzone, statusLine, download, baseName, serverConvert } from '/js/ui.js';

export default function mount(root) {
  const status = statusLine();
  const tabs = h(`<div class="modes" role="tablist">
      <label class="mode"><input type="radio" name="src" value="url" checked /><span><b>Website URL</b><small>Convert any public web page</small></span></label>
      <label class="mode"><input type="radio" name="src" value="html" /><span><b>HTML code or file</b><small>Paste HTML or upload an .html file</small></span></label>
    </div>`);
  const urlBox = h(`<div class="url-row"><input type="url" name="url" placeholder="https://example.com" /></div>`);
  const htmlBox = h(`<div hidden></div>`);
  const textarea = h('<textarea class="big-text" spellcheck="false" placeholder="<h1>Hello</h1>\n<p>Paste your HTML here…</p>"></textarea>');
  let fileName = 'page';
  const dz = dropzone({
    accept: '.html,.htm,text/html', multiple: false, paste: false, maxSizeMB: 10,
    title: 'Drop or upload an .html file', sub: 'Images and styles from public websites are loaded; scripts are not run',
    test: (f) => /\.html?$/i.test(f.name) || f.type === 'text/html',
    onFiles: async (files) => {
      if (!files.length) return status.set('Please choose an .html file.', true);
      textarea.value = await files[0].text();
      fileName = baseName(files[0].name);
      status.set(`Loaded ${files[0].name}.`);
    },
  });
  dz.querySelector('.dz-icon').remove();
  dz.style.padding = '18px';
  htmlBox.append(textarea, dz);

  const options = h(`<div class="row">
      <label class="field">Page<select name="pageSize"><option>A4</option><option>Letter</option><option>Legal</option><option>A3</option></select></label>
      <label class="field">Margins<select name="margin"><option value="none">None</option><option value="small" selected>Small</option><option value="normal">Normal</option></select></label>
      <label class="check field inline"><input type="checkbox" name="landscape" /> Landscape</label>
      <label class="check field inline"><input type="checkbox" name="background" checked /> Background colors &amp; images</label>
    </div>`);
  const actions = h(`<div class="actions"><button class="btn primary big">Convert to PDF</button></div>`);
  const btn = actions.querySelector('button');
  const src = () => tabs.querySelector('input:checked').value;
  const opt = (n) => options.querySelector(`[name=${n}]`);

  tabs.addEventListener('change', () => { urlBox.hidden = src() !== 'url'; htmlBox.hidden = src() !== 'html'; status.set(''); });

  btn.onclick = async () => {
    const body = { pageSize: opt('pageSize').value, margin: opt('margin').value, landscape: opt('landscape').checked, background: opt('background').checked };
    let name;
    if (src() === 'url') {
      let url = urlBox.querySelector('input').value.trim();
      if (!url) return status.set('Enter a website address.', true);
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      body.url = url;
      try { name = new URL(url).hostname.replace(/^www\./, ''); } catch { return status.set('That address is not valid.', true); }
    } else {
      if (!textarea.value.trim()) return status.set('Paste some HTML or upload a file.', true);
      body.html = textarea.value; name = fileName;
    }
    btn.disabled = true; status.set(src() === 'url' ? 'Opening the website and creating the PDF… (up to 30 seconds)' : 'Creating PDF…');
    try {
      const { blob } = await serverConvert('/api/convert/html-pdf', body);
      download(blob, name.replace(/[\\/:*?"<>|]/g, '') + '.pdf');
      status.set('PDF downloaded.');
    } catch (e) { status.set(e.message, true); }
    finally { btn.disabled = false; }
  };

  root.append(tabs, urlBox, htmlBox, options, actions, status);
}
