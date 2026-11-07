import { h, dropzone, statusLine, download, baseName } from '/js/ui.js';

const FONTS = {
  'Calibri': { ascii: 'Calibri', hAnsi: 'Calibri', cs: 'Nirmala UI', eastAsia: 'Microsoft YaHei' },
  'Times New Roman': { ascii: 'Times New Roman', hAnsi: 'Times New Roman', cs: 'Nirmala UI', eastAsia: 'SimSun' },
  'Arial': { ascii: 'Arial', hAnsi: 'Arial', cs: 'Nirmala UI', eastAsia: 'Microsoft YaHei' },
  'Nirmala UI (Bangla)': { ascii: 'Nirmala UI', hAnsi: 'Nirmala UI', cs: 'Nirmala UI', eastAsia: 'Microsoft YaHei' },
};

export default function mount(root) {
  const status = statusLine();
  let fileName = 'document';
  const textarea = h('<textarea class="big-text" placeholder="Type or paste your text here, or drop a .txt file below…"></textarea>');
  const dz = dropzone({
    accept: '.txt,text/plain', multiple: false, paste: false, maxSizeMB: 20,
    title: 'Drop or upload a .txt file', sub: 'Or type directly in the box above',
    test: (f) => f.type.startsWith('text/') || /\.(txt|md|csv|log)$/i.test(f.name),
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
      <label class="field">Font<select name="font">${Object.keys(FONTS).map((f) => `<option>${f}</option>`).join('')}</select></label>
      <label class="field">Size<select name="size">${[10, 11, 12, 14, 16, 18, 20].map((s) => `<option${s === 12 ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="field">Line spacing<select name="spacing"><option value="240">Single</option><option value="276" selected>1.15</option><option value="360">1.5</option><option value="480">Double</option></select></label>
    </div>`);
  const actions = h(`<div class="actions"><button class="btn primary big">Download .docx</button></div>`);
  const opt = (n) => options.querySelector(`[name=${n}]`).value;

  actions.querySelector('button').onclick = async () => {
    if (!textarea.value.trim()) return status.set('Type or upload some text first.', true);
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;
    const font = FONTS[opt('font')];
    const size = Number(opt('size')) * 2; // docx uses half-points
    const spacing = { line: Number(opt('spacing')) };
    const children = [];
    const title = opt('title').trim();
    if (title) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, font })] }));
    for (const line of textarea.value.replace(/\r\n?/g, '\n').split('\n')) {
      children.push(new Paragraph({ spacing, children: [new TextRun({ text: line, font, size })] }));
    }
    const doc = new Document({ creator: 'TextSnap', title: title || fileName, sections: [{ children }] });
    download(await Packer.toBlob(doc), (title || fileName).replace(/[\\/:*?"<>|]/g, '') + '.docx');
    status.set('Word document downloaded.');
  };

  root.append(textarea, dz, options, actions, status);
}
